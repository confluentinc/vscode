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

/** Combined ResponseError type from our OpenAPI spec generated client code. */
type ResponseError =
  | SidecarResponseError
  | KafkaResponseError
  | SchemaRegistryResponseError
  | ScaffoldingServiceResponseError
  | DockerResponseError;

/** Log the possibly-ResponseError and any additional information, and optionally send to Sentry. */
export async function logResponseError(
  e: unknown,
  message: string,
  extra: Record<string, string> = {},
  sendTelemetry: boolean = false,
): Promise<void> {
  let errorMessage: string = "";
  let errorContext: Record<string, string | number | boolean | null | undefined> = {};
  let responseStatusCode: number | undefined;

  if ((e as any).response) {
    // one of our ResponseError types, attempt to extract more information before logging
    const error = e as ResponseError;
    const errorBody = await error.response.clone().text();
    errorMessage = `[${message}] error response:`;
    errorContext = {
      status: error.response.status,
      statusText: error.response.statusText,
      body: errorBody.slice(0, 5000), // limit to 5000 characters
      errorType: error.name,
    };
    responseStatusCode = error.response.status;
  } else {
    // something we caught that wasn't actually a ResponseError type but was passed in here anyway
    errorMessage = `[${message}] error: ${e}`;
    if (e instanceof Error) {
      errorContext = { errorType: e.name, errorMessage: e.message };
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
      logResponseError(e, `"${selection}" button callback`, {}, true);
    }
    // send telemetry for which button was clicked
    logUsage(UserEvent.NotificationButtonClicked, {
      buttonLabel: selection,
      notificationType: "error",
    });
  }
}
