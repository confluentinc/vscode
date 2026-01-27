/**
 * Kafka REST API v3 Proxy.
 *
 * Provides a high-level interface for Kafka REST API operations with:
 * - Topic management (list, get, create, delete)
 * - Partition information
 * - Topic configuration management
 * - Record production
 * - Cluster information
 */

import { createHttpClient, HttpError, type AuthConfig, type HttpClient } from "./httpClient";

// Re-export types from generated clients for convenience
export type {
  TopicData,
  TopicDataList,
  PartitionData,
  PartitionDataList,
  TopicConfigData,
  TopicConfigDataList,
  ClusterData,
  ProduceRequest,
  ProduceResponse,
  CreateTopicRequestData,
  AlterConfigBatchRequestData,
} from "../clients/kafkaRest/models";

/**
 * Kafka REST proxy configuration.
 */
export interface KafkaRestProxyConfig {
  /** Base URL for the Kafka REST API. */
  baseUrl: string;
  /** Kafka cluster ID. */
  clusterId: string;
  /** Authentication configuration. */
  auth?: AuthConfig;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Custom headers to include in all requests. */
  headers?: Record<string, string>;
}

/**
 * Options for listing topics.
 */
export interface ListTopicsOptions {
  /** Include authorized operations in response. */
  includeAuthorizedOperations?: boolean;
}

/**
 * Options for creating a topic.
 */
export interface CreateTopicOptions {
  /** Topic name. */
  topicName: string;
  /** Number of partitions. */
  partitionsCount?: number;
  /** Replication factor. */
  replicationFactor?: number;
  /** Topic configurations. */
  configs?: Array<{ name: string; value: string }>;
}

/**
 * Options for updating topic configurations.
 */
export interface UpdateTopicConfigOptions {
  /** Topic name. */
  topicName: string;
  /** Configuration updates. */
  configs: Array<{
    name: string;
    operation?: "DELETE" | "SET";
    value?: string;
  }>;
}

/**
 * Options for producing records.
 */
export interface ProduceRecordOptions {
  /** Topic name. */
  topicName: string;
  /** Partition to produce to (optional). */
  partitionId?: number;
  /** Record key. */
  key?: ProduceRecordData;
  /** Record value. */
  value?: ProduceRecordData;
  /** Record headers. */
  headers?: Array<{ name: string; value: string }>;
  /** Timestamp for the record. */
  timestamp?: string;
}

/**
 * Data for a produce record key or value.
 */
export interface ProduceRecordData {
  /** Data type. */
  type?: "BINARY" | "JSON" | "STRING" | "AVRO" | "PROTOBUF" | "JSONSCHEMA";
  /** The data value. */
  data?: unknown;
  /** Schema ID for schema-based serialization. */
  schemaId?: number;
  /** Schema version for schema-based serialization. */
  schemaVersion?: number;
  /** Subject name for schema lookup. */
  subject?: string;
}

/**
 * Response from a list API call.
 */
interface ListResponse<T> {
  kind: string;
  metadata: {
    self: string;
    next?: string;
  };
  data: T[];
}

/**
 * Kafka REST API v3 Proxy.
 *
 * Provides methods for interacting with Kafka clusters via the REST API.
 */
export class KafkaRestProxy {
  private readonly client: HttpClient;
  private readonly clusterId: string;
  private readonly customHeaders: Record<string, string>;

  /**
   * Creates a new Kafka REST proxy.
   * @param config Proxy configuration.
   */
  constructor(config: KafkaRestProxyConfig) {
    this.clusterId = config.clusterId;
    this.customHeaders = config.headers ?? {};

    this.client = createHttpClient({
      baseUrl: config.baseUrl,
      timeout: config.timeout ?? 30000,
      auth: config.auth,
      defaultHeaders: {
        ...this.customHeaders,
      },
    });
  }

  /**
   * Gets the cluster ID.
   */
  getClusterId(): string {
    return this.clusterId;
  }

  /**
   * Gets cluster information.
   * @returns Cluster data.
   */
  async getCluster(): Promise<ClusterData> {
    const response = await this.client.get<ClusterData>(this.clusterPath());
    return response.data;
  }

  /**
   * Lists all topics in the cluster.
   * @param options List options.
   * @returns Array of topic data.
   */
  async listTopics(options?: ListTopicsOptions): Promise<TopicData[]> {
    const params: Record<string, string | boolean | undefined> = {};
    if (options?.includeAuthorizedOperations) {
      params.includeAuthorizedOperations = true;
    }

    const response = await this.client.get<ListResponse<TopicData>>(
      `${this.clusterPath()}/topics`,
      { params },
    );
    return response.data.data;
  }

  /**
   * Gets a specific topic by name.
   * @param topicName Topic name.
   * @param options Additional options.
   * @returns Topic data.
   */
  async getTopic(topicName: string, options?: ListTopicsOptions): Promise<TopicData> {
    const params: Record<string, string | boolean | undefined> = {};
    if (options?.includeAuthorizedOperations) {
      params.includeAuthorizedOperations = true;
    }

    const response = await this.client.get<TopicData>(
      `${this.clusterPath()}/topics/${encodeURIComponent(topicName)}`,
      { params },
    );
    return response.data;
  }

