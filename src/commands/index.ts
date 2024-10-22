import * as Sentry from "@sentry/node";
import * as vscode from "vscode";
import { Logger } from "../logging";
import { getTelemetryLogger } from "../telemetry/telemetryLogger";

const logger = new Logger("commands");

export function registerCommandWithLogging(
  commandName: string,
  command: (...args: any[]) => void,
): vscode.Disposable {
  const wrappedCommand = async (...args: any[]) => {
    getTelemetryLogger().logUsage("Command Invoked", { command: commandName });
    try {
      await command(...args);
    } catch (e) {
      const msg = `Error invoking command "${commandName}":`;
      logger.error(msg, e);
      if (e instanceof Error) {
        // capture error with Sentry (only enabled in production builds)
        Sentry.captureException(e, { tags: { command: commandName } });
        // also show error notification to the user
        vscode.window.showErrorMessage(`${msg} ${e.message}`, "Open Logs").then(async (action) => {
          if (action !== undefined) {
            await vscode.commands.executeCommand("confluent.showOutputChannel");
          }
        });
      }
    }
  };
  return vscode.commands.registerCommand(commandName, wrappedCommand);
}
