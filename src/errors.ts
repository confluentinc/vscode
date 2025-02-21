import * as Sentry from "@sentry/node";

import { commands, window } from "vscode";
import { ResponseError as DockerResponseError } from "./clients/docker";
import { ResponseError as KafkaResponseError } from "./clients/kafkaRest";
import { ResponseError as ScaffoldingServiceResponseError } from "./clients/scaffoldingService";
import { ResponseError as SchemaRegistryResponseError } from "./clients/schemaRegistryRest";
import { ResponseError as SidecarResponseError } from "./clients/sidecar";
import { Logger } from "./logging";
import { logUsage, UserEvent } from "./telemetry/events";

const logger = new Logger("errors");

/** Thrown when attempting to get the ExtensionContext before extension activation. */
export class ExtensionContextNotSetError extends Error {
  constructor(source: string, message: string = "ExtensionContext not set yet") {
    super(`${source}: ${message}`);
  }
}

/** Combined `ResponseError` type from our OpenAPI spec generated client code. */
export type AnyResponseError =
  | SidecarResponseError
  | KafkaResponseError
  | SchemaRegistryResponseError
  | ScaffoldingServiceResponseError
  | DockerResponseError;

/**
 * Check if an {@link Error} has a `cause` property of type `Error`, indicating it has at least
 * one nested error.
 *
 * NOTE: This is mainly seen with `FetchError`s from `src/clients/<service>/runtime.ts`.
 */
export function hasErrorCause(error: Error): error is Error & { cause: Error } {
  return "cause" in error && error.cause instanceof Error;
}

/** Extract the full error chain from a nested error. */
export function getNestedErrorChain(error: Error): Record<string, string | undefined>[] {
  const chain: Record<string, string | undefined>[] = [];
  let currentError: Error | undefined = error;
  let level = 0;
  while (currentError) {
    chain.push({
      [`errorType${level}`]: currentError.name,
      [`errorMessage${level}`]: currentError.message,
      [`errorStack${level}`]: currentError.stack,
    });
    // if the current error has a `cause` property, it has a nested error that we should include
    // so dig a level deeper
    currentError = hasErrorCause(currentError) ? currentError.cause : undefined;
    level++;
  }
  return chain;
}

export class WrappedResponseError extends Error {
  constructor(
    public readonly message: string,
    public readonly cause: AnyResponseError,
  ) {
    super(message);
    this.name = "WrappedResponseError";
  }
}

/**
 * Log the provided error along with any additional information, and optionally send to Sentry.
 *
 * `ResponseError` variants will be handled to extract more information from the response itself.
 * Nested errors (with `cause` properties) will be handled to extract the error chain for
 * additional error context.
 *
 * @param e Error to log
 * @param messagePrefix Prefix to include in the logger.error() message
 * @param extra Additional context to include in the log message (and `extra` field in Sentry)
 * @param sendTelemetry Whether to send the error to Sentry (default: `false`)
 * */
export async function logError(
  e: unknown,
  messagePrefix: string,
  extra: Record<string, string> = {},
  sendTelemetry: boolean = false,
): Promise<void> {
  const errorInfo: ErrorInfo | undefined = await extractErrorInformation(e, messagePrefix);
  if (!errorInfo) {
    // not an Error type, just log the message
    logger.error(`${messagePrefix}: ${e}`, extra);
    return;
  }

  logger.error(errorInfo.message, { ...errorInfo.errorContext, ...extra });
  if (sendTelemetry) {
    Sentry.captureException(e, {
      contexts: { response: { status_code: errorInfo.responseStatusCode } },
      extra: { ...errorInfo.errorContext, ...extra },
    });
  }
}

interface ErrorInfo {
  error: Error;
  message: string;
  errorContext: Record<string, string | number | boolean | null | undefined>;
  responseStatusCode: number | undefined;
}

export async function extractErrorInformation(
  e: unknown,
  messagePrefix: string,
): Promise<ErrorInfo | undefined> {
  if (!(e instanceof Error)) {
    return;
  }
  const error = e as Error;

  let message = "";
  let errorContext: Record<string, string | number | boolean | null | undefined> = {};
  let responseStatusCode: number | undefined;

  if ((error as AnyResponseError).response) {
    // one of our ResponseError types, attempt to extract more information before logging
    const responseError = e as AnyResponseError;
    const resp: Response = responseError.response;
    const errorBody: string = await resp.clone().text();
    message = `[${messagePrefix}] error response:`;
    errorContext = {
      responseStatus: resp.status,
      responseStatusText: resp.statusText,
      responseBody: errorBody.slice(0, 5000), // limit to 5000 characters
      responseErrorType: error.name,
    };
    responseStatusCode = responseError.response.status;
    // wrap the error and keep the current ResponseError as the `cause` property
    e = new WrappedResponseError(
      `ResponseError: ${resp.status} ${resp.statusText} @ ${resp.url}`,
      responseError,
    );
  } else {
    // non-ResponseError Error type
    message = `[${messagePrefix}] error: ${e}`;
    errorContext = {
      errorType: e.name,
      errorMessage: e.message,
      errorStack: e.stack,
    };
  }

  // also handle any nested errors starting from the `cause` property
  if (hasErrorCause(error)) {
    const errorChain = getNestedErrorChain(error.cause);
    if (errorChain.length) {
      errorContext = {
        ...errorContext,
        errors: JSON.stringify(errorChain, null, 2),
      };
    }
  }

  return { error, message, errorContext, responseStatusCode };
}

/** Shows the error notification with `message` and custom action buttons.
 * @param message Error message to display
 * @param buttons Optional map of button labels to callback functions; defaults to showing
 *   "Open Logs" and "File Issue" buttons if not provided
 */
export async function showErrorNotificationWithButtons(
  message: string,
  buttons?: Record<string, (() => void) | (() => Promise<void>)>,
) {
  const defaultButtons: Record<string, (() => void) | (() => Promise<void>)> = {
    "Open Logs": () => commands.executeCommand("confluent.showOutputChannel"),
    "File Issue": () => commands.executeCommand("confluent.support.issue"),
  };
  const buttonMap = buttons || defaultButtons;
  // we're awaiting the user's selection to more easily test the callback behavior, rather than
  // chaining with .then()
  const selection = await window.showErrorMessage(message, ...Object.keys(buttonMap));
  if (selection) {
    try {
      await buttonMap[selection]();
    } catch (e) {
      // log the error and send telemetry if the callback function throws an error
      logError(e, `"${selection}" button callback`, {}, true);
    }
    // send telemetry for which button was clicked
    logUsage(UserEvent.NotificationButtonClicked, {
      buttonLabel: selection,
      notificationType: "error",
    });
  }
}
