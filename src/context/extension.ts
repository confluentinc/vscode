import { type ExtensionContext } from "vscode";
import { Logger } from "../logging";

const logger = new Logger("context.extension");

let context: ExtensionContext | undefined;

export function setExtensionContext(value: ExtensionContext) {
  logger.info(`Setting extension context: ${value}`);
  context = value;
}

export function getExtensionContext(): ExtensionContext {
  return context!;
}

// XXX: should not be used outside of test environments
export function clearExtensionContext() {
  context = undefined;
}
