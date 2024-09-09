import { KafkaTopic } from "../models/topic";
import { KafkaTopicOperation } from "./types";

/** Fetch all available {@link KafkaTopicAuthorizedOperation}s for a given topic. */
export async function getTopicAuthorizedOperations(
  topic: KafkaTopic,
): Promise<KafkaTopicOperation[]> {
  return topic.operations;
  /*
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
  */
}
