import { window } from "vscode";
import { Failure, FailureFromJSON, instanceOfFailure, ResponseError } from "../clients/sidecar";
import { Logger } from "../logging";

const logger = new Logger("sidecar.errors");

/** Sidecar is not currently running (better start a new one!) */
export class NoSidecarRunningError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * If the auth token we have on record for the sidecar is rejected, will need to restart it.
 * Fortunately it tells us its PID in the response headers, so we know what to kill.
 */
export class WrongAuthSecretError extends Error {
  public sidecar_process_id: number;

  constructor(message: string, sidecar_process_id: number) {
    super(message);
    this.sidecar_process_id = sidecar_process_id;
  }
}

/** Could not find the sidecar executable. */
export class NoSidecarExecutableError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Parse and log the JSON from a {@link ResponseError} from the sidecar, optionally showing a
 * user-facing notification.
 * @param messagePrefix - A prefix to add to the error message.
 * @param error - The error to parse.
 * @param showNotification - Whether to show a user-facing notification. Default is `false`.
 */
export async function handleResponseError(
  messagePrefix: string = "",
  error: ResponseError,
  showNotification: boolean = false,
  notificationPrefix: string = "",
) {
  let errorDetails = error.message;

  let responseBody: any;
  try {
    responseBody = await error.response.json();
    if (instanceOfFailure(responseBody)) {
      const respFailure: Failure = FailureFromJSON(responseBody);
      errorDetails = respFailure.errors!.map((e: any) => e.detail).join(", ");
    } else {
      logger.error(`${messagePrefix}: ${JSON.stringify(responseBody)}`);
      errorDetails = JSON.stringify(responseBody);
    }
  } catch (e) {
    logger.error(`Failed to parse response body (using ResponseError.message)`, e);
  }

  if (showNotification) {
    const prefix = notificationPrefix ? notificationPrefix : messagePrefix;
    window.showErrorMessage(`${prefix}: ${errorDetails}`);
  }
}
