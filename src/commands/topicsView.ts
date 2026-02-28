import type { Disposable } from "vscode";
import { registerCommandWithLogging } from ".";
import { Logger } from "../logging";
import type { ISearchable } from "../models/resource";
import {
  KafkaClusterContainerLabel,
  type KafkaClusterResourceContainer,
} from "../models/containers/kafkaClusterResourceContainer";
import { TopicViewProvider } from "../viewProviders/topics";

const logger = new Logger("commands.topicsView");

/**
 * Refresh a resource container (Topics or Consumer Groups) in the Topics view.
 * @param container The {@link KafkaClusterResourceContainer} tree item that was clicked.
 */
export async function refreshResourceContainerCommand(
  container: KafkaClusterResourceContainer<ISearchable>,
): Promise<void> {
  if (!container) {
    logger.error("No container provided to refreshResourceContainerCommand");
    return;
  }

  const provider = TopicViewProvider.getInstance();
  const cluster = provider.kafkaCluster;
  if (!cluster) {
    logger.error("No Kafka cluster selected when attempting to refresh resource container.");
    return;
  }

  switch (container.label) {
    case KafkaClusterContainerLabel.TOPICS:
      await provider.refreshTopics(cluster, true);
      break;
    case KafkaClusterContainerLabel.CONSUMER_GROUPS:
      await provider.refreshConsumerGroups(cluster, true);
      break;
    default:
      logger.error(
        `Unknown container label "${container.label}" in refreshResourceContainerCommand`,
      );
  }
}

/** Register commands for the Topics view's container-level actions. */
export function registerTopicsViewCommands(): Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.topics.refreshResourceContainer",
      refreshResourceContainerCommand,
    ),
  ];
}
