const VSCODE_VERSION = process.env.VSCODE_VERSION || "stable";
export const URI_SCHEME = VSCODE_VERSION === "insiders" ? "vscode-insiders" : "vscode";
