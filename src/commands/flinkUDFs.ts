import * as vscode from "vscode";
import { Disposable, SnippetString, window, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { flinkDatabaseViewMode, udfsChanged } from "../emitters";
import { isResponseError, logError } from "../errors";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { FlinkArtifact } from "../models/flinkArtifact";
import { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import {
  showErrorNotificationWithButtons,
  showInfoNotificationWithButtons,
} from "../notifications";
import { UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import { UriMetadata } from "../storage/types";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import { FlinkDatabaseViewProviderMode } from "../viewProviders/multiViewDelegates/constants";
import { promptForFunctionAndClassName } from "./utils/uploadArtifactOrUDF";
const logger = new Logger("flinkUDFs");

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
    .appendText(`-- Class name must be fully qualified (e.g. "com.example.MyUDF")\n`)
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
  try {
    // We'll gather all the metadata we can and attach it to the document
    // In the future some of this could be handled by the codelens provider
    const loader = CCloudResourceLoader.getInstance();
    const catalog = await loader.getEnvironment(selectedArtifact.environmentId);
    const flinkDatabaseProvider = FlinkDatabaseViewProvider.getInstance();
    const database = flinkDatabaseProvider.database; // selected database in Artifacts view
    if (database && catalog) {
      const metadata: UriMetadata = {
        // FLINK_COMPUTE_POOL_ID will fallback to `null` so the user has to pick a pool to run the statement,
        // to avoid conflicts between any default pool settings and the artifact-related catalog/database
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: database.flinkPools[0]?.id || null,
        [UriMetadataKeys.FLINK_CATALOG_ID]: catalog.id,
        [UriMetadataKeys.FLINK_CATALOG_NAME]: catalog.name,
        [UriMetadataKeys.FLINK_DATABASE_ID]: database.id,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: database.name,
      };
      await ResourceManager.getInstance().setUriMetadata(document.uri, metadata);
    }
  } catch (err) {
    logger.error("failed to set metadata for UDF registration doc", err);
  }
  const editor = await window.showTextDocument(document, { preview: false });
  await editor.insertSnippet(snippetString);
}

export async function executeCreateFunction(
  selectedArtifact: FlinkArtifact,
  userInput: {
    functionName: string;
    className: string;
  },
  database: CCloudFlinkDbKafkaCluster,
) {
  const ccloudResourceLoader = CCloudResourceLoader.getInstance();
  await ccloudResourceLoader.executeFlinkStatement<{ created_at?: string }>(
    `CREATE FUNCTION \`${userInput.functionName}\` AS '${userInput.className}' USING JAR 'confluent-artifact://${selectedArtifact.id}';`,
    database,
    {
      timeout: 60000, // custom timeout of 60 seconds
    },
  );
  const createdMsg = `${userInput.functionName} function created successfully.`;
  void showInfoNotificationWithButtons(createdMsg);
}

export async function startGuidedUdfCreationCommand(selectedArtifact: FlinkArtifact) {
  if (!selectedArtifact) {
    return;
  }
  try {
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
        await executeCreateFunction(selectedArtifact, userInput, database);
        udfsChanged.fire(database);
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
