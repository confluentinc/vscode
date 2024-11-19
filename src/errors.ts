import * as Sentry from "@sentry/node";
import { ResponseError as DockerResponseError } from "./clients/docker";
import { ResponseError as KafkaResponseError } from "./clients/kafkaRest";
import { ResponseError as SchemaRegistryResponseError } from "./clients/schemaRegistryRest";
import { ResponseError as SidecarResponseError } from "./clients/sidecar";
import { observabilityContext } from "./context/observability";
import { Logger } from "./logging";
import { SIDECAR_CONNECTION_ID_HEADER } from "./sidecar/constants";

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
      errorType: error.constructor.name,
    };
    responseStatusCode = error.response.status;
  } else {
    // something we caught that wasn't actually a ResponseError type but was passed in here anyway
    errorMessage = `[${message}] error:`;
  }

  logger.error(errorMessage, { ...errorContext, ...extra });
  if (sendTelemetry) {
    captureException(e, {
      contexts: { response: { status_code: responseStatusCode } },
      extra: { ...errorContext, ...extra },
    });
  }
}

/**
 * Wrapper around the {@link Sentry.captureException} to include our extension instance's
 * {@link observabilityContext} in the event context, along with any additionally provided context.
 *
 * See {@link Sentry.captureException}'s `ExclusiveEventHintOrCaptureContext` for more information
 * on the `context` parameter.
 *
 * NOTE: If a {@link ResponseError} is provided as the `error`, the response status code and any
 * associated `x-connection-id` header will be included in the event context under `contexts.response`.
 */
export function captureException(e: unknown, context = {}): void {
  const errorContext = enrichErrorContext(e, context);
  Sentry.captureException(e, errorContext);
}

// split from `captureException` for easier testing
export function enrichErrorContext(
  e: unknown,
  context: Record<string, any> = {},
): Record<string, any> {
  const obsContext: Record<string, any> = observabilityContext.toRecord();
  let errorContext: Record<string, any> = { extra: { ...obsContext } };

  // merge `extra` from the provided `context` with the observability context
  const { extra: extraFromContext = {}, ...otherContext } = context;
  if (extraFromContext) {
    // ensure observability context keys always make it into the Sentry event under `extra`, even if
    // the caller provided their own `extra` data in `context`
    errorContext = {
      extra: { ...obsContext, ...extraFromContext },
    };
  }

  // add any `ResponseError`-specific context
  if ((e as any).response) {
    const errorResponse = (e as ResponseError).response;
    errorContext = {
      ...errorContext,
      contexts: {
        response: {
          status_code: errorResponse.status,
          headers: {
            [SIDECAR_CONNECTION_ID_HEADER]:
              errorResponse.headers.get(SIDECAR_CONNECTION_ID_HEADER) ?? "",
          },
        },
      },
    };
  }

  // merge any other context provided by the caller
  return { ...errorContext, ...otherContext };
}
