import * as vscode from "vscode";
import { logError } from "../errors";
import {
  checkForExtensionDisabledReason,
  showExtensionDisabledNotification,
} from "../featureFlags/evaluation";
import { IResourceBase, isResource } from "../models/resource";
import { showErrorNotificationWithButtons } from "../notifications";
import { UserEvent, logUsage } from "../telemetry/events";
import { titleCase } from "../utils";

export function registerCommandWithLogging(
  commandName: string,
  command: (...args: any[]) => void,
): vscode.Disposable {
  const wrappedCommand = async (...args: any[]) => {
    // if the extension was disabled, we need to prevent any commands from running and show an error
    // notification to the user
    const disabledMessage: string | undefined = await checkForExtensionDisabledReason();
    if (disabledMessage) {
      showExtensionDisabledNotification(disabledMessage);
      return;
    }

    logUsage(UserEvent.CommandInvoked, {
      command: commandName,
      ...getCommandArgsContext(args),
    });
    try {
      return command(...args);
    } catch (e) {
      if (e instanceof Error) {
        // gather more (possibly-ResponseError) context and send to Sentry (only enabled in
        // production builds)
        logError(e, `${commandName}`, { extra: { command: commandName } });
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
      const idFieldTitleCase = titleCase(idField);
      argsContext[`resource${idFieldTitleCase}`] = args[0][idField];
    }
  }

  return argsContext;
}
