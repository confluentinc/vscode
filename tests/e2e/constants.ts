const VSCODE_VERSION = process.env.VSCODE_VERSION || "stable";
export const URI_SCHEME = VSCODE_VERSION === "insiders" ? "vscode-insiders" : "vscode";

/** Whether to show debug logs from the end-to-end tests. */
export const DEBUG_LOGGING_ENABLED = process.env.E2E_DEBUG_LOGGING === "true";
