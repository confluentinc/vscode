import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { flinkDatabaseViewMode } from "../emitters";
import { Logger } from "../logging";
import { pause } from "../sidecar/utils";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";
import { FlinkDatabaseViewProviderMode } from "../viewProviders/multiViewDelegates/constants";
import { createTopicCommand } from "./kafkaClusters";

const logger = new Logger("FlinkDatabaseViewCommands");

export function registerFlinkDatabaseViewCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.flinkdatabase.setRelationsViewMode",
      setFlinkRelationsViewModeCommand,
    ),
    registerCommandWithLogging(
      "confluent.flinkdatabase.createTopic",
      createTopicInFlinkDatabaseViewCommand,
    ),
  ];
}

export async function setFlinkRelationsViewModeCommand() {
  flinkDatabaseViewMode.fire(FlinkDatabaseViewProviderMode.Relations);
  await setContextValue(
    ContextValues.flinkDatabaseViewMode,
    FlinkDatabaseViewProviderMode.Relations,
  );
}

/**
 * Start the flow to create a new topic in the currently selected Flink database's Kafka cluster.
 * @returns
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
    if (flinkDBViewProvider.mode !== FlinkDatabaseViewProviderMode.Relations) {
      // Crafty user managed to switch the view mode prior to topic creation completing.
      // Switch to back relations mode to see the new (schemaless) topic-as-table.
      await flinkDBViewProvider.switchMode(FlinkDatabaseViewProviderMode.Relations);
    }

    // Refresh the view to show the new topic.
    // Retry a few times if necessary, as the topic creation may take a moment to propagate.
    for (let i = 0; i < 5 && !flinkDBViewProvider.hasChildren(); i++) {
      await pause(500);
      // Deep refresh the view to (hopefully) show the new topic.
      await flinkDBViewProvider.refresh(true);
    }

    // If we have any children at all, we're good. If not, log a warning and give up.
    if (!flinkDBViewProvider.hasChildren()) {
      logger.warn(
        "Topic was created but Flink Database view has no children after several refresh attempts.",
      );
    }
  }
}
