import { Disposable } from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { flinkDatabaseViewMode } from "../emitters";
import { FlinkDatabaseViewProviderMode } from "../viewProviders/multiViewDelegates/constants";

export async function setFlinkUDFViewModeCommand() {
  flinkDatabaseViewMode.fire(FlinkDatabaseViewProviderMode.UDFs);
  await setContextValue(ContextValues.flinkDatabaseViewMode, FlinkDatabaseViewProviderMode.UDFs);
}

export function registerFlinkUDFCommands(): Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.flinkdatabase.setUDFsViewMode",
      setFlinkUDFViewModeCommand,
    ),
  ];
}
