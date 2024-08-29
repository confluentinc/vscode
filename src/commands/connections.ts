import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { AUTH_PROVIDER_ID } from "../constants";
import { Logger } from "../logging";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("commands.connections");

/**
 * Allow creating a session via the auth provider outside of the Accounts section of the VS Code UI.
 * @remarks Depending on the outcome of the auth flow, this will also update the auth flow completed
 * "secret" to either "true" or "false" to signal across windows that the auth flow has completed.
 */
async function createConnectionCommand() {
  const resourceManager = getResourceManager();
  try {
    await vscode.authentication.getSession(AUTH_PROVIDER_ID, [], {
      createIfNone: true,
    });
    await resourceManager.setAuthFlowCompleted(true);
  } catch (error) {
    if (error instanceof Error) {
      logger.error("error handling CCloud auth flow", { error });
      await resourceManager.setAuthFlowCompleted(false);
      throw new Error("Failed to create new connection. Please try again.");
    }
  }
}

export const commands = [
  registerCommandWithLogging("confluent.connections.create", createConnectionCommand),
];