  /**
   * Creates a new topic.
   * @param options Topic creation options.
   * @returns Created topic data.
   */
  async createTopic(options: CreateTopicOptions): Promise<TopicData> {
    const body: CreateTopicRequestData = {
      topic_name: options.topicName,
      partitions_count: options.partitionsCount,
      replication_factor: options.replicationFactor,
      configs: options.configs?.map((c) => ({ name: c.name, value: c.value })),
    };

    const response = await this.client.post<TopicData>(`${this.clusterPath()}/topics`, body);
    return response.data;
  }

  /**
   * Deletes a topic.
   * @param topicName Topic name to delete.
   */
  async deleteTopic(topicName: string): Promise<void> {
    await this.client.delete(`${this.clusterPath()}/topics/${encodeURIComponent(topicName)}`);
  }

  /**
   * Lists partitions for a topic.
   * @param topicName Topic name.
   * @returns Array of partition data.
   */
  async listPartitions(topicName: string): Promise<PartitionData[]> {
    const response = await this.client.get<ListResponse<PartitionData>>(
      `${this.clusterPath()}/topics/${encodeURIComponent(topicName)}/partitions`,
    );
    return response.data.data;
  }

  /**
   * Gets a specific partition.
   * @param topicName Topic name.
   * @param partitionId Partition ID.
   * @returns Partition data.
   */
  async getPartition(topicName: string, partitionId: number): Promise<PartitionData> {
    const response = await this.client.get<PartitionData>(
      `${this.clusterPath()}/topics/${encodeURIComponent(topicName)}/partitions/${partitionId}`,
    );
    return response.data;
  }

  /**
   * Lists configurations for a topic.
   * @param topicName Topic name.
   * @returns Array of topic configuration data.
   */
  async listTopicConfigs(topicName: string): Promise<TopicConfigData[]> {
    const response = await this.client.get<ListResponse<TopicConfigData>>(
      `${this.clusterPath()}/topics/${encodeURIComponent(topicName)}/configs`,
    );
    return response.data.data;
  }

  /**
   * Gets a specific topic configuration.
   * @param topicName Topic name.
   * @param configName Configuration name.
   * @returns Topic configuration data.
   */
  async getTopicConfig(topicName: string, configName: string): Promise<TopicConfigData> {
    const response = await this.client.get<TopicConfigData>(
      `${this.clusterPath()}/topics/${encodeURIComponent(topicName)}/configs/${encodeURIComponent(configName)}`,
    );
    return response.data;
  }

  /**
   * Updates topic configurations in batch.
   * @param options Update options.
   */
  async updateTopicConfigs(options: UpdateTopicConfigOptions): Promise<void> {
    const body: AlterConfigBatchRequestData = {
      data: options.configs.map((c) => ({
        name: c.name,
        operation: c.operation,
        value: c.value,
      })),
    };

    await this.client.post(
      `${this.clusterPath()}/topics/${encodeURIComponent(options.topicName)}/configs:alter`,
      body,
    );
  }

  /**
   * Produces a record to a topic.
   * @param options Record production options.
   * @returns Produce response with offset information.
   */
  async produceRecord(options: ProduceRecordOptions): Promise<ProduceResponse> {
    const body: ProduceRequest = {
      partition_id: options.partitionId,
      headers: options.headers?.map((h) => ({ name: h.name, value: btoa(h.value) })),
      key: options.key
        ? {
            type: options.key.type,
            data: options.key.data,
            schema_id: options.key.schemaId,
            schema_version: options.key.schemaVersion,
            subject: options.key.subject,
          }
        : undefined,
      value: options.value
        ? {
            type: options.value.type,
            data: options.value.data,
            schema_id: options.value.schemaId,
            schema_version: options.value.schemaVersion,
            subject: options.value.subject,
          }
        : undefined,
      timestamp: options.timestamp,
    };

    const response = await this.client.post<ProduceResponse>(
      `${this.clusterPath()}/topics/${encodeURIComponent(options.topicName)}/records`,
      body,
    );
    return response.data;
  }

  /**
   * Checks if a topic exists.
   * @param topicName Topic name.
   * @returns True if the topic exists.
   */
  async topicExists(topicName: string): Promise<boolean> {
    try {
      await this.getTopic(topicName);
      return true;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Builds the base path for cluster operations.
   */
  private clusterPath(): string {
    return `/kafka/v3/clusters/${encodeURIComponent(this.clusterId)}`;
  }
}

/**
 * Creates a Kafka REST proxy with the given configuration.
 * @param config Proxy configuration.
 * @returns A configured Kafka REST proxy.
 */
export function createKafkaRestProxy(config: KafkaRestProxyConfig): KafkaRestProxy {
  return new KafkaRestProxy(config);
}

// Import types from generated clients
import type {
  TopicData,
  PartitionData,
  TopicConfigData,
  ClusterData,
  ProduceRequest,
  ProduceResponse,
  CreateTopicRequestData,
  AlterConfigBatchRequestData,
} from "../clients/kafkaRest/models";
