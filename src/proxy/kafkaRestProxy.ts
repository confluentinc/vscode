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

import { Logger } from "../logging";
import { createHttpClient, HttpError, type AuthConfig, type HttpClient } from "./httpClient";

const logger = new Logger("kafkaRestProxy");

// Re-export types from generated clients for convenience
export type {
  AlterConfigBatchRequestData,
  ClusterData,
  CreateTopicRequestData,
  PartitionData,
  PartitionDataList,
  ProduceRequest,
  ProduceResponse,
  TopicConfigData,
  TopicConfigDataList,
  TopicData,
  TopicDataList,
} from "../clients/kafkaRest/models";

/**
 * API version/format for the Kafka REST API.
 *
 * - "v3": Confluent Kafka REST v3 API (e.g., /kafka/v3/clusters/{cluster_id}/topics)
 *         Used by some Confluent Platform deployments.
 * - "v3-ccloud": CCloud-specific Kafka REST v3 API with internal consume endpoint.
 *                Uses /kafka/v3/clusters/{cluster_id}/internal/topics/{topic}/partitions/-/records:consume_guarantee_progress
 * - "v3-local": Kafka REST v3 API without /kafka prefix (e.g., /v3/clusters/{cluster_id}/topics)
 *               Used by confluent-local Docker containers which support v3 but with different paths.
 * - "v2": Kafka REST Proxy v2 API (e.g., /topics)
 *         Deprecated for LOCAL connections - prefer v3-local.
 */
export type KafkaRestApiVersion = "v2" | "v3" | "v3-ccloud" | "v3-local";

/**
 * Kafka REST proxy configuration.
 */
export interface KafkaRestProxyConfig {
  /** Base URL for the Kafka REST API. */
  baseUrl: string;
  /** Kafka cluster ID (required for v3 API, optional for v2). */
  clusterId: string;
  /** Authentication configuration. */
  auth?: AuthConfig;
  /** Request timeout in milliseconds. */
  timeout?: number;
  /** Custom headers to include in all requests. */
  headers?: Record<string, string>;
  /**
   * API version to use. Defaults to "v3".
   * - "v3": Uses /kafka/v3/clusters/{cluster_id}/... paths (Confluent Cloud)
   * - "v3-local": Uses /v3/clusters/{cluster_id}/... paths (confluent-local)
   * - "v2": Uses /topics, /topics/{name}/... paths (standalone REST Proxy)
   */
  apiVersion?: KafkaRestApiVersion;
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
  private readonly apiVersion: KafkaRestApiVersion;

