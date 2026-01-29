import { getCCloudAuthSession } from "../authn/utils";
import { ConnectionType } from "../connections";
import { Logger } from "../logging";
import { isCCloud } from "../models/resource";
import type { KafkaTopic } from "../models/topic";
import { HttpError } from "../proxy/httpClient";
import { KafkaRestProxy } from "../proxy/kafkaRestProxy";
import { getResourceManager } from "../storage/resourceManager";
import type { KafkaTopicOperation } from "./types";

const logger = new Logger("authz.topics");

/**
 * Builds a KafkaRestProxy configuration for the given topic.
 * @param topic The topic to build the proxy config for.
 * @returns A configured KafkaRestProxy, or null if configuration is not possible.
 */
async function createKafkaRestProxyForTopic(topic: KafkaTopic): Promise<KafkaRestProxy | null> {
  switch (topic.connectionType) {
    case ConnectionType.Ccloud: {
      const session = await getCCloudAuthSession();
      if (!session) {
        logger.warn("No CCloud auth session available for topic authorization check");
        return null;
      }

      // Get the Kafka cluster to obtain the REST endpoint
      const resourceManager = getResourceManager();
      const clusters = await resourceManager.getKafkaClustersForEnvironmentId(
        topic.connectionId,
        topic.environmentId,
      );
      const cluster = clusters.find((c) => c.id === topic.clusterId);

      if (!cluster) {
        logger.warn("Could not find Kafka cluster for topic", {
          clusterId: topic.clusterId,
          environmentId: topic.environmentId,
        });
        return null;
      }

      // Build the REST URL from bootstrap servers
      // CCloud clusters have a predictable REST endpoint pattern
      const bootstrapServers = cluster.bootstrapServers;
      // Extract the host from bootstrap servers (e.g., "pkc-xxxxx.region.aws.confluent.cloud:9092")
      const host = bootstrapServers.split(":")[0];
      const baseUrl = `https://${host}:443`;

      return new KafkaRestProxy({
        baseUrl,
        clusterId: topic.clusterId,
        auth: {
          type: "bearer",
          token: session.accessToken,
        },
      });
    }

    case ConnectionType.Local: {
      // Local connections use the local REST proxy
      return new KafkaRestProxy({
        baseUrl: "http://localhost:8082",
        clusterId: topic.clusterId,
      });
    }

    case ConnectionType.Direct: {
      // Direct connections would need REST proxy configuration
      // For now, return null as direct connections may not have REST proxy configured
      logger.debug("Direct connection topic authorization not yet supported via REST proxy");
      return null;
    }

    default:
      return null;
  }
}

/** Deep fetch all authorized {@link KafkaTopicOperation}s for a given topic.
 *  We will have cached info about the topic's authorized operations, as of the time
 *  we called the list topics route as topic.operations, but authz may have changed
 *  in the mean time, so fetch the latest before actually trying a privileged operation.
 */
export async function fetchTopicAuthorizedOperations(
  topic: KafkaTopic,
): Promise<KafkaTopicOperation[]> {
  // Only CCloud topics currently support real-time authorization checks
  if (!isCCloud(topic)) {
    logger.debug("Using cached operations for non-CCloud topic", { topic: topic.name });
    return topic.operations ?? [];
  }

  try {
    const proxy = await createKafkaRestProxyForTopic(topic);
    if (!proxy) {
      logger.debug("Could not create REST proxy; using cached topic operations", {
        topic: topic.name,
      });
      return topic.operations ?? [];
    }

    const topicData = await proxy.getTopic(topic.name, { includeAuthorizedOperations: true });

    // Map the authorized operations from the response
    const operations = (topicData.authorized_operations ?? []) as KafkaTopicOperation[];
    logger.debug("Fetched fresh authorized operations for topic", {
      topic: topic.name,
      operations,
    });
    return operations;
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 401 || error.status === 403) {
        logger.warn("Unauthorized to fetch topic details; using cached operations", {
          topic: topic.name,
          status: error.status,
        });
        return topic.operations ?? [];
      }
      if (error.status === 404) {
        logger.warn("Topic not found; returning empty operations", { topic: topic.name });
        return [];
      }
    }

    logger.warn("Error fetching topic authorized operations; using cached operations", {
      topic: topic.name,
      error,
    });
    return topic.operations ?? [];
  }
}
