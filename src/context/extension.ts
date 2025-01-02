import { type ExtensionContext } from "vscode";

let context: ExtensionContext | undefined;

export function setExtensionContext(value: ExtensionContext) {
  context = value;
}

export function getExtensionContext(): ExtensionContext {
  return context!;
}

// XXX: should not be used outside of test environments
export function clearExtensionContext() {
  context = undefined;
}
