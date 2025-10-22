import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { flinkDatabaseViewMode } from "../emitters";
import { FlinkDatabaseViewProviderMode } from "../viewProviders/multiViewDelegates/constants";

export function registerFlinkDatabaseViewCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.flinkdatabase.setRelationsViewMode",
      setFlinkRelationsViewModeCommand,
    ),
  ];
}

export async function setFlinkRelationsViewModeCommand() {
  flinkDatabaseViewMode.fire(FlinkDatabaseViewProviderMode.Relations);
  await setContextValue(
    ContextValues.flinkDatabaseViewMode,
    FlinkDatabaseViewProviderMode.Relations,
  );
}
