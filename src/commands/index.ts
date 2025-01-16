import * as Sentry from "@sentry/node";
import * as vscode from "vscode";
import { showErrorNotificationWithButtons } from "../errors";
import { Logger } from "../logging";
import { UserEvent, logUsage } from "../telemetry/events";

const logger = new Logger("commands");

export function registerCommandWithLogging(
  commandName: string,
  command: (...args: any[]) => void,
): vscode.Disposable {
  const wrappedCommand = async (...args: any[]) => {
    logUsage(UserEvent.CommandInvoked, { command: commandName });
    try {
      await command(...args);
    } catch (e) {
      const msg = `Error invoking command "${commandName}":`;
      logger.error(msg, e);
      if (e instanceof Error) {
        // capture error with Sentry (only enabled in production builds)
        Sentry.captureException(e, { tags: { command: commandName } });
        // also show error notification to the user
        showErrorNotificationWithButtons(`${msg} ${e.message}`);
      }
    }
  };
  return vscode.commands.registerCommand(commandName, wrappedCommand);
}
