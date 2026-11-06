import * as vscode from "vscode";
import type {
  ErrorContext,
  FetchParams,
  Middleware,
  RequestContext,
  ResponseContext,
} from "../clients/sidecar";
import { ConnectedState } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ccloudAuthSessionInvalidated, stableCCloudConnectedState } from "../emitters";
import { Logger } from "../logging";
import { SecretStorageKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";
import { getSecretStorage } from "../storage/utils";
import { isTimeoutReason, RequestTimeoutError, timeoutSignal } from "../utils/timing";
import { CCLOUD_RECONNECT_TIMEOUT_MS, SIDECAR_CONNECTION_ID_HEADER } from "./constants";
import { CCloudReconnectTimeoutError } from "./errors";

const logger = new Logger("sidecar.middlewares");

// only create this if enabled in SidecarHandle setup
let requestResponseOutputChannel: vscode.OutputChannel | undefined;
export function setDebugOutputChannel() {
  if (!requestResponseOutputChannel) {
    requestResponseOutputChannel = vscode.window.createOutputChannel(
      "Confluent (Ext->Sidecar Debug)",
    );
  }
}

function contextToRequestLogString(context: RequestContext): string {
  const logBody = {
    url: context.url,
    method: context.init.method as string,
    headers: sanitizeHeaders(context.init.headers),
    body: context.init.body ? String(context.init.body) : undefined,
  };
  return JSON.stringify(logBody);
}

async function contextToResponseLogString(context: ResponseContext): Promise<string> {
  let body: string;

  try {
    const contentType = context.response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      body = JSON.stringify(await context.response.json());
    } else {
      body = await context.response.text();
    }
  } catch (e) {
    body = `error reading response body: ${e}`;
  }

  const logBody = {
    status: context.response.status,
    statusText: context.response.statusText,
    headers: sanitizeHeaders(context.response.headers),
    body: body,
  };
  return JSON.stringify(logBody);
}

/** Truncate the Authorization header value so it doesn't leak into any logs or {@link vscode.OutputChannel}s. */
function sanitizeHeaders(headers: HeadersInit | Headers | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  const sanitizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "authorization") {
      sanitizedHeaders[key] = `Bearer ${value.slice(7, 9)}...${value.slice(-2)}`;
    } else {
      sanitizedHeaders[key] = value;
    }
  }
  return sanitizedHeaders;
}

export class DebugRequestResponseMiddleware implements Middleware {
  async pre(context: RequestContext): Promise<void> {
    const timestamp = new Date().toISOString();
    const requestLogString = contextToRequestLogString(context);

    const logPrefix = "sending request";
    logger.debug(logPrefix, { request: requestLogString });
    requestResponseOutputChannel?.appendLine(`${timestamp} | ${logPrefix}: ${requestLogString}`);
  }

  async post(context: ResponseContext): Promise<void> {
    const timestamp = new Date().toISOString();
    const requestLogString = contextToRequestLogString(context);
    const responseLogString = await contextToResponseLogString(context);

    const logPrefix = "received response";
    logger.debug(logPrefix, { request: requestLogString, response: responseLogString });
    requestResponseOutputChannel?.appendLine(`${timestamp} | ${logPrefix}`);
    requestResponseOutputChannel?.appendLine(`\trequest: ${requestLogString}`);
    requestResponseOutputChannel?.appendLine(`\tresponse: ${responseLogString}`);
  }
}

export class ErrorResponseMiddleware implements Middleware {
  async post(context: ResponseContext): Promise<void> {
    if (context.response.status >= 400) {
      // Special case: if we received a 404 about either ccloud or local kafka connection, speak softly. Is expected.
      if (
        context.response.status === 404 &&
        /gateway\/v1\/connections\/vscode-(confluent-cloud|local)-connection/.test(context.url)
      ) {
        const localOrCcloud = context.url.includes("local") ? "local" : "Confluent Cloud";

        logger.debug(`Received 404 for ${localOrCcloud} connection.`);
        return;
      }

      // Special case: suppress error logs for schema registry RBAC-related 404s
      // Handles both gateway format and direct SR endpoint format, including versions and versions/latest
      if (context.response.status === 404 && /\/subjects\/[\w-]/.test(context.url)) {
        logger.debug("Received 404 for schema registry subject version (likely RBAC limitation).");
        return;
      }

      const requestLogString = contextToRequestLogString(context);
      const responseLogString = await contextToResponseLogString(context);

      const logPrefix = "received error response from sidecar";
      logger.error(logPrefix, {
        request: requestLogString,
        response: responseLogString,
      });
      // don't throw an error because our openapi-generator client code will throw ResponseError by
      // default if status >= 400
    }
  }
}

/** Used to prevent multiple instances of the `EXPIRED` progress notification stacking up. */
let problematicStateNotificationOpen: boolean = false;
/** Requests still blocked in the reconnect wait, which share the one progress notification. */
let reconnectWaiters = 0;

/** Check if a request is for Confluent Cloud handle different connected state scenarios. */
export class CCloudAuthStatusMiddleware implements Middleware {
  async pre(context: RequestContext): Promise<void> {
    if (hasCCloudConnectionIdHeader(context.init.headers)) {
      // check the last stored connected state instead of re-fetching
      const status: ConnectedState = await getResourceManager().getCCloudState();
      await this.handleCCloudAuthStatus(status);
    }
  }

