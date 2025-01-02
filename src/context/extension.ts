import { type ExtensionContext } from "vscode";
import { Logger } from "../logging";

const logger = new Logger("context.extension");

let context: ExtensionContext;

export function setExtensionContext(value: ExtensionContext) {
  logger.info(`Setting extension context: ${value}`);
  context = value;
}

export function getExtensionContext(): ExtensionContext {
  logger.info(`Getting extension context: ${context}`);
  return context;
}
