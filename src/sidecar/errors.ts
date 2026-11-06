import type { SidecarStartupFailureReason } from "./types";

/** Sidecar is not currently running (better start a new one!) */
export class NoSidecarRunningError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Sidecar could not start up successfully, annotated with determined reason. */
export class SidecarFatalError extends Error {
  public reason: SidecarStartupFailureReason;
  constructor(reason: SidecarStartupFailureReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 *  If the auth token we have on record for the sidecar is rejected, will need to
 * restart it. Fortunately it tells us its PID in the response headers, so we know
 * what to kill.
 */
export class WrongAuthSecretError extends Error {
  public sidecar_process_id: number;

  constructor(message: string, sidecar_process_id: number) {
    super(message);
    this.sidecar_process_id = sidecar_process_id;
  }
}

/** A request gave up waiting for an expired Confluent Cloud session to reconnect. */
export class CCloudReconnectTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CCloudReconnectTimeoutError";
  }
}

/** The sidecar's `errors[].code` for an upstream request that timed out. */
const PROXY_TIMEOUT_CODE = "proxy_timeout";

/**
 * A readable message for a sidecar response that reports a timeout, or undefined for any other
 * error. A proxy timeout (`errors[0].code` of `proxy_timeout`) keeps the sidecar's title, which
 * names the host. A bare 504 names `target` instead.
 */
export function sidecarTimeoutMessage(status: 504, body: unknown, target: string): string;
export function sidecarTimeoutMessage(
  status: number,
  body: unknown,
  target: string,
): string | undefined;
export function sidecarTimeoutMessage(
  status: number,
  body: unknown,
  target: string,
): string | undefined {
  const failure = isRecord(body) ? body : {};
  const firstError = Array.isArray(failure.errors) ? failure.errors[0] : undefined;
  const isProxyTimeout = isRecord(firstError) && firstError.code === PROXY_TIMEOUT_CODE;
  if (!isProxyTimeout && status !== 504) {
    return undefined;
  }
  if (isProxyTimeout && typeof failure.title === "string" && failure.title) {
    return failure.title;
  }
  return timedOutWaitingFor(target);
}

/** The user-facing message for a timeout that names only what was being waited on. */
export function timedOutWaitingFor(target: string): string {
  return `Timed out waiting for ${target}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