  /**
   * Handle the various states that can be returned by the sidecar for the current CCloud connection.
   *
   * - If the status is `EXPIRED`, block the request and show a progress notification until we
   *  see a status change (to a non-transient state like `SUCCESS` or `FAILED`/`NONE`) from the
   *  websocket connection event handling.
   * - If the status is `NONE` or `FAILED`, invalidate the current CCloud auth session to prompt
   *  the user to sign in again.
   */
  async handleCCloudAuthStatus(status: ConnectedState): Promise<void> {
    if (status !== ConnectedState.Expired) {
      // resolve any open progress notification if we see a non-`EXPIRED` state
      stableCCloudConnectedState.fire();
      // and set the flag back so the notification can open again if we see another `EXPIRED` state
      problematicStateNotificationOpen = false;
    }

    if ([ConnectedState.Failed, ConnectedState.None].includes(status)) {
      // some unusable state that requires the user to reauthenticate
      logger.error(
        "current CCloud connection has no token or transitioned to a failed state; invalidating auth session",
        {
          status,
        },
      );
      ccloudAuthSessionInvalidated.fire();
    } else if (status === ConnectedState.Expired) {
      // this may block for a while depending on how long it takes before we get an updated state
      await this.handleProblematicStatus();
    }
  }

  async handleProblematicStatus() {
    logger.warn("current CCloud connection has an invalid token; waiting for updated status");
    // only notify if we haven't shown the notification yet
    if (!problematicStateNotificationOpen) {
      problematicStateNotificationOpen = true;
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Attempting to reconnect to Confluent Cloud...",
          cancellable: false,
        },
        async () => {
          await new Promise((resolve) => {
            const subscriber: vscode.Disposable = stableCCloudConnectedState.event(() => {
              subscriber.dispose();
              resolve(void 0);
            });
          });
        },
      );
    }

    // block the request that got us into this flow until the connected state "secret" changes, or
    // fail it once the deadline passes
    let secretSubscriber: vscode.Disposable | undefined;
    let timedOut = false;
    const deadline = timeoutSignal(CCLOUD_RECONNECT_TIMEOUT_MS);
    reconnectWaiters++;
    try {
      await new Promise<void>((resolve, reject) => {
        deadline.signal.addEventListener("abort", () => {
          timedOut = true;
          reject(
            new CCloudReconnectTimeoutError(
              `Timed out after ${CCLOUD_RECONNECT_TIMEOUT_MS / 1000}s waiting to reconnect to Confluent Cloud. Sign in again.`,
            ),
          );
        });
        secretSubscriber = getSecretStorage().onDidChange(
          async ({ key }: vscode.SecretStorageChangeEvent) => {
            // any change (other state or the "secret" being deleted entirely) will resolve and unblock requests
            if (key === SecretStorageKeys.CCLOUD_STATE) {
              resolve();
            }
          },
        );
      });
    } finally {
      reconnectWaiters--;
      deadline.clear();
      secretSubscriber?.dispose();
      if (timedOut && reconnectWaiters === 0) {
        // stop claiming a reconnect is underway, and let a later EXPIRED state show it again
        stableCCloudConnectedState.fire();
        problematicStateNotificationOpen = false;
      }
    }
  }
}

/** Check if headers include the CCloud connection ID, indicating that the request is going to be
 * sent to CCloud via the sidecar. */
function hasCCloudConnectionIdHeader(headers: HeadersInit | Headers | undefined): boolean {
  if (!headers) {
    return false;
  }
  // coerce to Headers object since HeadersInit doesn't have .has()/.get() methods
  headers = new Headers(headers);
  return (
    headers.has(SIDECAR_CONNECTION_ID_HEADER) &&
    headers.get(SIDECAR_CONNECTION_ID_HEADER) === CCLOUD_CONNECTION_ID
  );
}

/**
 * Fail a sidecar request that gets no answer within {@linkcode timeoutMs}, combined with any signal
 * the caller passed. Belongs last in the middleware list, so its timer starts after earlier `pre`
 * hooks (like the CCloud reconnect wait) and its throwing `onError` can't skip theirs.
 */
export class TimeoutMiddleware implements Middleware {
  /** Per-request cleanup, keyed by the `init` that `pre` hands to `fetch` and later hooks. */
  private readonly pending = new WeakMap<RequestInit, () => void>();

  constructor(
    readonly timeoutMs: number,
    /** Who didn't answer, for the error message. */
    private readonly target: string = "the sidecar",
  ) {}

  async pre(context: RequestContext): Promise<FetchParams> {
    const { signal, clear } = timeoutSignal(this.timeoutMs, context.init.signal);
    const init = { ...context.init, signal };
    this.pending.set(init, clear);
    return { url: context.url, init };
  }

  async post(context: ResponseContext): Promise<void> {
    // headers are in; release the timer and the caller's signal rather than pile listeners onto a
    // long-lived caller signal, at the cost of leaving the (short) body read uncovered
    this.settle(context.init);
  }

  async onError(context: ErrorContext): Promise<Response | void> {
    this.settle(context.init);
    // a caller's own abort carries an AbortError reason, and passes through as before
    if (isTimeoutReason(context.init.signal?.reason)) {
      throw new RequestTimeoutError(
        `Request to ${this.target} (${context.init.method ?? "GET"} ${context.url})`,
        this.timeoutMs,
        context.error,
      );
    }
  }

  private settle(init: RequestInit): void {
    this.pending.get(init)?.();
    this.pending.delete(init);
  }
}
