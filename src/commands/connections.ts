import { Disposable } from "vscode";
import { registerCommandWithLogging } from ".";
import { Logger } from "../logging";
import { getCCloudAuthSession } from "../sidecar/connections";

const logger = new Logger("commands.connections");

/** Allow CCloud sign-in via the auth provider outside of the Accounts section of the VS Code UI. */
async function createConnectionCommand() {
  try {
    await getCCloudAuthSession(true);
  } catch (error) {
    logger.error("error creating CCloud connection", { error });
    if (error instanceof Error) {
      // if the user clicks "Cancel" on the modal before the sign-in process, we don't need to do anything
      if (error.message === "User did not consent to login.") {
        return;
      }
      // any other errors will be caught by the error handler in src/commands/index.ts as part of the
      // registerCommandWithLogging wrapper
      throw error;
    }
  }
}

export function registerConnectionCommands(): Disposable[] {
  return [registerCommandWithLogging("confluent.connections.create", createConnectionCommand)];
}
