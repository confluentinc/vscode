import { type Webview } from "vscode";

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
