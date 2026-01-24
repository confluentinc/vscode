import type { TopicV3Api } from "../../clients/kafkaRest";
import { Logger } from "../../logging";

const logger = new Logger("commands.utils.topics");

export async function waitForTopicToExist(
  client: TopicV3Api,
  clusterId: string,
  topicName: string,
  isLocal: boolean,
  timeoutMs: number = 3000,
) {
  const startTime = Date.now();
  const topicKind = isLocal ? "local" : "CCloud";
  while (Date.now() - startTime < timeoutMs) {
    try {
      // will raise an error with a 404 status code if the topic doesn't exist
      await client.getKafkaTopic({
        cluster_id: clusterId,
        topic_name: topicName,
      });
      const elapsedMs = Date.now() - startTime;
      logger.info(`${topicKind} topic "${topicName}" was created in ${elapsedMs}ms`);
      return;
    } catch (error) {
      // is an expected 404 error, the topic creation hasn't completed yet.
      logger.warn(`${topicKind} topic "${topicName}" not available yet: ${error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${topicKind} topic "${topicName}" was not created within ${timeoutMs}ms`);
}

export async function waitForTopicToBeDeleted(
  client: TopicV3Api,
  clusterId: string,
  topicName: string,
  isLocal: boolean,
  // It may be that deleting topics that had a lot of data takes longer than creating them, so
  // be generous with the default timeout
  timeoutMs: number = 10000,
) {
  const startTime = Date.now();
  const topicKind = isLocal ? "local" : "CCloud";
  while (Date.now() - startTime < timeoutMs) {
    try {
      // will raise an error with a 404 status code if the topic doesn't exist.
      await client.getKafkaTopic({
        cluster_id: clusterId,
        topic_name: topicName,
      });
      logger.warn(`${topicKind} topic "${topicName}" still exists`);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      // topic is no longer found, yay, deletion complete.
      const elapsedMs = Date.now() - startTime;
      logger.info(`${topicKind} topic "${topicName}" was deleted in ${elapsedMs}ms`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${topicKind} topic "${topicName}" was not deleted within ${timeoutMs}ms`);
}
