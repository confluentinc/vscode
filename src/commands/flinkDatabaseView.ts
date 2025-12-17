import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { uriMetadataSet } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import type { FlinkDatabaseResourceContainer } from "../models/flinkDatabaseResourceContainer";
import { FlinkDatabaseContainerLabel } from "../models/flinkDatabaseResourceContainer";
import { UriMetadataKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";
import type { UriMetadata } from "../storage/types";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";

const logger = new Logger("FlinkDatabaseViewCommands");

export function registerFlinkDatabaseViewCommands(): vscode.Disposable[] {
  return [
    // create table/topic command for empty state
    registerCommandWithLogging(
      "confluent.flinkdatabase.createRelation",
      createRelationInFlinkDatabaseViewCommand,
    ),
    // refresh resource-specific container items
    registerCommandWithLogging(
      "confluent.flinkdatabase.refreshResourceContainer",
      refreshResourceContainerCommand,
    ),
  ];
}

/**
 * Open up a new FlinkSQL document inviting the user to create a new table or view.
 * Sets the document metadata to point the the currently selected Flink database in the view.
 */
export async function createRelationInFlinkDatabaseViewCommand(): Promise<void> {
  // get the currently selected Flink database from the view, create a topic in that cluster.
  const flinkDBViewProvider = FlinkDatabaseViewProvider.getInstance();
  const selectedFlinkDatabase = flinkDBViewProvider.database;
  if (!selectedFlinkDatabase) {
    // should never happen if the command is only available when a Flink database is selected.
    logger.error("No Flink database selected when attempting to create a relation.");
    return;
  }

  // Grab the environment name for the Flink database
  const ccloudLoader = CCloudResourceLoader.getInstance();
  const environment = await ccloudLoader.getEnvironment(selectedFlinkDatabase.environmentId);
  if (!environment) {
    logger.error(
      `Could not find environment with ID ${selectedFlinkDatabase.environmentId} for selected Flink database.`,
    );
    return;
  }

  // Open a new Flink SQL document with an informative comment block to create the table or view.
  const documentTemplate = `-- Create a new table or view in Flink database "${selectedFlinkDatabase.name}" in environment "${environment.name}".
--
-- Write your CREATE TABLE or CREATE VIEW statement below and execute it to create the relation,
-- then use 'Submit Statement' above to execute it.
-- 
-- Documentation:
--    CREATE TABLE: https://docs.confluent.io/cloud/current/flink/reference/statements/create-table.html
--    CREATE VIEW: https://docs.confluent.io/cloud/current/flink/reference/statements/create-view.html
--
`;
  const document = await vscode.workspace.openTextDocument({
    language: "flinksql",
    content: documentTemplate,
  });

  // Set the Flink database and compute pool metadata for the new document
  // so that when the user runs the statement, we know where to run it.
  const pool = selectedFlinkDatabase.flinkPools[0];
  const uri = document.uri;

  const metadata: UriMetadata = {
    [UriMetadataKeys.FLINK_CATALOG_ID]: environment.id,
    [UriMetadataKeys.FLINK_CATALOG_NAME]: environment.name,
    [UriMetadataKeys.FLINK_DATABASE_ID]: selectedFlinkDatabase.id,
    [UriMetadataKeys.FLINK_DATABASE_NAME]: selectedFlinkDatabase.name,
    [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: pool.id,
  };

  logger.debug(`setting create relation document Flink database / compute pool metadata for URI`, {
    uri: uri.toString(),
    metadata,
  });

  await getResourceManager().setUriMetadata(uri, metadata);
  uriMetadataSet.fire(uri);

  // Show the document and position the cursor at the end of the document.
  const editor = await vscode.window.showTextDocument(document);

  // Calculate the position at the end of the document template
  let newlineCount = 0;
  for (let i = 0; i < documentTemplate.length; i++) {
    if (documentTemplate[i] === "\n") newlineCount++;
  }
  const position = new vscode.Position(newlineCount, 0);
  // Set the cursor position in the editor.
  editor.selection = new vscode.Selection(position, position);
}

export async function refreshResourceContainerCommand(
  container: FlinkDatabaseResourceContainer<any>,
): Promise<void> {
  if (!container) {
    logger.error("No container provided to refreshResourceContainerCommand");
    return;
  }

  const provider = FlinkDatabaseViewProvider.getInstance();
  const database = provider.database;
  if (!database) {
    logger.error("No Flink database selected when attempting to refresh resource container.");
    return;
  }

  switch (container.label) {
    case FlinkDatabaseContainerLabel.RELATIONS:
      await provider.refreshRelationsContainer(database, true);
      break;
    case FlinkDatabaseContainerLabel.ARTIFACTS:
      await provider.refreshArtifactsContainer(database, true);
      break;
    case FlinkDatabaseContainerLabel.UDFS:
      await provider.refreshUDFsContainer(database, true);
      break;
    case FlinkDatabaseContainerLabel.AI_CONNECTIONS:
      await provider.refreshAIConnectionsContainer(database, true);
      break;
    case FlinkDatabaseContainerLabel.AI_TOOLS:
      await provider.refreshAIToolsContainer(database, true);
      break;
    case FlinkDatabaseContainerLabel.AI_MODELS:
      await provider.refreshAIModelsContainer(database, true);
      break;
    case FlinkDatabaseContainerLabel.AI_AGENTS:
      await provider.refreshAIAgentsContainer(database, true);
      break;
    default:
      logger.error(
        `Unknown container label "${container.label}" in refreshResourceContainerCommand`,
      );
  }
}
