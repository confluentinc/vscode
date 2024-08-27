import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { KafkaCluster } from "../models/kafkaCluster";
import { getTopicViewProvider } from "../viewProviders/topics";

/** Copy the Kafka Cluster ID from the Topics tree provider nav action. */
async function copyKafkaClusterId() {
  const cluster: KafkaCluster | null = getTopicViewProvider().kafkaCluster;
  if (!cluster) {
    return;
  }
  await vscode.env.clipboard.writeText(cluster.id);
  vscode.window.showInformationMessage(`Copied "${cluster.id}" to clipboard.`);
}

/** Copy the Kafka Cluster name from the Topics tree provider nav action. */
async function copyKafkaClusterName() {
  const cluster: KafkaCluster | null = getTopicViewProvider().kafkaCluster;
  if (!cluster) {
    return;
  }
  await vscode.env.clipboard.writeText(cluster.name);
  vscode.window.showInformationMessage(`Copied "${cluster.name}" to clipboard.`);
}

/** Copy the Kafka Cluster bootstrap servers from the Topics tree provider nav action. */
async function copyKafkaClusterBootstrapUrl() {
  const cluster: KafkaCluster | null = getTopicViewProvider().kafkaCluster;
  if (!cluster) {
    return;
  }
  await vscode.env.clipboard.writeText(cluster.bootstrapServers);
  vscode.window.showInformationMessage(`Copied "${cluster.bootstrapServers}" to clipboard.`);
}

export const commands = [
  registerCommandWithLogging("confluent.topics.copyKafkaClusterId", copyKafkaClusterId),
  registerCommandWithLogging("confluent.topics.copyKafkaClusterName", copyKafkaClusterName),
  registerCommandWithLogging(
    "confluent.topics.copyKafkaClusterBootstrapServers",
    copyKafkaClusterBootstrapUrl,
  ),
];
