/**
 * Topic Service interface and types.
 *
 * Defines the contract for topic operations across different implementations:
 * - KafkaAdminTopicService: Uses kafkajs Admin client (desktop only)
 * - RestApiTopicService: Uses Kafka REST API (v2 for LOCAL, v3 for CCloud)
 */

import type { KafkaCluster } from "../models/kafkaCluster";

/**
 * Information about a single partition within a topic.
 */
export interface PartitionInfo {
  /** Partition ID (0-indexed). */
  partitionId: number;
  /** ID of the leader broker for this partition. */
  leader: number;
  /** IDs of all replicas for this partition. */
  replicas: number[];
  /** IDs of in-sync replicas for this partition. */
  isr: number[];
  /** IDs of offline replicas for this partition. */
  offlineReplicas?: number[];
}

/**
 * Complete information about a Kafka topic.
 */
export interface TopicInfo {
  /** Topic name. */
  name: string;
  /** Whether this is an internal topic (e.g., __consumer_offsets). */
  isInternal: boolean;
  /** Replication factor for the topic. */
  replicationFactor: number;
  /** Number of partitions. */
  partitionCount: number;
  /** Detailed partition information. */
  partitions: PartitionInfo[];
  /** Topic configurations (e.g., retention.ms, cleanup.policy). */
  configs: Record<string, string>;
  /** Authorized operations for the current user (if available). */
  authorizedOperations?: string[];
}

/**
 * Options for listing topics.
 */
export interface ListTopicsOptions {
  /** Include authorized operations in response (requires ACL support). */
  includeAuthorizedOperations?: boolean;
  /** Include internal topics in the response. */
  includeInternal?: boolean;
}

/**
 * Options for creating a topic.
 */
export interface CreateTopicOptions {
  /** Topic name (required). */
  topicName: string;
  /** Number of partitions (default: broker default). */
  partitionsCount?: number;
  /** Replication factor (default: broker default). */
  replicationFactor?: number;
  /** Topic configurations. */
  configs?: Record<string, string>;
  /** Timeout in milliseconds. */
  timeout?: number;
}

/**
 * Service interface for Kafka topic operations.
 *
 * Implementations may use kafkajs Admin client or REST API depending on
 * connection type and runtime environment.
 */
export interface TopicService {
  /**
   * Lists all topics in a Kafka cluster.
   * @param cluster The Kafka cluster to query.
   * @param options Options for listing topics.
   * @returns Array of topic information.
   */
  listTopics(cluster: KafkaCluster, options?: ListTopicsOptions): Promise<TopicInfo[]>;

  /**
   * Gets detailed information about a specific topic.
   * @param cluster The Kafka cluster containing the topic.
   * @param topicName Name of the topic.
   * @returns Topic information.
   * @throws KafkaAdminError if the topic doesn't exist.
   */
  describeTopic(cluster: KafkaCluster, topicName: string): Promise<TopicInfo>;

  /**
   * Checks if a topic exists.
   * @param cluster The Kafka cluster to check.
   * @param topicName Name of the topic.
   * @returns true if the topic exists.
   */
  topicExists(cluster: KafkaCluster, topicName: string): Promise<boolean>;

  /**
   * Creates a new topic.
   * @param cluster The Kafka cluster where the topic will be created.
   * @param options Topic creation options.
   * @throws KafkaAdminError if the topic already exists or creation fails.
   */
  createTopic(cluster: KafkaCluster, options: CreateTopicOptions): Promise<void>;

  /**
   * Deletes a topic.
   * @param cluster The Kafka cluster containing the topic.
   * @param topicName Name of the topic to delete.
   * @throws KafkaAdminError if the topic doesn't exist or deletion fails.
   */
  deleteTopic(cluster: KafkaCluster, topicName: string): Promise<void>;
}
