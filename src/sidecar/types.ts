/** @see https://quarkus.io/guides/logging#logging-format */
export interface SidecarLogFormat {
  timestamp: string;
  sequence: number;
  loggerClassName: string; // usually "org.jboss.logging.Logger"
  loggerName: string;
  level: string;
  message: string;
  threadName: string;
  threadId: number;
  mdc: Record<string, unknown>;
  ndc: string;
  hostName: string;
  processName: string;
  processId: number;
}

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

/** Annotates a SidecarFatalError with our guess as to the reason */
export enum SidecarStartupFailureReason {
  /** Some other process camped out on {@see SIDECAR_PORT} */
  PORT_IN_USE = "PORT_IN_USE",
  CANNOT_KILL_OLD_PROCESS = "CANNOT_KILL_OLD_PROCESS",
  SPAWN_RESULT_UNDEFINED_PID = "SPAWN_RESULT_UNDEFINED_PID",
  OLD_SIDECAR_DID_NOT_SEND_PID = "OLD_SIDECAR_DID_NOT_SEND_PID",

  WRONG_ARCHITECTURE = "WRONG_ARCHITECTURE",

  /** No discernable reason */
  UNKNOWN = "UNKNOWN",
}
