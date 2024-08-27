import * as Sentry from "@sentry/node";
import * as vscode from "vscode";
import { Logger } from "../logging";
import { getTelemetryLogger } from "../telemetry";

const logger = new Logger("registered-commands");

export function registerCommandWithLogging(
  commandName: string,
  command: (...args: any[]) => void,
): vscode.Disposable {
  const wrappedCommand = async (...args: any[]) => {
    getTelemetryLogger().logUsage("Command Invoked", { command: commandName });
    try {
      await command(...args);
    } catch (e) {
      logger.error(`Error invoking command "${commandName}"`, e);
      // In production, log error invocation in Sentry also
      if (process.env.NODE_ENV === "production") Sentry.captureException(e);
    }
  };
  return vscode.commands.registerCommand(commandName, wrappedCommand);
}
