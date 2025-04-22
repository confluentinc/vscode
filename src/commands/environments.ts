import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { currentFlinkStatementsResourceChanged } from "../emitters";
import { CCloudEnvironment } from "../models/environment";
import { flinkCcloudEnvironmentQuickPick } from "../quickpicks/environments";
import { FlinkStatementsViewProvider } from "../viewProviders/flinkStatements";

async function setFlinkStatementsEnvironmentCommand(item?: CCloudEnvironment): Promise<void> {
  // ensure whatever was passed in is a CCloudEnvironment; if not, prompt the user to pick one
  const env: CCloudEnvironment | undefined =
    item instanceof CCloudEnvironment
      ? item
      : await FlinkStatementsViewProvider.getInstance().withProgress(
          "Select Environment",
          flinkCcloudEnvironmentQuickPick,
        );
  if (!env) {
    return;
  }

  // Inform the Flink Statements view that the user has selected a new environment.
  // This will cause the view to repaint itself with the new environment's statements.
  currentFlinkStatementsResourceChanged.fire(env);

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
