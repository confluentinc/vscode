import * as vscode from "vscode";
import { logResponseError, showErrorNotificationWithButtons } from "../errors";
import { UserEvent, logUsage } from "../telemetry/events";

export function registerCommandWithLogging(
  commandName: string,
  command: (...args: any[]) => void,
): vscode.Disposable {
  const wrappedCommand = async (...args: any[]) => {
    logUsage(UserEvent.CommandInvoked, { command: commandName });
    try {
      await command(...args);
    } catch (e) {
      if (e instanceof Error) {
        // gather more (possibly-ResponseError) context and send to Sentry (only enabled in
        // production builds)
        logResponseError(e, `${commandName}`, { command: commandName }, true);
        // also show error notification to the user with default buttons
        showErrorNotificationWithButtons(`Error invoking command "${commandName}": ${e}`);
      }
    }
  };
  return vscode.commands.registerCommand(commandName, wrappedCommand);
}
