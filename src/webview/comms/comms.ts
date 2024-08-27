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

let vscode: any;
/**
 * Sends a payload that contains a message with special label to the host
 * environment and returns a Promise that contains the result from the host.
 *
 * @remark this function should be used in the webview environment.
 */
export function sendWebviewMessage(type: any, body: any) {
  // https://code.visualstudio.com/api/extension-guides/webview#passing-messages-from-a-webview-to-an-extension
  // @ts-expect-error 2304 this thing is coming from vscode parent host
  if (vscode == null) vscode = acquireVsCodeApi();
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
