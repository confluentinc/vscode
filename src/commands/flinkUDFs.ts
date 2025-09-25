import * as vscode from "vscode";
import { Disposable, SnippetString, window, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { flinkDatabaseViewMode } from "../emitters";
import { isResponseError, logError } from "../errors";
import { CCloudResourceLoader } from "../loaders";
import { FlinkArtifact } from "../models/flinkArtifact";
import {
  showErrorNotificationWithButtons,
  showInfoNotificationWithButtons,
} from "../notifications";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import { FlinkDatabaseViewProviderMode } from "../viewProviders/multiViewDelegates/constants";
import { promptForFunctionAndClassName } from "./utils/uploadArtifactOrUDF";

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
    registerCommandWithLogging(
      "confluent.artifacts.createUdfRegistrationDocument",
      createUdfRegistrationDocumentCommand,
    ),
    registerCommandWithLogging(
      "confluent.artifacts.startGuidedUdfCreation",
      startGuidedUdfCreationCommand,
    ),
  ];
}
export async function createUdfRegistrationDocumentCommand(selectedArtifact: FlinkArtifact) {
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
export async function startGuidedUdfCreationCommand(selectedArtifact: FlinkArtifact) {
  if (!selectedArtifact) {
    return;
  }
  try {
    const ccloudResourceLoader = CCloudResourceLoader.getInstance();
    const flinkDatabaseProvider = FlinkDatabaseViewProvider.getInstance();
    const database = flinkDatabaseProvider.resource;
    if (!database) {
      throw new Error("No Flink database.");
    }

    let userInput = await promptForFunctionAndClassName(selectedArtifact);
    if (!userInput) {
      return; // User cancelled the input
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Creating UDF function from artifact",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Executing statement..." });
        await ccloudResourceLoader.executeFlinkStatement<{ created_at?: string }>(
          `CREATE FUNCTION \`${userInput.functionName}\` AS '${userInput.className}' USING JAR 'confluent-artifact://${selectedArtifact.id}';`,
          database,
          undefined,
          60000,
        );
        progress.report({ message: "Processing results..." });
        const createdMsg = `${userInput.functionName} function created successfully.`;
        void showInfoNotificationWithButtons(createdMsg);
      },
    );
  } catch (err) {
    if (!(err instanceof Error && err.message.includes("Failed to create UDF function"))) {
      let errorMessage = "Failed to create UDF function: ";

      if (isResponseError(err)) {
        const resp = await err.response.clone().text();
        errorMessage = `${errorMessage} ${resp}`;
      } else if (err instanceof Error) {
        errorMessage = `${errorMessage} ${err.message}`;
        logError(err, errorMessage);
      }
      showErrorNotificationWithButtons(errorMessage);
    }
  }
}
