/** Constants needed in multiple modules for use within sidecar comms / management */
import { tmpdir } from "os";
import { join } from "path";

export const SIDECAR_PORT: number = 26636;

export const SIDECAR_BASE_URL: string =
  process.env.SIDECAR_BASE_URL || `http://127.0.0.1:${SIDECAR_PORT}`;

/** Header used to tell the sidecar which connection ID to use in the request, if applicable. */
export const SIDECAR_CONNECTION_ID_HEADER: string = "x-connection-id";

/** Header used to specify a given (Kafka, Schema Registry, etc) cluster ID, if applicable */
export const CLUSTER_ID_HEADER: string = "x-cluster-id";

/** Header used to specify a given topic name, if applicable */
export const TOPIC_NAME_HEADER: string = "topic_name";

/** Enable the middleware that emits debug logs for every request to / response from the sidecar. */
export const ENABLE_REQUEST_RESPONSE_LOGGING: boolean =
  process.env.ENABLE_REQUEST_RESPONSE_LOGGING === "true";
/** Header name for the sidecar's PID in the response headers. */
export const SIDECAR_PROCESS_ID_HEADER = "x-sidecar-pid";

/** OS-independent path to the log file for the sidecar process. */
export const SIDECAR_LOGFILE_PATH = join(tmpdir(), "vscode-confluent-sidecar.log");
