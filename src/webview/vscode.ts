// https://code.visualstudio.com/api/extension-guides/webview#passing-messages-from-a-webview-to-an-extension
// @ts-expect-error 2304 this thing is coming from vscode parent host
const vscode = acquireVsCodeApi();

export function getState(): unknown {
  return vscode.getState();
}

export function setState(state: unknown): void {
  return vscode.setState(state);
}

export function postMessage(message: any, transfer?: Transferable[]): void {
  return vscode.postMessage(message, transfer);
}
