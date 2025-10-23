import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import { FlinkDatabaseViewProviderMode } from "../viewProviders/multiViewDelegates/constants";

export function registerFlinkDatabaseViewCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.flinkdatabase.setRelationsViewMode",
      setFlinkRelationsViewModeCommand,
    ),

    registerCommandWithLogging(
      "confluent.flinkdatabase.setUDFsViewMode",
      setFlinkUDFViewModeCommand,
    ),

    registerCommandWithLogging(
      "confluent.flinkdatabase.setArtifactsViewMode",
      setFlinkArtifactsViewModeCommand,
    ),
  ];
}
/** Set the Flink Database view to Relations mode */
export async function setFlinkRelationsViewModeCommand() {
  await FlinkDatabaseViewProvider.getInstance().switchMode(FlinkDatabaseViewProviderMode.Relations);
}

/** Set the Flink Database view to UDFs mode */
export async function setFlinkUDFViewModeCommand() {
  await FlinkDatabaseViewProvider.getInstance().switchMode(FlinkDatabaseViewProviderMode.UDFs);
}

/** Set the Flink Database view to Artifacts mode */
export async function setFlinkArtifactsViewModeCommand() {
  await FlinkDatabaseViewProvider.getInstance().switchMode(FlinkDatabaseViewProviderMode.Artifacts);
}
