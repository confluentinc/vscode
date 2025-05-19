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
