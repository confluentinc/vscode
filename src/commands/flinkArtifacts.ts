import { Disposable } from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { flinkArtifactUDFViewMode } from "../emitters";
import { FlinkArtifactsViewProviderMode } from "../viewProviders/multiViewDelegates/constants";

export async function setFlinkArtifactsViewModeCommand() {
  flinkArtifactUDFViewMode.fire(FlinkArtifactsViewProviderMode.Artifacts);
  await setContextValue(
    ContextValues.flinkArtifactsUDFsViewMode,
    FlinkArtifactsViewProviderMode.Artifacts,
  );
}

export function registerFlinkArtifactCommands(): Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.flink.setArtifactsViewMode",
      setFlinkArtifactsViewModeCommand,
    ),
  ];
}
