import * as Sentry from "@sentry/node";

import { ResponseError as DockerResponseError } from "./clients/docker";
import { ResponseError as KafkaResponseError } from "./clients/kafkaRest";
import { ResponseError as SchemaRegistryResponseError } from "./clients/schemaRegistryRest";
import { ResponseError as SidecarResponseError } from "./clients/sidecar";
import { Logger } from "./logging";

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
    errorMessage = `[${message}] error:`;
  }

  logger.error(errorMessage, { ...errorContext, ...extra });
  if (sendTelemetry) {
    Sentry.captureException(e, {
      contexts: { response: { status_code: responseStatusCode } },
      extra: { ...errorContext, ...extra },
    });
  }
}
