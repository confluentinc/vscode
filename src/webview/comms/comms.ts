import { type Disposable, type Webview } from "vscode";

/**
 * Interface for a logger that can receive webview log messages.
 * Compatible with the extension's Logger class.
 * @remark this interface is used in the host environment.
 */
export interface WebviewLogReceiver {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Handles messages coming from a webview in special format, uses processing
 * function to compute the result which then is sent back to the webview.
 *
 * @remark this function should be used in the host environment.
 */
export function handleWebviewMessage(
  webview: Webview,
  processMessage: (type: any, body: any) => any,
) {
  return webview.onDidReceiveMessage(async (event) => {
    const [id, type, body] = event;
    try {
      const response = processMessage(type, body);
      const result = response instanceof Promise ? await response : response;
      return webview.postMessage([id, "Success", result]);
    } catch (error) {
      const message = error instanceof Error ? error.message : JSON.stringify(error);
      return webview.postMessage([id, "Failure", message]);
    }
  });
}

/**
 * Sets up forwarding of webview console logs to an extension-side logger.
 * Call this in addition to handleWebviewMessage to receive log messages.
 *
 * @param webview - The webview to receive logs from
 * @param logger - A logger instance (e.g., new Logger("webview.myComponent"))
 * @returns A disposable to stop listening for log messages
 * @remark this function should be used in the host environment.
 */
export function handleWebviewLogs(webview: Webview, logger: WebviewLogReceiver): Disposable {
  return webview.onDidReceiveMessage((event) => {
    // Log messages use the format: ["__log__", level, message, args]
    if (!Array.isArray(event) || event[0] !== "__log__") {
      return; // Not a log message, ignore
    }

    const [, level, message] = event as [string, string, string, unknown[]];
    const logMethod = logger[level as keyof WebviewLogReceiver];
    if (typeof logMethod === "function") {
      logMethod.call(logger, `[webview] ${message}`);
    }
  });
}

/**
 * Sends a payload that contains a message with special label to the host
 * environment and returns a Promise that contains the result from the host.
 *
 * @link https://code.visualstudio.com/api/extension-guides/webview#passing-messages-from-a-webview-to-an-extension
 * @remark this function should be used in the webview environment.
 */
export function sendWebviewMessage(type: any, body: any) {
  const vscode = api();
  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(16).slice(2);
    addEventListener("message", function handle(event) {
      const [responseId, type, message] = event.data;
      if (responseId === requestId) {
        removeEventListener("message", handle);
        if (type === "Success") resolve(message);
        else if (type === "Failure") reject(new Error(message));
        else throw new Error(`Unknown response type ${type}`);
      }
    });
    vscode.postMessage([requestId, type, body]);
  });
}

export type WebviewStorage<T> = {
  get: () => T | undefined;
  set: (state: T) => void;
};

/**
 * Provides get/set methods to store arbitrary serializable data in webview's
 * persistent storage. The storage is sync and useful for things that need to
 * be restored when the tab is focused after being hidden. When disposing the
 * webview, storage gets cleaned up as well.
 *
 * @link https://code.visualstudio.com/api/extension-guides/webview#getstate-and-setstate
 * @remark this function should be used in the webview environment.
 */
export function createWebviewStorage<T>(): WebviewStorage<T> {
  const vscode = api();
  return {
    get: (): T | undefined => vscode.getState(),
    set: (state: T): void => vscode.setState(state),
  };
}

let vscode: any;
function api() {
  // @ts-expect-error 2304 this thing is coming from vscode parent host
  if (vscode == null) vscode = acquireVsCodeApi();
  return vscode;
}

/**
 * Log levels that can be sent from webview to extension.
 * @remark this type is used in both webview and extension environments.
 */
export type WebviewLogLevel = "trace" | "debug" | "info" | "warn" | "error";

/**
 * Sends a log message from the webview to the extension.
 * This is fire-and-forget - no response is expected.
 *
 * @remark this function should be used in the webview environment.
 */
export function sendWebviewLog(level: WebviewLogLevel, message: string, ...args: unknown[]): void {
  const vscode = api();
  // Use a special message format that won't be confused with request/response messages
  vscode.postMessage(["__log__", level, message, args]);
}

/**
 * Installs console method overrides that forward logs to the extension.
 * Original console methods are preserved and still called.
 *
 * @remark this function should be used in the webview environment.
 */
export function installWebviewLogForwarding(): void {
  const originalConsole = {
    log: console.log.bind(console),
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const formatArgs = (...args: unknown[]): string => {
    return args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      })
      .join(" ");
  };

  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    sendWebviewLog("info", formatArgs(...args));
  };

  console.debug = (...args: unknown[]) => {
    originalConsole.debug(...args);
    sendWebviewLog("debug", formatArgs(...args));
  };

  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    sendWebviewLog("info", formatArgs(...args));
  };

  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    sendWebviewLog("warn", formatArgs(...args));
  };

  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    sendWebviewLog("error", formatArgs(...args));
  };
}
