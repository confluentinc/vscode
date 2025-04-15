import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { currentFlinkStatementsResourceChanged } from "../emitters";
import { CCloudEnvironment } from "../models/environment";
import { flinkCcloudEnvironmentQuickPick } from "../quickpicks/environments";
import { FlinkStatementsViewProvider } from "../viewProviders/flinkStatements";

async function setFlinkStatementsEnvironmentCommand(item?: CCloudEnvironment): Promise<void> {
  // the user gestured either from a ccloud environment in the Resources view, flink statements
  // titlebar, or used the command palette

  if (!item) {
    // the user either used the command palette or the icon in the flink statements titlebar
    // to select a new environment

    // (ccloudEnvironmentQuickPick currently does deep fetch every time (and is slow), so
    //  show progress while it is loading)
    item = await FlinkStatementsViewProvider.getInstance().withProgress(
      "Select Environment",
      flinkCcloudEnvironmentQuickPick,
    );
    if (!item) {
      // aborted the quickpick.
      return;
    }
  }

  if (!(item instanceof CCloudEnvironment)) {
    throw new Error("Called with something other than a CCloudEnvironment");
  }

  // Inform the Flink Statements view that the user has selected a new environment.
  // This will cause the view to repaint itself with the new environment's statements.
  currentFlinkStatementsResourceChanged.fire(item);

  // Focus the Flink Statements view.
  await vscode.commands.executeCommand("confluent-flink-statements.focus");
}

export function registerEnvironmentCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.resources.ccloudenvironment.viewflinkstatements",
      setFlinkStatementsEnvironmentCommand,
    ),
  ];
}
