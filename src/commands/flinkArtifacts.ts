import { Disposable, SnippetString, window, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { flinkArtifactUDFViewMode as flinkDatabaseViewMode } from "../emitters";
import { FlinkArtifact } from "../models/flinkArtifact";
import { FlinkArtifactsViewProviderMode } from "../viewProviders/multiViewDelegates/constants";

export async function queryArtifactWithFlink(selectedArtifact: FlinkArtifact | undefined) {
  if (!selectedArtifact) {
    return;
  }
  const snippetString = new SnippetString()
    .appendText(`-- Register UDF for artifact "${selectedArtifact.name}"\n`)
    .appendText("CREATE FUNCTION `")
    .appendPlaceholder("yourFunctionNameHere", 1)
    .appendText("` AS '")
    .appendPlaceholder("your.class.NameHere", 2)
    .appendText(`' USING JAR 'confluent-artifact://${selectedArtifact.id}';\n`)
    .appendText("-- confirm with 'SHOW USER FUNCTIONS';\n");

  const document = await workspace.openTextDocument({
    language: "flinksql",
    // content is initialized as an empty string, we insert the snippet next due to how the Snippets API works
    content: "",
  });

  const editor = await window.showTextDocument(document, { preview: false });
  await editor.insertSnippet(snippetString);
}

export async function setFlinkArtifactsViewModeCommand() {
  flinkDatabaseViewMode.fire(FlinkArtifactsViewProviderMode.Artifacts);
  await setContextValue(
    ContextValues.flinkDatabaseViewMode,
    FlinkArtifactsViewProviderMode.Artifacts,
  );
}

export function registerFlinkArtifactCommands(): Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.flinkdatabase.setArtifactsViewMode",
      setFlinkArtifactsViewModeCommand,
    ),
    registerCommandWithLogging("confluent.artifacts.registerUDF", queryArtifactWithFlink),
  ];
}
