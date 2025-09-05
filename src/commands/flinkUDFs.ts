import { Disposable } from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { flinkArtifactUDFViewMode } from "../emitters";
import { FlinkArtifactsViewProviderMode } from "../viewProviders/multiViewDelegates/constants";

export async function setFlinkUDFViewModeCommand() {
  flinkArtifactUDFViewMode.fire(FlinkArtifactsViewProviderMode.UDFs);
  await setContextValue(ContextValues.flinkDatabaseViewMode, FlinkArtifactsViewProviderMode.UDFs);
}

export function registerFlinkUDFCommands(): Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.flinkdatabase.setUDFsViewMode",
      setFlinkUDFViewModeCommand,
    ),
  ];
}
