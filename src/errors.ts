import type { ScopeContext } from "@sentry/core";
import { ResponseError as DockerResponseError } from "./clients/docker";
import { ResponseError as FlinkArtifactsResponseError } from "./clients/flinkArtifacts";
import { ResponseError as FlinkComputePoolResponseError } from "./clients/flinkComputePool";
import { ResponseError as FlinkSqlResponseError } from "./clients/flinkSql";
import { ResponseError as KafkaResponseError } from "./clients/kafkaRest";
import { ResponseError as MedusaResponseError } from "./clients/medusa";
import { ResponseError as ScaffoldingServiceResponseError } from "./clients/scaffoldingService";
import { ResponseError as SchemaRegistryResponseError } from "./clients/schemaRegistryRest";
import { ResponseError as SidecarResponseError } from "./clients/sidecar";
import { Logger } from "./logging";
import { sentryCaptureException } from "./telemetry/sentryClient";

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
  | FlinkArtifactsResponseError
  | FlinkComputePoolResponseError
  | FlinkSqlResponseError
  | MedusaResponseError
  | ScaffoldingServiceResponseError
  | DockerResponseError;

/** Was this an error raised when any of our OpenAPI clients tried to digest a response? */
export function isResponseError(error: unknown): error is AnyResponseError {
  return (
    error instanceof SidecarResponseError ||
    error instanceof KafkaResponseError ||
    error instanceof SchemaRegistryResponseError ||
    error instanceof FlinkArtifactsResponseError ||
    error instanceof FlinkComputePoolResponseError ||
    error instanceof FlinkSqlResponseError ||
    error instanceof MedusaResponseError ||
    error instanceof ScaffoldingServiceResponseError ||
    error instanceof DockerResponseError
  );
}

/** Was this a response error with the given http response code? */
export function isResponseErrorWithStatus(
  error: unknown,
  statusCode: number,
): error is AnyResponseError {
  return isResponseError(error) && error.response.status === statusCode;
}

/** HTTP statuses where repeating the same request after a short delay may succeed. */
const TRANSIENT_RESPONSE_STATUSES = new Set([429, 500, 502, 503, 504]);

/** Was this a response error whose status suggests the request is worth retrying? */
export function isTransientResponseError(error: unknown): error is AnyResponseError {
  return isResponseError(error) && TRANSIENT_RESPONSE_STATUSES.has(error.response.status);
}

/**
 * Decode the body of a {@link Response}, whether passed directly (e.g. from a raw `fetch()`) or
 * wrapped in one of our client {@link AnyResponseError}s.
 *
 * The body is decoded as JSON; if it is not valid JSON, the raw text is returned instead.
 *
 * The caller supplies the expected body shape via the type parameter (defaulting to `unknown`), so
 * downstream code has some idea what to expect rather than an untyped `any`.
 *
 * @throws if given something that is neither a {@link Response} nor an {@link AnyResponseError}.
 */
export async function extractResponseBody<T = unknown>(
  errorOrResponse: AnyResponseError | Response,
): Promise<T> {
  let response: Response;
  if (isResponseError(errorOrResponse)) {
    response = errorOrResponse.response;
  } else if (errorOrResponse instanceof Response) {
    response = errorOrResponse;
  } else {
    throw new Error("extractResponseBody() called with neither a ResponseError nor a Response");
  }

  // Attempt to parse the response body as JSON, falling back to text if it fails
  try {
    const json: unknown = await response.clone().json();
    return json as T;
  } catch {
    const text: unknown = await response.clone().text();
    return text as T;
  }
}

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

/** Error class wrapper with a custom name and message, used for Sentry tracking. */
export class CustomError extends Error {
  constructor(
    public readonly name: string,
    public readonly message: string,
    public readonly cause: Error,
  ) {
    super(message);
    this.name = name;
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
 * @param message Text to add in the logger.error() message and top-level Sentry error message
 * @param sentryContext Optional Sentry context to include with the error
 * */
export function logError(
  e: unknown,
  message: string,
  sentryContext: Partial<ScopeContext> = {},
): void {
  _logError(e, message, sentryContext).catch((err) => {
    logger.error(`Failed to log error: ${err}`, { originalError: String(e) });
  });
}

async function _logError(
  e: unknown,
  message: string,
  sentryContext: Partial<ScopeContext> = {},
): Promise<void> {
  if (!(e instanceof Error)) {
    logger.error(`non-Error passed: ${JSON.stringify(e)}`);
    return;
  }

  let logErrorMessage: string = "";

  /** Light wrapper around the original error, used to update the name/message for easier debugging
   * and event tracking in Sentry. */
  let wrappedError: Error;
  /** Used to add extra/additional data to the Sentry exception */
  let errorContext: Record<string, string | number | boolean | null | undefined> = {};
  /** Used to set the `contexts.response.status_code` for the Sentry exception */
  let responseStatusCode: number | undefined;

  if ((e as AnyResponseError).response) {
    // one of our ResponseError types, attempt to extract more information before logging
    const responseError = e as AnyResponseError;
    const resp: Response = responseError.response;
    const errorBody: string = await resp.clone().text();
    logErrorMessage = `Error response: ${message}`;
    errorContext = {
      responseStatus: resp.status,
      responseStatusText: resp.statusText,
      responseBody: errorBody.slice(0, 5000), // limit to 5000 characters
      responseErrorType: responseError.name,
    };
    responseStatusCode = resp.status;
    wrappedError = new CustomError(
      responseError.name,
      `Error ${resp.status} "${resp.statusText}" @ ${resp.url}: ${message}`,
      responseError,
    );
  } else {
    // non-ResponseError error
    logErrorMessage = `Error: ${message} --> ${e}`;
    errorContext = {
      errorType: e.name,
      errorMessage: e.message,
      errorStack: e.stack,
    };
    wrappedError = new CustomError(e.name, `${message}: ${e.message}`, e);
  }

  // also handle any nested errors from either the ResponseError or (more likely) other Errors
  if (hasErrorCause(e)) {
    const errorChain = getNestedErrorChain(e.cause);
    if (errorChain.length) {
      errorContext = {
        ...errorContext,
        errors: JSON.stringify(errorChain, null, 2),
      };
    }
  }

  logger.error(logErrorMessage, { ...errorContext, ...sentryContext });
  if (Object.keys(sentryContext).length) {
    sentryCaptureException(wrappedError, {
      captureContext: {
        ...sentryContext,
        contexts: {
          ...(sentryContext.contexts ?? {}),
          response: { status_code: responseStatusCode },
        },
        extra: {
          ...(sentryContext.extra ?? {}),
          ...errorContext,
        },
      },
    });
  }
}
