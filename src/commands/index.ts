import * as vscode from "vscode";
import { logResponseError, showErrorNotificationWithButtons } from "../errors";
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
      if (e instanceof Error) {
        // gather more (possibly-ResponseError) context and send to Sentry (only enabled in
        // production builds)
        logResponseError(e, msg, { command: commandName }, true);
        // also show error notification to the user with default buttons
        showErrorNotificationWithButtons(`${msg} ${e}`);
      }
    }
  };
  return vscode.commands.registerCommand(commandName, wrappedCommand);
}
