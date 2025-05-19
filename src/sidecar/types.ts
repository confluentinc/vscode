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
