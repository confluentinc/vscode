import * as vscode from "vscode";
import { Middleware, RequestContext, ResponseContext } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { getExtensionContext } from "../context/extension";
import { ccloudAuthSessionInvalidated, nonInvalidTokenStatus } from "../emitters";
import { Logger } from "../logging";
import { SecretStorageKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";
import { SIDECAR_CONNECTION_ID_HEADER } from "./constants";

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

/** Used to prevent multiple instances of the `INVALID_TOKEN` progress notification stacking up. */
let invalidTokenNotificationOpen: boolean = false;

/** Check if a request is for Confluent Cloud handle different auth status scenarios. */
export class CCloudAuthStatusMiddleware implements Middleware {
  async pre(context: RequestContext): Promise<void> {
    if (hasCCloudConnectionIdHeader(context.init.headers)) {
      // check the last auth status stored as a "secret" by the auth poller instead of re-fetching
      const status: string | undefined = await getResourceManager().getCCloudAuthStatus();
      if (status) {
        await this.handleCCloudAuthStatus(status);
      }
    }
  }

  /**
   * Handle the various auth statuses that can be returned by the sidecar for the current CCloud connection.
   *
   * - If the status is `INVALID_TOKEN`, block the request and show a progress notification until we
   *  see a status change (to a non-transient state like `VALID_TOKEN` or `FAILED`/`NO_TOKEN`) from the
   *  auth poller.
   * - If the status is `NO_TOKEN` or `FAILED`, invalidate the current CCloud auth session to prompt
   *  the user to sign in again.
   */
  async handleCCloudAuthStatus(status: string): Promise<void> {
    if (status !== "INVALID_TOKEN") {
      // resolve any open progress notification if we see a non-`INVALID_TOKEN` status
      nonInvalidTokenStatus.fire();
      // and set the flag back so the notification can open again if we see another `INVALID_TOKEN`
      invalidTokenNotificationOpen = false;
    }

    if (["NO_TOKEN", "FAILED"].includes(status)) {
      // some unusable state that requires the user to reauthenticate
      logger.error(
        "current CCloud connection has no token or transitioned to a failed state; invalidating auth session",
        {
          status,
        },
      );
      ccloudAuthSessionInvalidated.fire();
    } else if (status === "INVALID_TOKEN") {
      // this may block for a while depending on how long it takes before we get an updated auth status
      await this.handleCCloudInvalidTokenStatus();
    }
  }

  async handleCCloudInvalidTokenStatus() {
    logger.warn("current CCloud connection has an invalid token; waiting for updated status");
    // only notify if we haven't shown the notification yet
    if (!invalidTokenNotificationOpen) {
      invalidTokenNotificationOpen = true;
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Attempting to reconnect to Confluent Cloud...",
          cancellable: false,
        },
        async () => {
          await new Promise((resolve) => {
            const subscriber: vscode.Disposable = nonInvalidTokenStatus.event(() => {
              subscriber.dispose();
              resolve(void 0);
            });
          });
        },
      );
    }

    // block the request that got us into this flow until the auth status "secret" changes
    await new Promise((resolve) => {
      const secretSubscriber: vscode.Disposable = getExtensionContext().secrets.onDidChange(
        async ({ key }: vscode.SecretStorageChangeEvent) => {
          // any change (other status or the "secret" being deleted entirely) will resolve and unblock requests
          if (key === SecretStorageKeys.CCLOUD_AUTH_STATUS) {
            secretSubscriber.dispose();
            resolve(void 0);
          }
        },
      );
    });
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
