import type { Disposable } from "vscode";
import { registerCommandWithLogging } from ".";
import { Logger } from "../logging";
import type { ConsumerGroupContainer } from "../models/consumerGroup";
import { TopicViewProvider } from "../viewProviders/topics";

const logger = new Logger("commands.consumerGroups");

/**
 * Refresh the consumer groups container in the Topics view.
 * @param container The ConsumerGroupContainer tree item that was clicked.
 */
async function refreshConsumerGroupsContainer(container: ConsumerGroupContainer): Promise<void> {
  if (!container) {
    logger.error("No container provided to refreshConsumerGroupsContainer");
    return;
  }

  const provider = TopicViewProvider.getInstance();
  const cluster = provider.kafkaCluster;
  if (!cluster) {
    logger.error("No Kafka cluster selected when attempting to refresh consumer groups container.");
    return;
  }

  await provider.refreshConsumerGroups(cluster, true);
}

export function registerConsumerGroupCommands(): Disposable[] {
  return [
    registerCommandWithLogging("confluent.consumerGroups.refresh", refreshConsumerGroupsContainer),
  ];
}
