/**
 * Environment detection utilities.
 *
 * Detects whether the extension is running in a desktop VS Code environment
 * (with full Node.js access) or VS Code for Web (limited to web APIs).
 */

import * as vscode from "vscode";

/**
 * Detects whether the extension is running in a desktop VS Code environment.
 *
 * Uses the VS Code `env.uiKind` API to determine the environment:
 * - `UIKind.Desktop`: Running in desktop VS Code with full Node.js access
 * - `UIKind.Web`: Running in VS Code for Web (browser context)
 *
 * Desktop environment has access to Node.js modules like `net` which are required
 * for kafkajs to establish TCP connections to Kafka brokers.
 *
 * VS Code for Web runs in a browser context and cannot use kafkajs directly,
 * requiring fallback to REST API for Kafka operations.
 *
 * @returns true if running in desktop VS Code, false if running in VS Code for Web.
 */
export function isDesktopEnvironment(): boolean {
  return vscode.env.uiKind === vscode.UIKind.Desktop;
}

/**
 * Detects whether the extension is running in VS Code for Web.
 *
 * @returns true if running in VS Code for Web, false if running in desktop VS Code.
 */
export function isWebEnvironment(): boolean {
  return vscode.env.uiKind === vscode.UIKind.Web;
}
