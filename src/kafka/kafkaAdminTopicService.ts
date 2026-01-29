/**
 * Kafka Admin Topic Service.
 *
 * Implementation of TopicService using kafkajs Admin client.
 * Used for LOCAL and DIRECT connections on desktop VS Code.
 */

import type { Admin, ITopicMetadata } from "kafkajs";
import { Logger } from "../logging";
import type { KafkaCluster } from "../models/kafkaCluster";
import { getAdminClientManager } from "./adminClientManager";
import { KafkaAdminError, KafkaAdminErrorCategory } from "./errors";
import type {
  CreateTopicOptions,
  ListTopicsOptions,
  PartitionInfo,
  TopicInfo,
  TopicService,
} from "./topicService";

const logger = new Logger("kafka.kafkaAdminTopicService");

/**
 * Singleton instance of KafkaAdminTopicService.
 */
let instance: KafkaAdminTopicService | null = null;

/**
 * TopicService implementation using kafkajs Admin client.
 *
 * This implementation provides full topic management capabilities
 * via the native Kafka protocol. It's more efficient than REST API
 * for bulk operations and provides detailed partition information.
 */
export class KafkaAdminTopicService implements TopicService {
  /**
   * Gets the singleton instance.
   */
  static getInstance(): KafkaAdminTopicService {
    if (!instance) {
      instance = new KafkaAdminTopicService();
    }
    return instance;
  }

  /**
   * Resets the singleton instance.
   * Used for testing purposes only.
   */
  static resetInstance(): void {
    instance = null;
  }

  /**
   * Lists all topics in a Kafka cluster.
   */
  async listTopics(cluster: KafkaCluster, options?: ListTopicsOptions): Promise<TopicInfo[]> {
    logger.debug(`listing topics for cluster ${cluster.id}`);

    const admin = await this.getAdmin(cluster);

    try {
      // Get topic names
      const topicNames = await admin.listTopics();

      if (topicNames.length === 0) {
        return [];
      }

      // Filter internal topics if requested
      const filteredNames = options?.includeInternal
        ? topicNames
        : topicNames.filter((name) => !name.startsWith("_"));

      if (filteredNames.length === 0) {
        return [];
      }

      // Get metadata for all topics
      const metadata = await admin.fetchTopicMetadata({ topics: filteredNames });

      // Convert to TopicInfo array
      const topics = metadata.topics.map((topic) => this.toTopicInfo(topic));

      // Sort by name
      topics.sort((a, b) => a.name.localeCompare(b.name));

      logger.debug(`found ${topics.length} topic(s) in cluster ${cluster.id}`);
      return topics;
    } catch (error) {
      throw this.wrapError(error, `Failed to list topics in cluster ${cluster.id}`);
    }
  }

  /**
   * Gets detailed information about a specific topic.
   */
  async describeTopic(cluster: KafkaCluster, topicName: string): Promise<TopicInfo> {
    logger.debug(`describing topic ${topicName} in cluster ${cluster.id}`);

    const admin = await this.getAdmin(cluster);

    try {
      const metadata = await admin.fetchTopicMetadata({ topics: [topicName] });

      if (metadata.topics.length === 0) {
        throw new KafkaAdminError(
          `Topic '${topicName}' not found`,
          KafkaAdminErrorCategory.NOT_FOUND,
        );
      }

      const topic = metadata.topics[0];

      // Check for topic-level errors (e.g., UnknownTopicOrPartition)
      // kafkajs doesn't expose error codes directly on ITopicMetadata,
      // but an empty partition array typically indicates the topic doesn't exist
      if (topic.partitions.length === 0) {
        throw new KafkaAdminError(
          `Topic '${topicName}' not found or has no partitions`,
          KafkaAdminErrorCategory.NOT_FOUND,
        );
      }

      return this.toTopicInfo(topic);
    } catch (error) {
      if (error instanceof KafkaAdminError) {
        throw error;
      }
      throw this.wrapError(error, `Failed to describe topic '${topicName}'`);
    }
  }

