import type { TopicV3Api } from "../clients/kafkaRest";
import { Logger } from "../logging";
import type { KafkaTopic } from "../models/topic";
import { getSidecar } from "../sidecar";
import type { KafkaTopicOperation } from "./types";
import { toKafkaTopicOperations } from "./types";

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

    // authorized_operations may be undeclared if not Confluent kafka rest ...
    return toKafkaTopicOperations(topicResp.authorized_operations ?? []);
  } catch (error) {
    logger.error(`Failed to get topic authorized operations for topic ${topic.name}: ${error}`);
    return [];
  }
}
