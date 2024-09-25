import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { CCloudEnvironment } from "../models/environment";
import { environmentQuickPick } from "../quickpicks/environments";

async function renameEnvironmentCommand(item?: CCloudEnvironment | undefined) {
  // If the command was triggered through the command palette, `item` will be undefined, so we
  // need to prompt the user for the environment.
  const environment: CCloudEnvironment | undefined =
    item instanceof CCloudEnvironment ? item : await environmentQuickPick();
  if (!environment) {
    return;
  }

  // TODO: fix this once we can update CCloud environments via the sidecar
  vscode.window.showInformationMessage("COMING SOON: Renaming environments is not yet supported.");
}

export function registerEnvironmentCommands(): vscode.Disposable[] {
  return [registerCommandWithLogging("confluent.resources.item.rename", renameEnvironmentCommand)];
}
