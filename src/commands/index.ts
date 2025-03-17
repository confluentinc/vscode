import * as vscode from "vscode";
import { logError, showErrorNotificationWithButtons } from "../errors";
import { IResourceBase, isResource } from "../models/resource";
import { UserEvent, logUsage } from "../telemetry/events";

export function registerCommandWithLogging(
  commandName: string,
  command: (...args: any[]) => void,
): vscode.Disposable {
  const wrappedCommand = async (...args: any[]) => {
    logUsage(UserEvent.CommandInvoked, {
      command: commandName,
      ...getCommandArgsContext(args),
    });
    try {
      await command(...args);
    } catch (e) {
      if (e instanceof Error) {
        // gather more (possibly-ResponseError) context and send to Sentry (only enabled in
        // production builds)
        logError(e, `${commandName}`, { command: commandName }, true);
        // also show error notification to the user with default buttons
        showErrorNotificationWithButtons(`Error invoking command "${commandName}": ${e}`);
      }
    }
  };
  return vscode.commands.registerCommand(commandName, wrappedCommand);
}

// TODO: move this somewhere else if we need it other than telemetry:
export const RESOURCE_ID_FIELDS = ["id", "environmentId", "clusterId", "schemaRegistryId"];

/** Checks if the first argument for a command function includes basic resource context for
 * telemetry (e.g. `connectionType`, `id`, `environmentId`, etc.). */
export function getCommandArgsContext(args: any[]): Record<string, any> {
  const argsContext: Record<string, any> = {};
  if (!args.length) {
    return argsContext;
  }
  if (!args[0]) {
    // bail if first arg is undefined or null
    return argsContext;
  }

  if (isResource(args[0])) {
    const resourceArg: IResourceBase = args[0];
    argsContext["resourceConnectionType"] = resourceArg.connectionType;
  }
  for (const idField of RESOURCE_ID_FIELDS) {
    if (args[0][idField] !== undefined) {
      // e.g. "environmentId" to "EnvironmentId"
      const idFieldTitleCase = idField.charAt(0).toUpperCase() + idField.slice(1);
      argsContext[`resource${idFieldTitleCase}`] = args[0][idField];
    }
  }

  return argsContext;
}
