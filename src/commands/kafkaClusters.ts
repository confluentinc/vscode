import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { fetchTopicAuthorizedOperations } from "../authz/topics";
import { flinkDatabaseViewResourceChanged, topicsViewResourceChanged } from "../emitters";
import { ClusterSelectSyncOption, SYNC_ON_KAFKA_SELECT } from "../extensionSettings/constants";
import { ResourceLoader } from "../loaders/resourceLoader";
import { Logger } from "../logging";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { isCCloud } from "../models/resource";
import { KafkaTopic } from "../models/topic";
import {
  flinkDatabaseQuickpick,
  kafkaClusterQuickPick,
  kafkaClusterQuickPickWithViewProgress,
} from "../quickpicks/kafkaClusters";
// TODO: Phase 6 - Import KafkaRestProxy or use direct API calls
import { removeProtocolPrefix } from "../utils/bootstrapServers";
import { TopicViewProvider } from "../viewProviders/topics";
import { selectSchemaRegistryCommand } from "./schemaRegistry";
// Removing unused imports: waitForTopicToBeDeleted, waitForTopicToExist
// These were used with the sidecar's topic management API

const logger = new Logger("commands.kafkaClusters");

/**
 * Invoked from the topics view to pick a new Kafka cluster to view topics for,
 * or from the Resources view default action when clicking on Kafka cluster. */
export async function selectTopicsViewKafkaClusterCommand(cluster?: KafkaCluster) {
  // ensure whatever was passed in is some form of KafkaCluster; if not, prompt the user to pick one
  const kafkaCluster: KafkaCluster | undefined =
    cluster instanceof KafkaCluster ? cluster : await kafkaClusterQuickPickWithViewProgress();
  if (!kafkaCluster) {
    return;
  }

  // Inform the topics view that the user has selected a new Kafka cluster.
  topicsViewResourceChanged.fire(kafkaCluster);
  // And set focus to the topics view.
  void vscode.commands.executeCommand("confluent-topics.focus");

  // Optionally sync related views based on user settings
  const shouldSyncSchemasView = [
    ClusterSelectSyncOption.ALL,
    ClusterSelectSyncOption.SCHEMAS,
  ].includes(SYNC_ON_KAFKA_SELECT.value);
  if (shouldSyncSchemasView) {
    const loader = ResourceLoader.getInstance(kafkaCluster.connectionId);
    const schemaRegistry = await loader.getSchemaRegistryForEnvironmentId(
      kafkaCluster.environmentId,
    );
    if (schemaRegistry) {
      void selectSchemaRegistryCommand(schemaRegistry);
    }
  }

  const shouldSyncFlinkDbView = [
    ClusterSelectSyncOption.ALL,
    ClusterSelectSyncOption.FLINK_DATABASE,
  ].includes(SYNC_ON_KAFKA_SELECT.value);
  if (shouldSyncFlinkDbView) {
    if (kafkaCluster instanceof CCloudKafkaCluster && kafkaCluster.isFlinkable()) {
      void selectFlinkDatabaseViewKafkaClusterCommand(kafkaCluster);
    }
  }
}

/** Pick a Flinkable Kafka Cluster as the one to examine in the Flink Database view */
export async function selectFlinkDatabaseViewKafkaClusterCommand(
  cluster?: CCloudFlinkDbKafkaCluster,
) {
  // ensure whatever was passed in is a flinkable CCloudKafkaCluster; if not, prompt the user to pick one
  const flinkDatabase: CCloudFlinkDbKafkaCluster | undefined =
    cluster instanceof CCloudKafkaCluster && cluster.isFlinkable()
      ? cluster
      : await flinkDatabaseQuickpick(
          undefined, // do not limit to a specific compute pool
          "Select a Flink Database (a Flink-enabled Kafka cluster)",
        );

  if (!flinkDatabase) {
    return;
  }

  // Inform the Flink Database view that the current database changed.
  flinkDatabaseViewResourceChanged.fire(flinkDatabase);

  // And set focus to the flink DB view.
  void vscode.commands.executeCommand("confluent-flink-database.focus");
}

export async function deleteTopicCommand(topic: KafkaTopic) {
  if (!(topic instanceof KafkaTopic)) {
    return;
  }
  // We won't have even gotten here if we didn't think the user has DELETE permissions on the topic.
  // BUT that was at the time we fetched the topic list, so we should check again before proceeding.
  const authorizedOperations = await fetchTopicAuthorizedOperations(topic);
  if (!authorizedOperations.includes("DELETE")) {
    const errorMessage = `You do not have permission to delete the topic "${topic.name}"`;
    logger.error(errorMessage);
    vscode.window.showErrorMessage(errorMessage);
    return;
  }

  logger.info(`Deleting topic "${topic.name}" from cluster ${topic.clusterId}...`);
  const confirmMessage = `Are you sure you want to delete the topic "${topic.name}"?`;

  const topicName: string | undefined = await vscode.window.showInputBox({
    title: confirmMessage,
    prompt: "Enter the name of the topic to confirm",
    ignoreFocusOut: true,
  });
  if (!topicName) {
    return;
  }

  if (topicName !== topic.name) {
    const errorMessage = `Topic name "${topicName}" does not match "${topic.name}"`;
    logger.error(errorMessage);
    vscode.window.showErrorMessage(errorMessage);
    return;
  }

  // TODO: Phase 6 - Implement topic deletion using KafkaRestProxy
  logger.error("Topic deletion not yet implemented with internal proxy", {
    topic: topic.name,
    clusterId: topic.clusterId,
  });
  vscode.window.showErrorMessage(
    "Topic deletion is not yet available. This feature is being migrated.",
  );
}

