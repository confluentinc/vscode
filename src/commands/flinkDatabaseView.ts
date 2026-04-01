import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { setFlinkDocumentMetadata } from "../flinkSql/statementUtils";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import type { FlinkDatabaseResourceContainer } from "../models/containers/flinkDatabaseResourceContainer";
import { FlinkDatabaseContainerLabel } from "../models/containers/flinkDatabaseResourceContainer";
import type { CCloudEnvironment } from "../models/environment";
import type { FlinkRelation } from "../models/flinkRelation";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";

const logger = new Logger("FlinkDatabaseViewCommands");

/**
 * Open a new FlinkSQL document with a templated query for the selected relation.
 * Sets the document metadata to the relation's environment, database, and first compute pool.
 */
export async function queryFlinkRelationCommand(relation: FlinkRelation): Promise<void> {
  if (!relation) {
    logger.error("No relation provided to queryFlinkRelationCommand");
    throw new Error(
      "Unable to open a Flink SQL query because no relation was provided. Please run this command from a Flink relation in the Databases view.",
    );
  }

  const loader = CCloudResourceLoader.getInstance();
  const environment = await loader.getEnvironment(relation.environmentId);
  if (!environment) {
    logger.error(`Could not find environment ${relation.environmentId}`);
    throw new Error(
      `Unable to open a Flink SQL query because environment "${relation.environmentId}" could not be found. Refresh your Confluent Cloud connection and try again.`,
    );
  }

  // Get the database (Kafka cluster)
  const database = await loader.getFlinkDatabase(relation.environmentId, relation.databaseId);
  if (!database) {
    logger.error(`Could not find Flink database ${relation.databaseId}`);
    throw new Error(
      `Unable to open a Flink SQL query because the selected database "${relation.databaseId}" is not available or is not Flink-enabled. Select a valid Flink database and try again.`,
    );
  }

  // Get first compute pool for this database
  const computePool = database.flinkPools[0];
  if (!computePool) {
    logger.error(`No compute pool found for database ${database.id}`);
    throw new Error(
      `Unable to open a Flink SQL query because no compute pool is configured for database "${database.name}". Create or select a compute pool for this database in Confluent Cloud, then try again.`,
    );
  }

  // Create templated query
  const documentTemplate = `SELECT * FROM \`${relation.name}\` LIMIT 10;\n`;

  const document = await vscode.workspace.openTextDocument({
    language: "flinksql",
    content: documentTemplate,
  });

  // Set document metadata
  await setFlinkDocumentMetadata(document.uri, {
    catalog: environment as CCloudEnvironment,
    database: database,
    computePool: computePool,
  });

  // Show document with cursor positioned after the query
  const editor = await vscode.window.showTextDocument(document);
  const position = document.positionAt(documentTemplate.length);
  editor.selection = new vscode.Selection(position, position);
}

export function registerFlinkDatabaseViewCommands(): vscode.Disposable[] {
  return [
    // create table/topic command for empty state
    registerCommandWithLogging(
      "confluent.flinkdatabase.createRelation",
      createRelationFromFlinkDatabaseViewCommand,
    ),
    // refresh resource-specific container items
    registerCommandWithLogging(
      "confluent.flinkdatabase.refreshResourceContainer",
      refreshResourceContainerCommand,
    ),
    // query relation with Flink
    registerCommandWithLogging("confluent.flinkdatabase.queryRelation", queryFlinkRelationCommand),
  ];
}

/**
 * Open up a new FlinkSQL document inviting the user to create a new table or view.
 * Sets the document metadata to point the the currently selected Flink database in the view.
 */
export async function createRelationFromFlinkDatabaseViewCommand(): Promise<void> {
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
    // This is wacky and should never happen, but log an error just in case.
    logger.error(
      `Could not find environment with ID ${selectedFlinkDatabase.environmentId} for selected Flink database.`,
    );
    return;
  }

  // Open a new Flink SQL document with an informative comment block to create the table or view.
  const documentTemplate = `-- Create a new table or view in Flink database "${selectedFlinkDatabase.name}" in environment "${environment.name}".
--
-- Write your CREATE TABLE or CREATE VIEW statement below, then use 'Submit Statement' above to execute it.
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

  // Set the codelenses to point to the gestured-upon env, database and its first compute pool.
  await setFlinkDocumentMetadata(uri, {
    catalog: environment as CCloudEnvironment,
    database: selectedFlinkDatabase,
    computePool: pool,
  });

  // Show the document and position the cursor at the end of the document.
  const editor = await vscode.window.showTextDocument(document);
  const position = new vscode.Position(document.lineCount - 1, 0);
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
