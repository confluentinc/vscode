/**
 * Topic Service Factory.
 *
 * Factory for creating the appropriate TopicService implementation based on
 * connection type and runtime environment.
 *
 * Decision tree:
 * 1. CCloud → Always use REST API (v3 with OAuth)
 * 2. LOCAL → Always use REST API (v3-local) - confluent-local containers support v3
 *            and this allows fetching authorized_operations
 * 3. DIRECT on Desktop → Use kafkajs Admin with ACL-based authorized_operations
 * 4. DIRECT on Web → Use REST API (v3)
 */

import { ConnectionType } from "../connections";
import { Logger } from "../logging";
import type { KafkaCluster } from "../models/kafkaCluster";
import { isDesktopEnvironment } from "./environment";
import { getKafkaAdminTopicService } from "./kafkaAdminTopicService";
import { getRestApiTopicService } from "./restApiTopicService";
import type { PartitionInfo, TopicInfo, TopicService } from "./topicService";

const logger = new Logger("kafka.topicServiceFactory");

/**
 * Simplified TopicData interface for internal use.
 *
 * The generated TopicData from the OpenAPI spec is too strict and doesn't match
 * the runtime response shape. This interface captures what we actually use.
 */
export interface SimpleTopicData {
  topic_name: string;
  is_internal?: boolean;
  replication_factor?: number;
  partitions_count?: number;
  partitions?: unknown;
  configs?: unknown;
  authorized_operations?: string[];
}

/**
 * Gets the appropriate TopicService for the given cluster.
 *
 * @param cluster The Kafka cluster to get a service for.
 * @returns The appropriate TopicService implementation.
 */
export function getTopicService(cluster: KafkaCluster): TopicService {
  // CCloud always uses REST API with OAuth
  if (cluster.connectionType === ConnectionType.Ccloud) {
    logger.debug(`using RestApiTopicService(v3) for CCloud cluster ${cluster.id}`);
    return getRestApiTopicService("v3");
  }

  // LOCAL always uses REST API v3-local - confluent-local containers support v3
  // but with different path prefix (/v3/ instead of /kafka/v3/)
  // This allows fetching authorized_operations
  if (cluster.connectionType === ConnectionType.Local) {
    logger.debug(`using RestApiTopicService(v3-local) for LOCAL cluster ${cluster.id}`);
    return getRestApiTopicService("v3-local");
  }

  // DIRECT connections on desktop use kafkajs Admin with ACL-based authorized operations
  if (isDesktopEnvironment()) {
    logger.debug(`using KafkaAdminTopicService for DIRECT cluster ${cluster.id}`);
    return getKafkaAdminTopicService();
  }

  // Web fallback for DIRECT: use REST API v3
  logger.debug(`using RestApiTopicService(v3) for DIRECT cluster ${cluster.id} (web environment)`);
  return getRestApiTopicService("v3");
}

/**
 * Converts TopicInfo from the TopicService to SimpleTopicData for compatibility with existing code.
 *
 * @param topic The TopicInfo to convert.
 * @returns SimpleTopicData compatible with existing loader code.
 */
export function topicInfoToTopicData(topic: TopicInfo): SimpleTopicData {
  return {
    topic_name: topic.name,
    is_internal: topic.isInternal,
    replication_factor: topic.replicationFactor,
    partitions_count: topic.partitionCount,
    partitions:
      topic.partitions.length > 0
        ? {
            data: topic.partitions.map((p) => ({
              partition_id: p.partitionId,
              leader: p.leader !== -1 ? { broker_id: p.leader } : undefined,
              replicas:
                p.replicas.length > 0
                  ? { data: p.replicas.map((id) => ({ broker_id: id })) }
                  : undefined,
              isr: p.isr.length > 0 ? { data: p.isr.map((id) => ({ broker_id: id })) } : undefined,
            })),
          }
        : undefined,
    configs:
      Object.keys(topic.configs).length > 0
        ? {
            data: Object.entries(topic.configs).map(([name, value]) => ({ name, value })),
          }
        : undefined,
    authorized_operations: topic.authorizedOperations,
  };
}

/**
 * Converts SimpleTopicData from REST API to TopicInfo for unified handling.
 *
 * @param topicData The SimpleTopicData from REST API.
 * @returns TopicInfo for the TopicService interface.
 */
export function topicDataToTopicInfo(topicData: SimpleTopicData): TopicInfo {
  const partitionsRaw = topicData.partitions as
    | {
        data?: Array<{
          partition_id: number;
          leader?: { broker_id: number };
          replicas?: { data?: Array<{ broker_id: number }> };
          isr?: { data?: Array<{ broker_id: number }> };
        }>;
      }
    | undefined;

  const partitions: PartitionInfo[] = partitionsRaw?.data
    ? partitionsRaw.data.map((p) => ({
        partitionId: p.partition_id,
        leader: p.leader?.broker_id ?? -1,
        replicas: p.replicas?.data?.map((r) => r.broker_id) ?? [],
        isr: p.isr?.data?.map((r) => r.broker_id) ?? [],
      }))
    : [];

  const configsRaw = topicData.configs as
    | { data?: Array<{ name?: string; value?: string }> }
    | undefined;
  const configs: Record<string, string> = {};
  if (configsRaw?.data) {
    for (const config of configsRaw.data) {
      if (config.name && config.value !== undefined) {
        configs[config.name] = config.value;
      }
    }
  }

  return {
    name: topicData.topic_name,
    isInternal: topicData.is_internal ?? false,
    replicationFactor: topicData.replication_factor ?? 0,
    partitionCount: topicData.partitions_count ?? partitions.length,
    partitions,
    configs,
    authorizedOperations: topicData.authorized_operations,
  };
}
