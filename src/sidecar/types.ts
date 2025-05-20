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

export interface SidecarOutputs {
  /** Reformatted log lines from the sidecar */
  logLines: string[];
  /** The parsed-from-JSON log lines from the sidecar */
  parsedLogLines: SidecarLogFormat[];
  /** sidecar stderr lines */
  stderrLines: string[];
}

/** Annotates a SidecarFatalError with our guess as to the reason */
export enum SidecarStartupFailureReason {
  /** Trying to hit the healthcheck route returned 404.
   * Some sort of http server is on the port, but not the sidecar.
   */
  NON_SIDECAR_HTTP_SERVER = "NON_SIDECAR_HTTP_SERVER",

  /** Quarkus startup logs indicated some other process camped out on {@see SIDECAR_PORT}. */
  PORT_IN_USE = "PORT_IN_USE",

  /** Error when trying to kill() uncooperative or wrong-version running sidecar. */
  CANNOT_KILL_OLD_PROCESS = "CANNOT_KILL_OLD_PROCESS",

  /** spawn() raised an error */
  SPAWN_ERROR = "SPAWN_ERROR",

  /** Sidecar process was started, but did not return a PID */
  SPAWN_RESULT_UNDEFINED_PID = "SPAWN_RESULT_UNDEFINED_PID",

  /** Could not find sidecar executable */
  MISSING_EXECUTABLE = "MISSING_EXECUTABLE",

  /** Sidecar file is for the wrong architecture */
  WRONG_ARCHITECTURE = "WRONG_ARCHITECTURE",

  /** Handshake failed after many attempts */
  HANDSHAKE_FAILED = "HANDSHAKE_FAILED",

  /** Exceeded MAX_ATTEMPTS */
  MAX_ATTEMPTS_EXCEEDED = "MAX_ATTEMPTS_EXCEEDED",

  /** No discernable reason */
  UNKNOWN = "UNKNOWN",
}