  /**
   * Checks if a topic exists.
   */
  async topicExists(cluster: KafkaCluster, topicName: string): Promise<boolean> {
    logger.debug(`checking if topic ${topicName} exists in cluster ${cluster.id}`);

    const admin = await this.getAdmin(cluster);

    try {
      const topics = await admin.listTopics();
      return topics.includes(topicName);
    } catch (error) {
      throw this.wrapError(error, `Failed to check if topic '${topicName}' exists`);
    }
  }

  /**
   * Creates a new topic.
   */
  async createTopic(cluster: KafkaCluster, options: CreateTopicOptions): Promise<void> {
    logger.debug(`creating topic ${options.topicName} in cluster ${cluster.id}`);

    const admin = await this.getAdmin(cluster);

    try {
      const created = await admin.createTopics({
        topics: [
          {
            topic: options.topicName,
            numPartitions: options.partitionsCount,
            replicationFactor: options.replicationFactor,
            configEntries: options.configs
              ? Object.entries(options.configs).map(([name, value]) => ({ name, value }))
              : undefined,
          },
        ],
        timeout: options.timeout,
        waitForLeaders: true,
      });

      if (!created) {
        // Topic already existed
        throw new KafkaAdminError(
          `Topic '${options.topicName}' already exists`,
          KafkaAdminErrorCategory.ALREADY_EXISTS,
        );
      }

      logger.debug(`created topic ${options.topicName} in cluster ${cluster.id}`);
    } catch (error) {
      if (error instanceof KafkaAdminError) {
        throw error;
      }
      throw this.wrapError(error, `Failed to create topic '${options.topicName}'`);
    }
  }

  /**
   * Deletes a topic.
   */
  async deleteTopic(cluster: KafkaCluster, topicName: string): Promise<void> {
    logger.debug(`deleting topic ${topicName} from cluster ${cluster.id}`);

    const admin = await this.getAdmin(cluster);

    try {
      await admin.deleteTopics({
        topics: [topicName],
      });

      logger.debug(`deleted topic ${topicName} from cluster ${cluster.id}`);
    } catch (error) {
      throw this.wrapError(error, `Failed to delete topic '${topicName}'`);
    }
  }

  /**
   * Gets an Admin client for the cluster.
   */
  private async getAdmin(cluster: KafkaCluster): Promise<Admin> {
    const manager = getAdminClientManager();
    return manager.getAdmin(cluster);
  }

  /**
   * Converts kafkajs topic metadata to TopicInfo.
   */
  private toTopicInfo(topic: ITopicMetadata): TopicInfo {
    const partitions: PartitionInfo[] = topic.partitions.map((p) => ({
      partitionId: p.partitionId,
      leader: p.leader,
      replicas: p.replicas,
      isr: p.isr,
      offlineReplicas: p.offlineReplicas,
    }));

    // Calculate replication factor from first partition
    const replicationFactor = partitions.length > 0 ? partitions[0].replicas.length : 0;

    return {
      name: topic.name,
      isInternal: topic.name.startsWith("_"),
      replicationFactor,
      partitionCount: partitions.length,
      partitions,
      configs: {}, // kafkajs fetchTopicMetadata doesn't include configs
      authorizedOperations: undefined, // ACLs not available via basic metadata
    };
  }

  /**
   * Wraps a raw error in a KafkaAdminError.
   */
  private wrapError(error: unknown, message: string): KafkaAdminError {
    if (error instanceof KafkaAdminError) {
      return error;
    }

    const originalError = error instanceof Error ? error : new Error(String(error));
    const kafkaError = KafkaAdminError.fromKafkaJsError(originalError);

    return new KafkaAdminError(`${message}: ${kafkaError.message}`, kafkaError.category, {
      cause: originalError,
    });
  }
}

/**
 * Gets the singleton KafkaAdminTopicService instance.
 */
export function getKafkaAdminTopicService(): KafkaAdminTopicService {
  return KafkaAdminTopicService.getInstance();
}