/**
 * Command implementation behind creating a Kafka topic.
 *
 * @param item Optional KafkaCluster to create the topic in. If not provided, the user will be prompted to select one.
 * @returns True if the topic was created, false otherwise.
 */
export async function createTopicCommand(item?: KafkaCluster): Promise<boolean> {
  const topicsViewProvider = TopicViewProvider.getInstance();
  const topicsViewCluster = topicsViewProvider.kafkaCluster;

  let cluster: KafkaCluster | undefined;
  // we'll need to know which Kafka cluster to create the topic in, which happens one of three ways:
  if (item instanceof KafkaCluster) {
    // 1) the user right-clicked a Kafka cluster in the Resources view and we get the associated
    // Kafka cluster as the argument by default
    cluster = item;
  } else if (topicsViewCluster != null) {
    // 2) the user clicked a Kafka cluster to populate the Topics view, so we'll use that cluster
    cluster = topicsViewCluster;
  } else {
    // 3) the command wasn't triggered from a Kafka cluster in the resources view, and nothing is
    // set in the Topics view provider, so have the user pick which one they want
    cluster = await kafkaClusterQuickPick();
  }

  if (!cluster) {
    return false;
  }

  // TODO: add RBAC check here once we can get the user's permissions for the cluster

  // TODO: change all of these inputs to a webview (form), especially to support `config` input
  const title = `Create a new topic in "${cluster.name}"`;
  const topicName: string | undefined = await vscode.window.showInputBox({
    title: title,
    prompt: "New topic name",
    ignoreFocusOut: true,
  });
  if (!topicName) {
    return false;
  }

  const partitionsCount: string | undefined = await vscode.window.showInputBox({
    title: title,
    prompt: "Enter partition count",
    ignoreFocusOut: true,
    value: "1",
  });

  // CCloud Kafka clusters will return an error if replication factor is less than 3
  const defaultReplicationFactor = isCCloud(cluster) ? "3" : "1";
  const replicationFactor: string | undefined = await vscode.window.showInputBox({
    title: title,
    prompt: "Enter replication factor",
    ignoreFocusOut: true,
    value: defaultReplicationFactor,
  });

  // TODO: Phase 6 - Implement topic creation using KafkaRestProxy
  logger.error("Topic creation not yet implemented with internal proxy", {
    topicName,
    clusterId: cluster.id,
    partitionsCount,
    replicationFactor,
  });
  vscode.window.showErrorMessage(
    "Topic creation is not yet available. This feature is being migrated.",
  );
  return false;
}

export async function copyBootstrapServers(item: KafkaCluster) {
  const bootstrapServers = item.bootstrapServers;
  if (!bootstrapServers) {
    return;
  }

  // Strip away any protocol:// prefix from each comma separated bootstrap server
  const stripped = removeProtocolPrefix(bootstrapServers);

  await vscode.env.clipboard.writeText(stripped);
  vscode.window.showInformationMessage(`Copied "${stripped}" to clipboard.`);
}

export function registerKafkaClusterCommands(): vscode.Disposable[] {
  return [
    // Pick a Kafka cluster for the Topics view.
    registerCommandWithLogging(
      "confluent.topics.kafka-cluster.select",
      selectTopicsViewKafkaClusterCommand,
    ),
    // Picked a Flink Database (a Flinkable CCloud Kafka cluster) from the Flink Database view title
    // or from context menu item in resources view.
    registerCommandWithLogging(
      "confluent.flinkdatabase.kafka-cluster.select",
      selectFlinkDatabaseViewKafkaClusterCommand,
    ),
    // ...or as an inline action in the resources view with a different icon & command name
    registerCommandWithLogging(
      "confluent.flinkdatabase.select",
      selectFlinkDatabaseViewKafkaClusterCommand,
    ),
    registerCommandWithLogging("confluent.topics.create", createTopicCommand),
    registerCommandWithLogging("confluent.topics.delete", deleteTopicCommand),
    registerCommandWithLogging(
      "confluent.resources.kafka-cluster.copyBootstrapServers",
      copyBootstrapServers,
    ),
  ];
}
