// constants needed in multiple modules for use within sidecar comms / management

export const SIDECAR_PORT: number = 26636;

export const SIDECAR_BASE_URL: string =
  process.env.SIDECAR_BASE_URL || `http://127.0.0.1:${SIDECAR_PORT}`;

export const SIDECAR_CURRENT_CONNECTION_ID_HEADER: string = "x-connection-id"; // Header name for the sidecar's current connection ID in the request headers.
export const WORKSPACE_PROCESS_ID_HEADER: string = "x-workspace-process-id"; // Header name for the workspace's PID in the request headers.

export const ENABLE_REQUEST_RESPONSE_LOGGING: boolean =
  process.env.ENABLE_REQUEST_RESPONSE_LOGGING === "true";

// Header name for the sidecar's PID in the response headers.
export const SIDECAR_PROCESS_ID_HEADER = "x-sidecar-pid";
