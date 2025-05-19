import { SidecarStartupFailureReason } from "./types";

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

/** Could not find the sidecar executable. */
export class NoSidecarExecutableError extends Error {
  constructor(message: string) {
    super(message);
  }
}
