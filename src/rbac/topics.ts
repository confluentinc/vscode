import { TopicV3Api } from "../clients/kafkaRest";
import { Logger } from "../logging";
import { KafkaTopic, KafkaTopicAuthorizedOperation } from "../models/topic";
import { getSidecar } from "../sidecar";

const logger = new Logger("rbac.topics");

export async function addPermissionsToTopic(topic: KafkaTopic): Promise<KafkaTopic> {
  if (topic.isLocalTopic()) {
    return topic;
  }

  let updatedTopic: KafkaTopic = topic;
  const sidecar = await getSidecar();
  const client: TopicV3Api = sidecar.getTopicV3Api(topic.clusterId, topic.connectionId);
  try {
    const topicResp = await client.getKafkaTopic({
      cluster_id: topic.clusterId,
      topic_name: topic.name,
      include_authorized_operations: true,
    });
    const permissions: KafkaTopicAuthorizedOperation[] = validatePermissions(
      topicResp.authorized_operations ?? [],
    );
    updatedTopic = KafkaTopic.create({
      ...topic,
      authorizedOperations: permissions,
    });
  } catch (error) {
    logger.error("Error checking topic permissions", error);
  }
  return updatedTopic;
}

/**
 * Filter permissions to only include valid {@link KafkaTopicAuthorizedOperation} values.
 */
export function validatePermissions(permissions: string[]): KafkaTopicAuthorizedOperation[] {
  if (permissions.length === 0) {
    return [];
  }
  const validPermissions: KafkaTopicAuthorizedOperation[] = [];
  const invalidPermissions: string[] = [];
  for (const permission of permissions) {
    if (
      Object.values(KafkaTopicAuthorizedOperation).includes(
        permission as KafkaTopicAuthorizedOperation,
      )
    ) {
      validPermissions.push(permission as KafkaTopicAuthorizedOperation);
    } else {
      invalidPermissions.push(permission);
    }
  }
  if (invalidPermissions.length > 0) {
    logger.warn(`Invalid permissions found: ${invalidPermissions.join(", ")}`);
  }
  return validPermissions;
}
