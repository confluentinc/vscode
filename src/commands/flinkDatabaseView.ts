import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { ContextValues, setContextValue } from "../context/values";
import { flinkDatabaseViewMode } from "../emitters";
import { Logger } from "../logging";
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
  await createTopicCommand(selectedFlinkDatabase);
}
