/**
 * REST API Topic Service.
 *
 * Implementation of TopicService using Kafka REST API.
 * Used for:
 * - CCloud connections (v3 API with OAuth)
 * - LOCAL/DIRECT connections in VS Code for Web (v2/v3 API fallback)
 */

import { TokenManager } from "../auth/oauth2/tokenManager";
import { ConnectionType, CredentialType } from "../connections";
import { Logger } from "../logging";
import type { KafkaCluster } from "../models/kafkaCluster";
import type { AuthConfig } from "../proxy/httpClient";
import { HttpError } from "../proxy/httpClient";
import {
  createKafkaRestProxy,
  type KafkaRestApiVersion,
  type KafkaRestProxy,
  type TopicData,
} from "../proxy/kafkaRestProxy";
import { getResourceManager } from "../storage/resourceManager";
import { KafkaAdminError, KafkaAdminErrorCategory } from "./errors";
import type {
  CreateTopicOptions,
  ListTopicsOptions,
  PartitionInfo,
  TopicInfo,
  TopicService,
} from "./topicService";

/**
 * Runtime structure of partition data from the REST API.
 * Looser than the generated OpenAPI types to match actual responses.
 */
interface RuntimePartitionData {
  partition_id: number;
  leader?: { broker_id: number };
  replicas?: { data?: Array<{ broker_id: number }> };
  isr?: { data?: Array<{ broker_id: number }> };
}

/**
 * Runtime structure of topic data from the REST API.
 * The generated TopicData type is too strict (uses Relationship for nested objects)
 * but the actual API returns embedded data.
 */
interface RuntimeTopicData {
  topic_name: string;
  is_internal?: boolean;
  replication_factor?: number;
  partitions_count?: number;
  partitions?: { data?: RuntimePartitionData[] };
  configs?: { data?: Array<{ name?: string; value?: string }> };
  authorized_operations?: string[];
}

const logger = new Logger("kafka.restApiTopicService");

/**
 * Singleton instances by API version.
 */
const instances: Map<KafkaRestApiVersion, RestApiTopicService> = new Map();

/**
 * TopicService implementation using Kafka REST API.
 *
 * Supports both v2 (REST Proxy) and v3 (Confluent Cloud) API versions.
 */
export class RestApiTopicService implements TopicService {
  private readonly apiVersion: KafkaRestApiVersion;

  constructor(apiVersion: KafkaRestApiVersion = "v3") {
    this.apiVersion = apiVersion;
  }

  /**
   * Gets or creates a singleton instance for the given API version.
   */
  static getInstance(apiVersion: KafkaRestApiVersion = "v3"): RestApiTopicService {
    let service = instances.get(apiVersion);
    if (!service) {
      service = new RestApiTopicService(apiVersion);
      instances.set(apiVersion, service);
    }
    return service;
  }

  /**
   * Resets all singleton instances.
   * Used for testing purposes only.
   */
  static resetInstances(): void {
    instances.clear();
  }

  /**
   * Lists all topics in a Kafka cluster.
   */
  async listTopics(cluster: KafkaCluster, options?: ListTopicsOptions): Promise<TopicInfo[]> {
    logger.debug(`listing topics for cluster ${cluster.id} via REST API (${this.apiVersion})`);

    const proxy = await this.createProxy(cluster);

    try {
      const topics = await proxy.listTopics({
        includeAuthorizedOperations: options?.includeAuthorizedOperations,
      });

      // Filter internal topics if requested
      const filteredTopics = options?.includeInternal
        ? topics
        : topics.filter((t) => !t.is_internal);

      // Convert to TopicInfo
      const topicInfos = filteredTopics.map((t) => this.toTopicInfo(t));

      // Sort by name
      topicInfos.sort((a, b) => a.name.localeCompare(b.name));

      logger.debug(`found ${topicInfos.length} topic(s) in cluster ${cluster.id}`);
      return topicInfos;
    } catch (error) {
      throw this.wrapError(error, `Failed to list topics in cluster ${cluster.id}`);
    }
  }

