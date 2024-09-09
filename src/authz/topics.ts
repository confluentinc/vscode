import { TopicV3Api } from "../clients/kafkaRest";
import { KafkaTopic } from "../models/topic";
import { getSidecar } from "../utils/sidecar";
import { KafkaTopicOperation, toKafkaTopicOperations } from "./types";

const logger = new Logger("authz.topics");

/** Deep fetch all authorized {@link KafkaTopicOperation}s for a given topic.
 *  We will have cached info about the topic's authorized operations, as of the time
 *  we called the list topics route as topic.operations, but authz may have changed
 *  in the mean time, so fetch the latest before actually trying a privileged operation.
 */
export async function fetchTopicAuthorizedOperations(
  topic: KafkaTopic,
): Promise<KafkaTopicOperation[]> {
  const sidecar = await getSidecar();
  const client: TopicV3Api = sidecar.getTopicV3Api(topic.clusterId, topic.connectionId);
  try {
    // fetch the single topic to get the latest authorized operations
    const topicResp = await client.getKafkaTopic({
      cluster_id: topic.clusterId,
      topic_name: topic.name,
      include_authorized_operations: true,
    });

    try {
      const operations = toKafkaTopicOperations(topicResp.authorized_operations ?? []);
      return operations;
    } catch (error) {
      logger.error(`Failed to parse topic authorized operations for topic ${topic.name}: ${error}`);
      return [];
    }
  } catch (error) {
    logger.error(`Failed to get topic authorized operations for topic ${topic.name}: ${error}`);
    return [];
  }
}