  /**
   * Creates a new Kafka REST proxy.
   * @param config Proxy configuration.
   */
  constructor(config: KafkaRestProxyConfig) {
    this.clusterId = config.clusterId;
    this.customHeaders = config.headers ?? {};
    this.apiVersion = config.apiVersion ?? "v3";

    // v2 API (REST Proxy) requires specific content types and does NOT accept
    // Content-Type headers on GET requests (causes 415 Unsupported Media Type).
    // v3 API (Confluent Cloud) uses standard application/json.
    // For v2, we only set Accept header here; Content-Type is added per-request for POST/PUT.
    const defaultHeaders: Record<string, string> =
      this.apiVersion === "v2"
        ? {
            Accept: "application/vnd.kafka.v2+json",
            // Override the httpClient default to prevent Content-Type on GET requests
            "Content-Type": "",
          }
        : {};

    this.client = createHttpClient({
      baseUrl: config.baseUrl,
      timeout: config.timeout ?? 30000,
      auth: config.auth,
      defaultHeaders: {
        ...defaultHeaders,
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
      // The Kafka REST v3 API has an inconsistency: listTopics uses camelCase,
      // while getTopic uses snake_case. See OpenAPI spec line 847 vs 910.
      params.includeAuthorizedOperations = true;
    }

    logger.debug(
      `listing topics with params: ${JSON.stringify(params)}, apiVersion: ${this.apiVersion}`,
    );

    if (this.apiVersion === "v2") {
      // v2 REST Proxy returns a plain string array: ["topic1", "topic2"]
      const response = await this.client.get<string[]>(this.topicsPath(), { params });
      // Transform to TopicData format (limited info available from v2 list endpoint)
      return response.data.map((name) => ({
        topic_name: name,
        is_internal: name.startsWith("_"),
        replication_factor: 0, // Not available from v2 list
        partitions_count: 0, // Not available from v2 list
      })) as TopicData[];
    }

    // v3 API returns wrapped response: { kind: "...", metadata: {...}, data: [...] }
    const response = await this.client.get<ListResponse<TopicData>>(this.topicsPath(), { params });
    logger.debug(
      `listTopics response: ${response.data.data.length} topics, first topic authorized_operations: ${JSON.stringify(response.data.data[0]?.authorized_operations)}`,
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
      // The Kafka REST v3 API has an inconsistency: getTopic uses snake_case,
      // while listTopics uses camelCase. See OpenAPI spec line 910 vs 847.
      params.include_authorized_operations = true;
    }

    const response = await this.client.get<TopicData>(this.topicPath(topicName), { params });
    logger.debug(
      `getTopic ${topicName} authorized_operations: ${JSON.stringify(response.data.authorized_operations)}`,
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

    const response = await this.client.post<TopicData>(this.topicsPath(), body);
    return response.data;
  }

  /**
   * Deletes a topic.
   * @param topicName Topic name to delete.
   */
  async deleteTopic(topicName: string): Promise<void> {
    await this.client.delete(this.topicPath(topicName));
  }

  /**
   * Lists partitions for a topic.
   * @param topicName Topic name.
   * @returns Array of partition data.
   */
  async listPartitions(topicName: string): Promise<PartitionData[]> {
    const response = await this.client.get<ListResponse<PartitionData>>(
      `${this.topicPath(topicName)}/partitions`,
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
      `${this.topicPath(topicName)}/partitions/${partitionId}`,
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
      `${this.topicPath(topicName)}/configs`,
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
      `${this.topicPath(topicName)}/configs/${encodeURIComponent(configName)}`,
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

    await this.client.post(`${this.topicPath(options.topicName)}/configs:alter`, body);
  }

  /**
   * Produces a record to a topic.
   * @param options Record production options.
   * @returns Produce response with offset information.
   */
  async produceRecord(options: ProduceRecordOptions): Promise<ProduceResponse> {
    // Build the produce request body
    // Note: We use type assertions because our extended interfaces include additional
    // fields (like schema_id) that aren't in the generated OpenAPI types
    const body: ProduceRequest = {
      partition_id: options.partitionId,
      headers: options.headers?.map((h) => ({ name: h.name, value: btoa(h.value) })),
      key: options.key
        ? ({
            type: options.key.type,
            data: options.key.data,
            schema_id: options.key.schemaId,
            schema_version: options.key.schemaVersion,
            subject: options.key.subject,
          } as ProduceRequestData)
        : undefined,
      value: options.value
        ? ({
            type: options.value.type,
            data: options.value.data,
            schema_id: options.value.schemaId,
            schema_version: options.value.schemaVersion,
            subject: options.value.subject,
          } as ProduceRequestData)
        : undefined,
      timestamp: options.timestamp ? new Date(options.timestamp) : undefined,
    };

    const response = await this.client.post<ProduceResponse>(
      `${this.topicPath(options.topicName)}/records`,
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
   * - v3 API: /kafka/v3/clusters/{cluster_id}
   * - v3-local API: /v3/clusters/{cluster_id}
   * - v2 API: (empty string, operations use root-level paths)
   */
  private clusterPath(): string {
    if (this.apiVersion === "v2") {
      return "";
    }
    if (this.apiVersion === "v3-local") {
      return `/v3/clusters/${encodeURIComponent(this.clusterId)}`;
    }
    return `/kafka/v3/clusters/${encodeURIComponent(this.clusterId)}`;
  }

  /**
   * Builds the path for topic operations.
   * - v3 API: /kafka/v3/clusters/{cluster_id}/topics
   * - v3-local API: /v3/clusters/{cluster_id}/topics
   * - v2 API: /topics
   */
  private topicsPath(): string {
    if (this.apiVersion === "v2") {
      return "/topics";
    }
    return `${this.clusterPath()}/topics`;
  }

  /**
   * Builds the path for a specific topic.
   * - v3 API: /kafka/v3/clusters/{cluster_id}/topics/{topic_name}
   * - v3-local API: /v3/clusters/{cluster_id}/topics/{topic_name}
   * - v2 API: /topics/{topic_name}
   */
  private topicPath(topicName: string): string {
    return `${this.topicsPath()}/${encodeURIComponent(topicName)}`;
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

/**
 * Offset for a partition when consuming.
 */
export interface PartitionOffset {
  /** Partition ID. */
  partition_id?: number;
  /** Offset to start consuming from. */
  offset?: number;
}

/**
 * Request for consuming messages from multiple partitions.
 */
export interface ConsumeRequest {
  /** Partition offsets to consume from. */
  offsets?: PartitionOffset[];
  /** Maximum number of records to poll. */
  max_poll_records?: number;
  /** Timestamp to start consuming from. */
  timestamp?: number;
  /** Maximum bytes to fetch. */
  fetch_max_bytes?: number;
  /** Maximum bytes per message. */
  message_max_bytes?: number;
  /** Whether to start from beginning. */
  from_beginning?: boolean;
}

/**
 * Header in a consumed record.
 */
export interface ConsumeRecordHeader {
  /** Header name. */
  name?: string;
  /** Header value (base64 encoded). */
  value?: string;
}

/**
 * Metadata about a consumed record's schema.
 */
export interface ConsumeRecordMetadata {
  /** Key schema ID. */
  key_schema_id?: number;
  /** Key schema subject. */
  key_schema_subject?: string;
  /** Key schema version. */
  key_schema_version?: number;
  /** Key schema type (AVRO, PROTOBUF, JSON). */
  key_schema_type?: string;
  /** Key data format used for deserialization. */
  key_data_format?: string;
  /** Key deserialization error message. */
  key_error?: string;
  /** Value schema ID. */
  value_schema_id?: number;
  /** Value schema subject. */
  value_schema_subject?: string;
  /** Value schema version. */
  value_schema_version?: number;
  /** Value schema type (AVRO, PROTOBUF, JSON). */
  value_schema_type?: string;
  /** Value data format used for deserialization. */
  value_data_format?: string;
  /** Value deserialization error message. */
  value_error?: string;
}

/**
 * A consumed record from a partition.
 */
export interface ConsumeRecord {
  /** Partition ID. */
  partition_id?: number;
  /** Record offset. */
  offset?: number;
  /** Record timestamp. */
  timestamp?: number;
  /** Timestamp type. */
  timestamp_type?: "NO_TIMESTAMP_TYPE" | "CREATE_TIME" | "LOG_APPEND_TIME";
  /** Record headers. */
  headers?: ConsumeRecordHeader[];
  /** Record key. */
  key?: unknown;
  /** Record value. */
  value?: unknown;
  /** Schema metadata. */
  metadata?: ConsumeRecordMetadata;
  /** Key decoding error. */
  key_decoding_error?: string;
  /** Value decoding error. */
  value_decoding_error?: string;
}

/**
 * Data for a partition in a consume response.
 */
export interface ConsumePartitionData {
  /** Partition ID. */
  partition_id?: number;
  /** Next offset to consume from. */
  next_offset?: number;
  /** Consumed records. */
  records?: ConsumeRecord[];
}

/**
 * Response from consuming messages.
 */
export interface ConsumeResponse {
  /** Cluster ID. */
  cluster_id?: string;
  /** Topic name. */
  topic_name?: string;
  /** Partition data with consumed records. */
  partition_data_list?: ConsumePartitionData[];
}

/**
 * Kafka message consumer proxy.
 *
 * Provides a consume API that adapts to different API versions:
 * - v3 (CCloud): Uses the simple `/partitions/-/consume` endpoint
 * - v3-local: Uses the same endpoint but without `/kafka` prefix
 * - v2: Uses the REST Proxy v2 consumer group workflow (create, subscribe, poll, delete)
 */
export class KafkaConsumeProxy {
  private readonly client: HttpClient;
  private readonly clusterId: string;
  private readonly customHeaders: Record<string, string>;
  private readonly apiVersion: KafkaRestApiVersion;

  // V2 consumer state management
  private v2ConsumerBaseUri: string | null = null;
  private v2ConsumerGroup: string | null = null;
  private v2ConsumerId: string | null = null;
  private v2SubscribedTopic: string | null = null;
  private v2FromBeginning: boolean | null = null;
  // Store records from initial poll (partition assignment poll may return records)
  private v2InitialPollRecords: V2ConsumeRecord[] | null = null;

  constructor(config: KafkaRestProxyConfig) {
    this.clusterId = config.clusterId;
    this.customHeaders = config.headers ?? {};
    this.apiVersion = config.apiVersion ?? "v3";

    // V2 API requires specific content types and does NOT accept
    // Content-Type headers on GET requests (causes 415 Unsupported Media Type).
    // We set Content-Type to empty to override httpClient's default.
    const defaultHeaders: Record<string, string> =
      this.apiVersion === "v2"
        ? {
            Accept: "application/vnd.kafka.json.v2+json",
            "Content-Type": "",
          }
        : {};

    this.client = createHttpClient({
      baseUrl: config.baseUrl,
      timeout: config.timeout ?? 30000,
      auth: config.auth,
      defaultHeaders: {
        ...defaultHeaders,
        ...this.customHeaders,
      },
    });
  }

  /**
   * Consumes messages from a topic.
   *
   * For v3/v3-local APIs, uses the simple consume endpoint.
   * For v2 API, manages a consumer instance with create/subscribe/poll workflow.
   *
   * @param topicName Topic to consume from.
   * @param request Consume request parameters.
   * @param signal Optional abort signal.
   * @returns Consume response with records.
   */
  async consume(
    topicName: string,
    request: ConsumeRequest,
    signal?: AbortSignal,
  ): Promise<ConsumeResponse> {
    if (this.apiVersion === "v2") {
      return this.consumeV2(topicName, request, signal);
    }

    // Build path based on API version
    let path: string;
    if (this.apiVersion === "v3-ccloud") {
      // CCloud uses an internal endpoint with a different path structure
      path = `/kafka/v3/clusters/${encodeURIComponent(this.clusterId)}/internal/topics/${encodeURIComponent(topicName)}/partitions/-/records:consume_guarantee_progress`;
    } else {
      // v3 or v3-local API: use simple consume endpoint
      const prefix = this.apiVersion === "v3-local" ? "" : "/kafka";
      path = `${prefix}/v3/clusters/${encodeURIComponent(this.clusterId)}/topics/${encodeURIComponent(topicName)}/partitions/-/consume`;
    }

    const response = await this.client.post<ConsumeResponse>(path, request, { signal });
    return response.data;
  }

  /**
   * V2 consumer workflow: create consumer, subscribe, poll records.
   */
  private async consumeV2(
    topicName: string,
    request: ConsumeRequest,
    signal?: AbortSignal,
  ): Promise<ConsumeResponse> {
    logger.debug(`consumeV2: starting for topic=${topicName}`);

    // Ensure consumer exists and is subscribed to the topic
    await this.ensureV2Consumer(topicName, request, signal);

    // Check if we have records from the initial poll (partition assignment poll)
    // that need to be returned first
    if (this.v2InitialPollRecords && this.v2InitialPollRecords.length > 0) {
      const records = this.v2InitialPollRecords;
      this.v2InitialPollRecords = null;
      logger.debug(`consumeV2: returning ${records.length} records from initial poll`);
      return this.transformV2Response(topicName, records);
    }

    // Build query params for the records request
    const params = new URLSearchParams();
    if (request.max_poll_records) {
      params.set("max_bytes", String(request.fetch_max_bytes ?? 40 * 1024 * 1024));
    }
    // Use a shorter timeout for polling to avoid blocking too long
    params.set("timeout", "3000");

    const queryString = params.toString();
    const recordsPath = `${this.v2ConsumerBaseUri}/records${queryString ? `?${queryString}` : ""}`;
    logger.debug(`consumeV2: polling records from ${recordsPath}`);

    const response = await this.client.get<V2ConsumeRecord[]>(recordsPath, { signal });
    logger.debug(`consumeV2: received ${response.data?.length ?? 0} records`);

    // Transform v2 response to ConsumeResponse format
    return this.transformV2Response(topicName, response.data);
  }

  /**
   * Ensures a v2 consumer exists and is subscribed to the topic.
   * Creates a new consumer if needed, or reuses existing one if subscribed to same topic.
   * Recreates consumer if consume mode changes (from_beginning setting) on a fresh request.
   */
  private async ensureV2Consumer(
    topicName: string,
    request: ConsumeRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    // For v2 consumers, from_beginning only matters at creation time.
    // Once created, subsequent requests should reuse the consumer.
    // A "fresh request" is when offsets is undefined (not just empty array).
    // Empty array means we got a response (even if empty) and should continue polling.
    // Undefined means the user changed mode or it's the first request.
    const isFreshRequest = request.offsets === undefined;
    const fromBeginning = request.from_beginning ?? false;

    const needsRecreation =
      // Topic changed
      this.v2SubscribedTopic !== topicName ||
      // Consume mode changed on a FRESH request (no offsets means starting over)
      (isFreshRequest && this.v2FromBeginning !== fromBeginning && this.v2ConsumerBaseUri !== null);

    logger.debug(
      `ensureV2Consumer: topic=${topicName}, fromBeginning=${fromBeginning}, ` +
        `isFreshRequest=${isFreshRequest}, existingUri=${this.v2ConsumerBaseUri}, ` +
        `needsRecreation=${needsRecreation}`,
    );

    // If we have an existing consumer with matching settings, reuse it
    if (this.v2ConsumerBaseUri && !needsRecreation) {
      logger.debug("ensureV2Consumer: reusing existing consumer");
      return;
    }

    // Clean up any existing consumer before creating a new one
    await this.cleanupV2Consumer();

    // Create a unique consumer group and instance for this session
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    this.v2ConsumerGroup = `vscode-consumer-${timestamp}-${random}`;
    this.v2ConsumerId = `instance-${random}`;

    // Create consumer
    const createPath = `/consumers/${encodeURIComponent(this.v2ConsumerGroup)}`;
    const createBody: V2CreateConsumerRequest = {
      name: this.v2ConsumerId,
      format: "json",
      "auto.offset.reset": request.from_beginning ? "earliest" : "latest",
    };

    logger.debug(`ensureV2Consumer: creating consumer at ${createPath}`);
    const createResponse = await this.client.post<V2CreateConsumerResponse>(
      createPath,
      createBody,
      {
        signal,
        headers: { "Content-Type": "application/vnd.kafka.v2+json" },
      },
    );

    logger.debug(
      `ensureV2Consumer: consumer created, response=${JSON.stringify(createResponse.data)}`,
    );

    if (!createResponse.data?.base_uri) {
      throw new Error(
        `V2 consumer create response missing base_uri: ${JSON.stringify(createResponse.data)}`,
      );
    }

    // Extract base URI from response (handles different hostnames)
    this.v2ConsumerBaseUri = this.normalizeV2ConsumerUri(createResponse.data.base_uri);
    logger.debug(`ensureV2Consumer: normalized URI=${this.v2ConsumerBaseUri}`);

    // Subscribe to topic
    const subscribePath = `${this.v2ConsumerBaseUri}/subscription`;
    logger.debug(`ensureV2Consumer: subscribing at ${subscribePath}`);
    await this.client.post(
      subscribePath,
      { topics: [topicName] },
      { signal, headers: { "Content-Type": "application/vnd.kafka.v2+json" } },
    );

    this.v2SubscribedTopic = topicName;
    this.v2FromBeginning = fromBeginning;

    // Do an initial poll to trigger partition assignment
    // IMPORTANT: This poll may return records, so we store them to return later
    try {
      const initialPollPath = `${this.v2ConsumerBaseUri}/records?timeout=1000`;
      logger.debug(`ensureV2Consumer: initial poll at ${initialPollPath}`);
      const initialResponse = await this.client.get<V2ConsumeRecord[]>(initialPollPath, { signal });
      if (initialResponse.data && initialResponse.data.length > 0) {
        logger.debug(
          `ensureV2Consumer: initial poll returned ${initialResponse.data.length} records, storing for return`,
        );
        this.v2InitialPollRecords = initialResponse.data;
      }
    } catch (err) {
      // Ignore errors on initial poll - it's just to trigger assignment
      logger.debug(`ensureV2Consumer: initial poll error (expected): ${err}`);
    }

    logger.debug("ensureV2Consumer: consumer setup complete");
  }

  /**
   * Normalizes the base URI returned by the v2 consumer create response.
   * The response may contain internal hostnames (e.g., "rest-proxy:8082")
   * that need to be replaced with the client's base URL.
   */
  private normalizeV2ConsumerUri(baseUri: string): string {
    logger.debug(`normalizeV2ConsumerUri: input=${baseUri}`);
    try {
      // Extract the path portion after the host
      const url = new URL(baseUri);
      const pathname = url.pathname;
      logger.debug(`normalizeV2ConsumerUri: extracted pathname=${pathname}`);
      return pathname;
    } catch (err) {
      logger.error(`normalizeV2ConsumerUri: failed to parse URL: ${err}`);
      // If the URI is already a path (starts with /), use it directly
      if (baseUri.startsWith("/")) {
        return baseUri;
      }
      throw err;
    }
  }

  /**
   * Transforms v2 consumer records to the ConsumeResponse format.
   */
  private transformV2Response(topicName: string, records: V2ConsumeRecord[]): ConsumeResponse {
    // Group records by partition
    const partitionMap = new Map<number, ConsumeRecord[]>();

    for (const record of records) {
      const partitionId = record.partition ?? 0;
      if (!partitionMap.has(partitionId)) {
        partitionMap.set(partitionId, []);
      }
      partitionMap.get(partitionId)!.push({
        partition_id: partitionId,
        offset: record.offset,
        timestamp: record.timestamp,
        key: record.key,
        value: record.value,
        headers: record.headers?.map((h) => ({ name: h.key, value: h.value })),
      });
    }

    // Build partition data list
    const partitionDataList: ConsumePartitionData[] = [];
    for (const [partitionId, partitionRecords] of partitionMap) {
      const maxOffset = Math.max(...partitionRecords.map((r) => r.offset ?? 0));
      partitionDataList.push({
        partition_id: partitionId,
        records: partitionRecords,
        next_offset: maxOffset + 1,
      });
    }

    return {
      cluster_id: this.clusterId,
      topic_name: topicName,
      partition_data_list: partitionDataList,
    };
  }

  /**
   * Cleans up the v2 consumer instance.
   */
  private async cleanupV2Consumer(): Promise<void> {
    if (this.v2ConsumerBaseUri) {
      try {
        await this.client.delete(this.v2ConsumerBaseUri, {
          headers: { "Content-Type": "application/vnd.kafka.v2+json" },
        });
      } catch {
        // Ignore cleanup errors - consumer may have already expired
      }
    }
    this.v2ConsumerBaseUri = null;
    this.v2ConsumerGroup = null;
    this.v2ConsumerId = null;
    this.v2SubscribedTopic = null;
    this.v2FromBeginning = null;
    this.v2InitialPollRecords = null;
  }

  /**
   * Lists partitions for a topic.
   * @param topicName Topic name.
   * @returns Partition data.
   */
  async listPartitions(topicName: string): Promise<{ data: PartitionData[] }> {
    if (this.apiVersion === "v2") {
      // V2 API doesn't have a direct partitions endpoint with full data
      // Use the topics/{topic}/partitions endpoint
      const response = await this.client.get<V2PartitionInfo[]>(
        `/topics/${encodeURIComponent(topicName)}/partitions`,
        { headers: { Accept: "application/vnd.kafka.v2+json" } },
      );
      return {
        data: response.data.map((p) => ({
          partition_id: p.partition,
          // V2 doesn't provide all the same fields as v3
        })) as PartitionData[],
      };
    }

    const prefix = this.apiVersion === "v3-local" ? "" : "/kafka";
    const response = await this.client.get<ListResponse<PartitionData>>(
      `${prefix}/v3/clusters/${encodeURIComponent(this.clusterId)}/topics/${encodeURIComponent(topicName)}/partitions`,
    );
    return { data: response.data.data };
  }

  /**
   * Disposes of the consumer proxy, cleaning up any v2 consumer instances.
   */
  async dispose(): Promise<void> {
    await this.cleanupV2Consumer();
  }
}

/**
 * V2 consumer create request.
 */
interface V2CreateConsumerRequest {
  name: string;
  format: "json" | "binary" | "avro";
  "auto.offset.reset"?: "earliest" | "latest";
  "auto.commit.enable"?: string;
  "fetch.min.bytes"?: string;
  "consumer.request.timeout.ms"?: string;
}

/**
 * V2 consumer create response.
 */
interface V2CreateConsumerResponse {
  instance_id: string;
  base_uri: string;
}

/**
 * V2 consume record format.
 */
interface V2ConsumeRecord {
  topic?: string;
  key?: unknown;
  value?: unknown;
  partition?: number;
  offset?: number;
  timestamp?: number;
  headers?: Array<{ key: string; value: string }>;
}

/**
 * V2 partition info.
 */
interface V2PartitionInfo {
  partition: number;
  leader: number;
  replicas: Array<{ broker: number; leader: boolean; in_sync: boolean }>;
}

/**
 * Creates a Kafka consume proxy with the given configuration.
 * @param config Proxy configuration.
 * @returns A configured Kafka consume proxy.
 */
export function createKafkaConsumeProxy(config: KafkaRestProxyConfig): KafkaConsumeProxy {
  return new KafkaConsumeProxy(config);
}

// Import types from generated clients
import type {
  AlterConfigBatchRequestData,
  ClusterData,
  CreateTopicRequestData,
  PartitionData,
  ProduceRequest,
  ProduceRequestData,
  ProduceResponse,
  TopicConfigData,
  TopicData,
} from "../clients/kafkaRest/models";
