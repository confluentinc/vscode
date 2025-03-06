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
  let errorMessage: string = "";
  let errorContext: Record<string, string | number | boolean | null | undefined> = {};
  let responseStatusCode: number | undefined;

  if ((e as any).response) {
    // one of our ResponseError types, attempt to extract more information before logging
    const error = e as AnyResponseError;
    const errorBody = await error.response.clone().text();
    errorMessage = `[${messagePrefix}] error response:`;
    errorContext = {
      responseStatus: error.response.status,
      responseStatusText: error.response.statusText,
      responseBody: errorBody.slice(0, 5000), // limit to 5000 characters
      responseErrorType: error.name,
    };
    responseStatusCode = error.response.status;
  } else {
    // something we caught that wasn't actually a ResponseError type but was passed in here anyway
    errorMessage = `[${messagePrefix}] error: ${e}`;
    if (e instanceof Error) {
      // top-level error
      errorContext = {
        errorType: e.name,
        errorMessage: e.message,
        errorStack: e.stack,
      };
      // also handle any nested errors starting from the `cause` property
      if (hasErrorCause(e)) {
        const errorChain = getNestedErrorChain(e.cause);
        if (errorChain.length) {
          errorContext = {
            ...errorContext,
            errors: JSON.stringify(errorChain, null, 2),
          };
        }
      }
    }
  }

  logger.error(errorMessage, { ...errorContext, ...extra });
  if (sendTelemetry) {
    Sentry.captureException(e, {
      contexts: { response: { status_code: responseStatusCode } },
      extra: { ...errorContext, ...extra },
    });
  }
}

export const DEFAULT_ERROR_NOTIFICATION_BUTTONS: Record<
  string,
  (() => void) | (() => Promise<void>)
> = {
  "Open Logs": () => commands.executeCommand("confluent.showOutputChannel"),
  "File Issue": () => commands.executeCommand("confluent.support.issue"),
};

/** Shows the error notification with `message` and custom action buttons.
 * @param message Error message to display
 * @param buttons Optional map of button labels to callback functions; defaults to showing
 *   "Open Logs" and "File Issue" buttons if not provided
 */
export async function showErrorNotificationWithButtons(
  message: string,
  buttons?: Record<string, (() => void) | (() => Promise<void>)>,
) {
  const buttonMap = buttons || DEFAULT_ERROR_NOTIFICATION_BUTTONS;
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