  /**
   * Gets detailed information about a specific topic.
   */
  async describeTopic(cluster: KafkaCluster, topicName: string): Promise<TopicInfo> {
    logger.debug(`describing topic ${topicName} in cluster ${cluster.id} via REST API`);

    const proxy = await this.createProxy(cluster);

    try {
      const topic = await proxy.getTopic(topicName, {
        includeAuthorizedOperations: true,
      });
      return this.toTopicInfo(topic);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        throw new KafkaAdminError(
          `Topic '${topicName}' not found`,
          KafkaAdminErrorCategory.NOT_FOUND,
          { cause: error },
        );
      }
      throw this.wrapError(error, `Failed to describe topic '${topicName}'`);
    }
  }

  /**
   * Checks if a topic exists.
   */
  async topicExists(cluster: KafkaCluster, topicName: string): Promise<boolean> {
    logger.debug(`checking if topic ${topicName} exists in cluster ${cluster.id} via REST API`);

    const proxy = await this.createProxy(cluster);

    try {
      return await proxy.topicExists(topicName);
    } catch (error) {
      throw this.wrapError(error, `Failed to check if topic '${topicName}' exists`);
    }
  }

  /**
   * Creates a new topic.
   */
  async createTopic(cluster: KafkaCluster, options: CreateTopicOptions): Promise<void> {
    logger.debug(`creating topic ${options.topicName} in cluster ${cluster.id} via REST API`);

    const proxy = await this.createProxy(cluster);

    try {
      await proxy.createTopic({
        topicName: options.topicName,
        partitionsCount: options.partitionsCount,
        replicationFactor: options.replicationFactor,
        configs: options.configs
          ? Object.entries(options.configs).map(([name, value]) => ({ name, value }))
          : undefined,
      });

      logger.debug(`created topic ${options.topicName} in cluster ${cluster.id}`);
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        throw new KafkaAdminError(
          `Topic '${options.topicName}' already exists`,
          KafkaAdminErrorCategory.ALREADY_EXISTS,
          { cause: error },
        );
      }
      throw this.wrapError(error, `Failed to create topic '${options.topicName}'`);
    }
  }

  /**
   * Deletes a topic.
   */
  async deleteTopic(cluster: KafkaCluster, topicName: string): Promise<void> {
    logger.debug(`deleting topic ${topicName} from cluster ${cluster.id} via REST API`);

    const proxy = await this.createProxy(cluster);

    try {
      await proxy.deleteTopic(topicName);
      logger.debug(`deleted topic ${topicName} from cluster ${cluster.id}`);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        throw new KafkaAdminError(
          `Topic '${topicName}' not found`,
          KafkaAdminErrorCategory.NOT_FOUND,
          { cause: error },
        );
      }
      throw this.wrapError(error, `Failed to delete topic '${topicName}'`);
    }
  }

  /**
   * Creates a KafkaRestProxy for the given cluster.
   */
  private async createProxy(cluster: KafkaCluster): Promise<KafkaRestProxy> {
    if (!cluster.uri) {
      throw new KafkaAdminError(
        `Kafka cluster ${cluster.id} has no REST URI configured`,
        KafkaAdminErrorCategory.INVALID,
      );
    }

    const auth = await this.getAuthConfig(cluster);

    return createKafkaRestProxy({
      baseUrl: cluster.uri,
      clusterId: cluster.id,
      auth,
      apiVersion: this.apiVersion,
    });
  }

  /**
   * Gets authentication configuration for the cluster.
   */
  private async getAuthConfig(cluster: KafkaCluster): Promise<AuthConfig | undefined> {
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
   * Converts REST API TopicData to TopicInfo.
   *
   * The generated TopicData type uses Relationship (just a URL) for nested objects,
   * but the actual REST API returns embedded data. We cast to RuntimeTopicData
   * to access the actual runtime shape.
   */
  private toTopicInfo(topic: TopicData): TopicInfo {
    // Cast to runtime type to access actual response shape
    const runtimeTopic = topic as unknown as RuntimeTopicData;

    // Convert partitions if available
    const partitions: PartitionInfo[] = runtimeTopic.partitions?.data
      ? runtimeTopic.partitions.data.map((p) => ({
          partitionId: p.partition_id,
          leader: p.leader?.broker_id ?? -1,
          replicas: p.replicas?.data?.map((r) => r.broker_id) ?? [],
          isr: p.isr?.data?.map((r) => r.broker_id) ?? [],
        }))
      : [];

    return {
      name: runtimeTopic.topic_name,
      isInternal: runtimeTopic.is_internal ?? false,
      replicationFactor: runtimeTopic.replication_factor ?? 0,
      partitionCount: runtimeTopic.partitions_count ?? partitions.length,
      partitions,
      configs: this.convertConfigs(runtimeTopic.configs),
      authorizedOperations: runtimeTopic.authorized_operations,
    };
  }

  /**
   * Converts topic configs to a simple Record.
   */
  private convertConfigs(configs?: {
    data?: Array<{ name?: string; value?: string }>;
  }): Record<string, string> {
    if (!configs?.data) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const config of configs.data) {
      if (config.name && config.value !== undefined) {
        result[config.name] = config.value;
      }
    }
    return result;
  }

  /**
   * Wraps a raw error in a KafkaAdminError.
   */
  private wrapError(error: unknown, message: string): KafkaAdminError {
    if (error instanceof KafkaAdminError) {
      return error;
    }

    if (error instanceof HttpError) {
      const category = this.categorizeHttpError(error);
      return new KafkaAdminError(`${message}: ${error.message}`, category, { cause: error });
    }

    const originalError = error instanceof Error ? error : new Error(String(error));
    return new KafkaAdminError(
      `${message}: ${originalError.message}`,
      KafkaAdminErrorCategory.UNKNOWN,
      {
        cause: originalError,
      },
    );
  }

  /**
   * Categorizes an HTTP error.
   */
  private categorizeHttpError(error: HttpError): KafkaAdminErrorCategory {
    switch (error.status) {
      case 401:
      case 403:
        return KafkaAdminErrorCategory.AUTH;
      case 404:
        return KafkaAdminErrorCategory.NOT_FOUND;
      case 409:
        return KafkaAdminErrorCategory.ALREADY_EXISTS;
      case 400:
      case 422:
        return KafkaAdminErrorCategory.INVALID;
      case 500:
      case 502:
      case 503:
      case 504:
        return KafkaAdminErrorCategory.TRANSIENT;
      default:
        return KafkaAdminErrorCategory.UNKNOWN;
    }
  }
}

/**
 * Gets a RestApiTopicService instance for the given API version.
 */
export function getRestApiTopicService(
  apiVersion: KafkaRestApiVersion = "v3",
): RestApiTopicService {
  return RestApiTopicService.getInstance(apiVersion);
}
