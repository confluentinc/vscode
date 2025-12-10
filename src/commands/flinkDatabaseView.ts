import type * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { Logger } from "../logging";
import type { FlinkDatabaseResourceContainer } from "../models/flinkDatabaseResourceContainer";
import { FlinkDatabaseContainerLabel } from "../models/flinkDatabaseResourceContainer";
import { pause } from "../sidecar/utils";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import { createTopicCommand } from "./kafkaClusters";

const logger = new Logger("FlinkDatabaseViewCommands");

export function registerFlinkDatabaseViewCommands(): vscode.Disposable[] {
  return [
    // create table/topic command for empty state
    registerCommandWithLogging(
      "confluent.flinkdatabase.createTopic",
      createTopicInFlinkDatabaseViewCommand,
    ),
    // refresh resource-specific container items
    registerCommandWithLogging(
      "confluent.flinkdatabase.refreshResourceContainer",
      refreshResourceContainerCommand,
    ),
  ];
}

/**
 * Start the flow to create a new topic in the currently selected Flink database's Kafka cluster.
 * When the topic is created, refresh the view to show the new topic as a (schemaless) table in the
 * relations container.
 */
export async function createTopicInFlinkDatabaseViewCommand(): Promise<void> {
  // get the currently selected Flink database from the view, create a topic in that cluster.
  const flinkDBViewProvider = FlinkDatabaseViewProvider.getInstance();
  const selectedFlinkDatabase = flinkDBViewProvider.database;
  if (!selectedFlinkDatabase) {
    // should never happen if the command is only available when a Flink database is selected.
    logger.error("No Flink database selected when attempting to create topic.");
    return;
  }

  // Directly invoke the command implementation so as to get type safety on parameter.
  const topicWasCreated = await createTopicCommand(selectedFlinkDatabase);

  if (topicWasCreated) {
    // Refresh the view to show the new topic in the relations container.
    // Retry a few times if necessary, as the topic creation may take a moment to propagate.
    for (let i = 0; i < 5 && flinkDBViewProvider["relationsContainer"].children.length === 0; i++) {
      await pause(500);
      // Deep refresh the container item to (hopefully) show the new table/topic.
      await flinkDBViewProvider.refreshRelationsContainer(selectedFlinkDatabase, true);
    }
  }
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
