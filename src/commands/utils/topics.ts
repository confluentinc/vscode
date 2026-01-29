import { TokenManager } from "../../auth/oauth2/tokenManager";
import type { TopicV3Api } from "../../clients/kafkaRest";
import { ConnectionType, CredentialType } from "../../connections";
import { ResourceLoader } from "../../loaders/resourceLoader";
import { Logger } from "../../logging";
import type { KafkaCluster } from "../../models/kafkaCluster";
import type { KafkaTopic } from "../../models/topic";
import type { AuthConfig } from "../../proxy/httpClient";
import type { KafkaRestApiVersion, KafkaRestProxyConfig } from "../../proxy/kafkaRestProxy";
import { getResourceManager } from "../../storage/resourceManager";

const logger = new Logger("commands.utils.topics");

/**
 * Gets the KafkaCluster for the given topic.
 * @param topic The topic to get the cluster for.
 * @returns The KafkaCluster, or undefined if not found.
 */
export async function getClusterForTopic(topic: KafkaTopic): Promise<KafkaCluster | undefined> {
  const loader = ResourceLoader.getInstance(topic.connectionId);
  const clusters = await loader.getKafkaClustersForEnvironmentId(topic.environmentId);
  return clusters.find((c) => c.id === topic.clusterId);
}

/**
 * Gets the authentication configuration for a KafkaCluster.
 * @param cluster The cluster to get auth config for.
 * @returns The AuthConfig, or undefined if no auth is needed.
 */
export async function getAuthConfigForCluster(
  cluster: KafkaCluster,
): Promise<AuthConfig | undefined> {
  switch (cluster.connectionType) {
    case ConnectionType.Ccloud: {
      const token = (await TokenManager.getInstance().getDataPlaneToken()) || "";
      return {
        type: "bearer",
        token,
      };
    }

    case ConnectionType.Direct: {
      const resourceManager = getResourceManager();
      const spec = await resourceManager.getDirectConnection(cluster.connectionId);
      if (spec?.kafkaCluster?.credentials) {
        const creds = spec.kafkaCluster.credentials;
        if (creds.type === CredentialType.BASIC) {
          return {
            type: "basic",
            username: creds.username,
            password: creds.password,
          };
        }
        if (creds.type === CredentialType.API_KEY) {
          return {
            type: "basic",
            username: creds.apiKey,
            password: creds.apiSecret,
          };
        }
      }
      return undefined;
    }

    case ConnectionType.Local:
    default:
      return undefined;
  }
}

/**
 * Gets the KafkaRestProxyConfig for a topic's cluster.
 * @param topic The topic to get proxy config for.
 * @returns The proxy config, or undefined if the cluster is not found.
 */
export async function getProxyConfigForTopic(
  topic: KafkaTopic,
): Promise<KafkaRestProxyConfig | undefined> {
  const cluster = await getClusterForTopic(topic);
  if (!cluster || !cluster.uri) {
    return undefined;
  }

  const auth = await getAuthConfigForCluster(cluster);

  // Determine API version based on connection type
  // - LOCAL uses v3-local (path /v3/clusters/... without /kafka prefix)
  // - CCloud and DIRECT use v3 (path /kafka/v3/clusters/...)
  const apiVersion: KafkaRestApiVersion =
    cluster.connectionType === ConnectionType.Local ? "v3-local" : "v3";

  return {
    baseUrl: cluster.uri,
    clusterId: cluster.id,
    auth,
    apiVersion,
  };
}

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
