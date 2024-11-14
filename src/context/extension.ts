import { type ExtensionContext } from "vscode";

let context: ExtensionContext;

export function setExtensionContext(value: ExtensionContext) {
  context = value;
}

export function getExtensionContext(): ExtensionContext {
  return context;
}
