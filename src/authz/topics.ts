import { TopicV3Api } from "../clients/kafkaRest";
import { Logger } from "../logging";
import { KafkaTopic } from "../models/topic";
import { getSidecar } from "../sidecar";
import { KafkaTopicAuthorizedOperation, KafkaTopicAuthorizedOperations } from "./constants";

const logger = new Logger("authz.topics");

/** Fetch all available {@link KafkaTopicAuthorizedOperation}s for a given topic. */
export async function getTopicAuthorizedOperations(
  topic: KafkaTopic,
): Promise<KafkaTopicAuthorizedOperation[]> {
  if (topic.isLocalTopic()) {
    return [...KafkaTopicAuthorizedOperations] as KafkaTopicAuthorizedOperation[];
  }

  const sidecar = await getSidecar();
  const client: TopicV3Api = sidecar.getTopicV3Api(topic.clusterId, topic.connectionId);
  try {
    const topicResp = await client.getKafkaTopic({
      cluster_id: topic.clusterId,
      topic_name: topic.name,
      include_authorized_operations: true,
    });
    const operations = validateKafkaTopicOperations(topicResp.authorized_operations ?? []);
    logger.debug(`authorized operations for topic "${topic.name}":`, operations);
    return operations;
  } catch (error) {
    logger.error(`Failed to get topic authorized operations for topic ${topic.name}: ${error}`);
    return [];
  }
}

/** Filter authorized operation strings to the expected {@link KafkaTopicAuthorizedOperation}s. */
export function validateKafkaTopicOperations(
  operations: string[],
): KafkaTopicAuthorizedOperation[] {
  if (operations.length === 0) {
    return [];
  }
  const trackedOperations: KafkaTopicAuthorizedOperation[] = [];
  const untrackedOperations: string[] = [];
  for (const operation of operations) {
    if (KafkaTopicAuthorizedOperations.includes(operation as KafkaTopicAuthorizedOperation)) {
      trackedOperations.push(operation as KafkaTopicAuthorizedOperation);
    } else {
      untrackedOperations.push(operation);
    }
  }
  if (untrackedOperations.length > 0) {
    logger.warn("untracked operation(s) returned in response:", untrackedOperations);
  }
  return trackedOperations;
}
