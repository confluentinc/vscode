/**
 * Topic Fetcher Implementation.
 *
 * Fetches topics from Kafka clusters using the Kafka REST API v3 proxy.
 * Replaces sidecar's topic fetching during migration.
 */

import type { AuthConfig } from "../proxy";
import { createKafkaRestProxy, HttpError, type KafkaRestProxy } from "../proxy";
import type { KafkaCluster } from "../models/kafkaCluster";
import { Logger } from "../logging";
import { type TopicData, type TopicFetcher, TopicFetchError } from "./types";
import {
  containsPrivateNetworkPattern,
  showPrivateNetworkingHelpNotification,
} from "../utils/privateNetworking";

const logger = new Logger("topicFetcher");

/**
 * Configuration for creating a topic fetcher.
 */
export interface TopicFetcherConfig {
  /** Function to get auth config for a cluster. */
  getAuthConfig: (cluster: KafkaCluster) => AuthConfig | undefined;
  /** Request timeout in milliseconds. */
  timeout?: number;
}

/**
 * Creates a topic fetcher with the given configuration.
 * @param config Fetcher configuration.
 * @returns A TopicFetcher implementation.
 */
export function createTopicFetcher(config: TopicFetcherConfig): TopicFetcher {
  return new TopicFetcherImpl(config);
}

/**
 * Topic fetcher implementation using Kafka REST API v3.
 */
class TopicFetcherImpl implements TopicFetcher {
  private readonly config: TopicFetcherConfig;

  constructor(config: TopicFetcherConfig) {
    this.config = config;
  }

  /**
   * Fetch all topics from a Kafka cluster.
   * @param cluster The Kafka cluster to fetch topics from.
   * @returns Array of TopicData.
   */
  async fetchTopics(cluster: KafkaCluster): Promise<TopicData[]> {
    logger.debug(`fetching topics for ${cluster.connectionType} Kafka cluster ${cluster.id}`);

    if (!cluster.uri) {
      throw new TopicFetchError(`Kafka cluster ${cluster.id} has no REST URI configured`);
    }

    const proxy = this.createProxy(cluster);

    try {
      const topicsData = await proxy.listTopics({
        includeAuthorizedOperations: true,
      });

      logger.debug(
        `fetched ${topicsData.length} topic(s) for ${cluster.connectionType} Kafka cluster ${cluster.id}`,
      );

      // Transform to TopicData format
      let topics: TopicData[] = topicsData.map((topic) => ({
        topic_name: topic.topic_name,
        is_internal: topic.is_internal ?? false,
        replication_factor: topic.replication_factor ?? 0,
        partitions_count: topic.partitions_count ?? 0,
        partitions: topic.partitions ?? {},
        configs: topic.configs ?? {},
        authorized_operations: topic.authorized_operations,
      }));

      // Sort topics by name
      if (topics.length > 1) {
        topics.sort((a, b) => a.topic_name.localeCompare(b.topic_name));
      }

      // Exclude "virtual" topics (e.g., Flink views) that have 0 replication factor
      topics = topics.filter((topic) => topic.replication_factor > 0);

      return topics;
    } catch (error) {
      if (error instanceof HttpError) {
        // Check for private networking issues
        if (error.status === 500 && cluster.uri && containsPrivateNetworkPattern(cluster.uri)) {
          showPrivateNetworkingHelpNotification({
            resourceName: cluster.name,
            resourceUrl: cluster.uri,
            resourceType: "Kafka cluster",
          });
          return [];
        }

        throw new TopicFetchError(
          `Failed to fetch topics from cluster ${cluster.id}: ${error.status} ${error.message}`,
        );
      }

      throw new TopicFetchError(
        `Failed to fetch topics from cluster ${cluster.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Creates a Kafka REST proxy for the given cluster.
   */
  private createProxy(cluster: KafkaCluster): KafkaRestProxy {
    return createKafkaRestProxy({
      baseUrl: cluster.uri!,
      clusterId: cluster.id,
      auth: this.config.getAuthConfig(cluster),
      timeout: this.config.timeout,
    });
  }
}
