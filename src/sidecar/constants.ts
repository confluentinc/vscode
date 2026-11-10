/** Constants needed in multiple modules for use within sidecar comms / management */

export const SIDECAR_PORT: number = 26636;

export const SIDECAR_BASE_URL: string =
  process.env.SIDECAR_BASE_URL || `http://127.0.0.1:${SIDECAR_PORT}`;

/** Header used to tell the sidecar which connection ID to use in the request, if applicable. */
export const SIDECAR_CONNECTION_ID_HEADER: string = "x-connection-id";

/** Header used to specify a given (Kafka, Schema Registry, etc) cluster ID, if applicable */
export const CLUSTER_ID_HEADER: string = "x-cluster-id";

/** Header used to specify the Confluent Cloud environment, if applicable */
export const CCLOUD_ENV_ID_HEADER: string = "x-ccloud-env-id";

/** Header used to specify which cloud provider */
export const CCLOUD_PROVIDER_HEADER: string = "x-ccloud-provider";

/** Header used to specify a ccloud-supported region within a provider */
export const CCLOUD_REGION_HEADER: string = "x-ccloud-region";

/** Enable the middleware that emits debug logs for every request to / response from the sidecar. */
export const ENABLE_REQUEST_RESPONSE_LOGGING: boolean =
  process.env.ENABLE_REQUEST_RESPONSE_LOGGING === "true";
/** Header name for the sidecar's PID in the response headers. */
export const SIDECAR_PROCESS_ID_HEADER = "x-sidecar-pid";

/** File name for the raw JSON version of the sidecar logs. */
export const SIDECAR_LOGFILE_NAME = "vscode-confluent-sidecar.log";

/** File name for the human-readable formatted version of the sidecar logs. */
export const SIDECAR_FORMATTED_LOGFILE_NAME = "vscode-confluent-sidecar-formatted.log";

export const MOMENTARY_PAUSE_MS = 500; // half a second.

/** Per-attempt budget for a sidecar REST call, above the sidecar's own ~20s upstream timeout. */
export const SIDECAR_REQUEST_TIMEOUT_MS = 30_000;
export const FLINK_RESULTS_TIMEOUT_MS = 60_000;
/** Above the sidecar's 60s CCloud consume hold, plus its follow-up schema fetches. */
export const CONSUME_TIMEOUT_MS = 120_000;
/** The sidecar may run two 40s-capped fetches in a row to answer one query, so up to 80s. */
export const GRAPHQL_TIMEOUT_MS = 90_000;
/**
 * How long a request waits for an expired CCloud session to reconnect before failing. Long enough
 * for one more sidecar token refresh: up to 5s of backoff, its 90s deadline, then a 5s status check.
 */
export const CCLOUD_RECONNECT_TIMEOUT_MS = 120_000;
/** The Scaffolding service's template listing (direct to Confluent Cloud, not via the sidecar). */
export const SCAFFOLDING_LIST_TIMEOUT_MS = 15_000;
/** Applying a template, which builds and returns the project as a ZIP. */
export const SCAFFOLDING_APPLY_TIMEOUT_MS = 60_000;
