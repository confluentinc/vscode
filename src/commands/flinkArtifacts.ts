import vscode, { Disposable } from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { flinkArtifactUDFViewMode } from "../emitters";
import { FlinkArtifact } from "../models/flinkArtifact";
import { FlinkArtifactsViewProviderMode } from "../viewProviders/multiViewDelegates/constants";

/**Open a new tab set to Flink SQL type with placeholder Flink UDF registration statement for selected artifact */
export async function queryArtifactWithFlink(selectedArtifact: FlinkArtifact | undefined) {
  const placeholderQuery = `-- Register UDF for artifact "${selectedArtifact?.name}"
-- Replace this with your actual Flink SQL UDF registration statement

CREATE FUNCTION "${selectedArtifact?.name}"
  AS 'com.example.udf.${selectedArtifact?.name}'
  USING JAR 'confluent-artifact://<plugin-id>/<version-id>';
`;

  const document = await vscode.workspace.openTextDocument({
    language: "flinksql",
    content: placeholderQuery,
  });

  await vscode.window.showTextDocument(document, { preview: false });
}

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
    registerCommandWithLogging("confluent.artifacts.query", queryArtifactWithFlink),
  ];
}
