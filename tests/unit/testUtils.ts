import * as vscode from "vscode";
import { EXTENSION_ID } from "../../src/constants";
import { setExtensionContext } from "../../src/context/extension";
import { Logger } from "../../src/logging";
import { StorageManager } from "../../src/storage";

<<<<<<< HEAD
const logger = new Logger("testUtils");
=======
const logger = new Logger("tests.testUtils");
>>>>>>> origin/main

/**
 * Convenience function to get the extension.
 * @remarks This does not activate the extension, so the {@link vscode.ExtensionContext} will not be
 * available. Use {@link getAndActivateExtension} to activate the extension, or
 * {@link getTestExtensionContext} to get the context directly.
 * @param id The extension ID to get. Defaults to the Confluent extension.
 * @returns A {@link vscode.Extension} instance.
 */
export async function getExtension(id: string = EXTENSION_ID): Promise<vscode.Extension<any>> {
  const extension = vscode.extensions.getExtension(id);
  if (!extension) {
    throw new Error(`Extension with ID "${id}" not found`);
  }
  return extension;
}

/**
 * Convenience function to get and activate the extension.
 * @param id The extension ID to activate. Defaults to the Confluent extension.
 * @returns A {@link vscode.Extension} instance.
 */
export async function getAndActivateExtension(
  id: string = EXTENSION_ID,
): Promise<vscode.Extension<any>> {
  logger.info(`Activating extension with ID "${id}"`);
  const extension = await getExtension(id);
  if (!extension.isActive) {
    logger.info(`Activating extension: ${id}`);
    await extension.activate();
  } else {
    logger.info(`Extension already activated: ${id}`);
  }
  return extension;
}

/**
 * Convenience function to get the extension context for testing.
 * @returns A {@link vscode.ExtensionContext} instance.
 */
export async function getTestExtensionContext(
  id: string = EXTENSION_ID,
): Promise<vscode.ExtensionContext> {
  const extension = await getAndActivateExtension(id);
  // this only works because we explicitly return the ExtensionContext in our activate() function
  const context = extension.exports;
  logger.info(`Setting the global extension context with context ${context}`);
  setExtensionContext(context);
  logger.info("Returning from getExtensionContext()");
  return context;
}

export async function getTestStorageManager(): Promise<StorageManager> {
  // the extension needs to be activated before we can use the StorageManager
<<<<<<< HEAD
  logger.info("Getting test StorageManager");
  await getExtensionContext();
  logger.info("Got extension context, returning StorageManager.getInstance()");
=======
  await getTestExtensionContext();
>>>>>>> origin/main
  return StorageManager.getInstance();
}
