import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { udfsChanged } from "../emitters";
import { isResponseError, logError } from "../errors";
import { FLINK_SQL_LANGUAGE_ID } from "../flinkSql/constants";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import type { FlinkArtifact } from "../models/flinkArtifact";
import type { FlinkUdf } from "../models/flinkUDF";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import {
  showErrorNotificationWithButtons,
  showInfoNotificationWithButtons,
} from "../notifications";
import { UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import type { UriMetadata } from "../storage/types";
import { logUsage, UserEvent } from "../telemetry/events";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import { executeCreateFunction, promptForFunctionAndClassName } from "./utils/uploadArtifactOrUDF";

const logger = new Logger("commands.flinkUDFs");

/**
 * Delete a Flink UDF by executing a DROP FUNCTION statement.
 *
 * @param selectedUdf The UDF to delete
 */
export async function deleteFlinkUDFCommand(selectedUdf: FlinkUdf): Promise<void> {
  if (!selectedUdf) {
    return;
  }

  const confirmButton = "Yes, delete";
  const confirmResult = await vscode.window.showWarningMessage(
    `Are you sure you want to delete the UDF "${selectedUdf.name}"?`,
    {
      modal: true,
      detail: `Deleting this UDF will also delete all other overloaded versions of this UDF. It will run 'DROP FUNCTION' within the CCloud Kafka Cluster "${selectedUdf.databaseId}". This action cannot be undone.`,
    },
    confirmButton,
  );

  if (confirmResult !== confirmButton) {
    return;
  }

  try {
    const ccloudResourceLoader = CCloudResourceLoader.getInstance();
    const flinkDatabaseProvider = FlinkDatabaseViewProvider.getInstance();
    const database = flinkDatabaseProvider.resource;

    if (!database) {
      throw new Error("No Flink database.");
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Deleting Flink UDF",
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: "Executing DROP FUNCTION statement..." });
        await ccloudResourceLoader.executeBackgroundFlinkStatement(
          `DROP FUNCTION \`${selectedUdf.name}\`;`,
          database,
          {
            nameSpice: "delete-udf",
            timeout: 30000, // 30 second timeout
          },
        );

        progress.report({ message: "Updating cache..." });

        udfsChanged.fire(database);

        progress.report({ message: "UDF deleted successfully." });
      },
    );

    void showInfoNotificationWithButtons(
      `UDF "${selectedUdf.name}" deleted successfully from Confluent Cloud.`,
    );
  } catch (err) {
    let errorMessage = "Failed to delete UDF:";

    if (isResponseError(err)) {
      const resp = await err.response.clone().text();
      errorMessage = `${errorMessage} ${resp}`;
    } else if (err instanceof Error) {
      // extract the error detail from the error message for better error notification
      const flinkDetail = err.message.split("Error detail:")[1]?.trim();
      if (flinkDetail) {
        errorMessage = `${errorMessage} ${flinkDetail}`;
      } else {
        // fall back to regular error message
        errorMessage = `${errorMessage} ${err.message}`;
      }
    }
    logError(err, errorMessage);
    void showErrorNotificationWithButtons(errorMessage);
  }
}

export function registerFlinkUDFCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.deleteFlinkUDF", deleteFlinkUDFCommand),
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
  const snippetString = new vscode.SnippetString()
    .appendText(`-- Register UDF for artifact "${selectedArtifact.name}"\n`)
    .appendText(`-- Class name must be fully qualified (e.g. "com.example.MyUDF")\n`)
    .appendText("CREATE FUNCTION `")
    .appendPlaceholder("registeredFunctionName", 1)
    .appendText("` AS '")
    .appendPlaceholder("your.package.ClassName", 2)
    .appendText(`' USING JAR 'confluent-artifact://${selectedArtifact.id}';\n`)
    .appendText("-- confirm with 'SHOW USER FUNCTIONS';\n");

  const document = await vscode.workspace.openTextDocument({
    language: FLINK_SQL_LANGUAGE_ID,
    // content is initialized as an empty string, we insert the snippet next due to how the Snippets API works
    content: "",
  });
  try {
    const flinkDatabaseProvider = FlinkDatabaseViewProvider.getInstance();
    const database: CCloudFlinkDbKafkaCluster | null = flinkDatabaseProvider.database; // selected database in Artifacts view
    if (database) {
      const metadata: UriMetadata = {
        // FLINK_COMPUTE_POOL_ID will fallback to `null` so the user has to pick a pool to run the statement,
        // to avoid conflicts between any default pool settings and the artifact-related catalog/database
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: database.flinkPools[0]?.id || null,
        [UriMetadataKeys.FLINK_CATALOG_ID]: database.environmentId,
        [UriMetadataKeys.FLINK_DATABASE_ID]: database.id,
        [UriMetadataKeys.FLINK_DATABASE_NAME]: database.name,
      };
      await ResourceManager.getInstance().setUriMetadata(document.uri, metadata);
    }
  } catch (err) {
    logger.error("failed to set metadata for UDF registration doc", err);
  }
  const editor = await vscode.window.showTextDocument(document, { preview: false });
  await editor.insertSnippet(snippetString);
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

    let userInput = await promptForFunctionAndClassName();
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
    logUsage(UserEvent.FlinkUDFAction, {
      action: "created",
      status: "succeeded",
      cloud: selectedArtifact.provider,
      region: selectedArtifact.region,
    });
  } catch (err) {
    logUsage(UserEvent.FlinkUDFAction, {
      action: "created",
      status: "failed",
      cloud: selectedArtifact.provider,
      region: selectedArtifact.region,
    });
    if (!(err instanceof Error && err.message.includes("Failed to create UDF function"))) {
      let errorMessage = "Failed to create UDF function";

      if (isResponseError(err)) {
        const resp = await err.response.clone().text();
        errorMessage = `${errorMessage}: ${resp}`;
      } else if (err instanceof Error) {
        errorMessage = `${errorMessage}: ${err.message}`;
        logError(err, errorMessage);
      }
      void showErrorNotificationWithButtons(errorMessage);
    }
  }
}
