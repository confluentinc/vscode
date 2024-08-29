import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { AUTH_PROVIDER_ID } from "../constants";
import { Logger } from "../logging";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("commands.connections");

/** Allow creating a session via the auth provider outside of the Accounts section of the VS Code UI. */
async function createConnectionCommand() {
  const resourceManager = getResourceManager();
  try {
    await vscode.authentication.getSession(AUTH_PROVIDER_ID, [], {
      createIfNone: true,
    });
    resourceManager.setAuthFlowCompleted(true);
  } catch (error) {
    logger.error("error handling CCloud auth flow", error);
    resourceManager.setAuthFlowCompleted(false);
    throw new Error("Failed to create new connection. Please try again.");
  }
}

export const commands = [
  registerCommandWithLogging("confluent.connections.create", createConnectionCommand),
];
