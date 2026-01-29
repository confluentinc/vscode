/**
 * Native Kafka Consumer for message consumption.
 *
 * Uses kafkajs to consume messages directly from Kafka clusters,
 * providing full access to message metadata including timestamps.
 * Only available in desktop VS Code environments.
 */

import type { Consumer, EachMessagePayload, Kafka, KafkaConfig, KafkaMessage } from "kafkajs";
import { ConnectionType, type Credentials } from "../connections";
import { Logger } from "../logging";
import type { KafkaTopic } from "../models/topic";
import type {
  ConsumeRecord,
  ConsumeRecordMetadata,
  ConsumeRequest,
  ConsumeResponse,
  ConsumePartitionData,
} from "../proxy/kafkaRestProxy";
import type { RecordDeserializer } from "../serde/types";
import { getResourceManager } from "../storage/resourceManager";
import { toSaslOptions } from "./saslConfig";

const logger = new Logger("kafka.nativeConsumer");

/** Default poll timeout in milliseconds. */
const DEFAULT_POLL_TIMEOUT_MS = 3000;

/** Maximum records to return per poll. */
const DEFAULT_MAX_POLL_RECORDS = 500;

/**
 * Native Kafka consumer for message consumption.
 *
 * Uses kafkajs Consumer to poll messages directly from Kafka,
 * providing access to full message metadata including timestamps.
 */
export class NativeKafkaConsumer {
  private kafka: Kafka | null = null;
  private consumer: Consumer | null = null;
  private subscribedTopic: string | null = null;
  private fromBeginning: boolean | null = null;
  private readonly topic: KafkaTopic;
  private readonly clientId: string;
  private deserializer: RecordDeserializer | null = null;

  constructor(topic: KafkaTopic) {
    this.topic = topic;
    const random = Math.random().toString(36).substring(2, 8);
    this.clientId = `vscode-consumer-${Date.now()}-${random}`;
  }

  /**
   * Sets the deserializer for message keys and values.
   * @param deserializer The deserializer to use, or null to disable deserialization.
   */
  setDeserializer(deserializer: RecordDeserializer | null): void {
    this.deserializer = deserializer;
  }

  /**
   * Consumes messages from the topic.
   *
   * @param request Consume request parameters.
   * @param signal Optional abort signal.
   * @returns Consume response with records including timestamps.
   */
  async consume(request: ConsumeRequest, signal?: AbortSignal): Promise<ConsumeResponse> {
    logger.debug(`nativeConsume: starting for topic=${this.topic.name}`);

    const fromBeginning = request.from_beginning ?? false;
    const isFreshRequest = request.offsets === undefined;

    // Check if we need to recreate the consumer
    const needsRecreation =
      this.subscribedTopic !== this.topic.name ||
      (isFreshRequest && this.fromBeginning !== fromBeginning && this.consumer !== null);

    logger.debug(
      `nativeConsume: topic=${this.topic.name}, fromBeginning=${fromBeginning}, ` +
        `isFreshRequest=${isFreshRequest}, needsRecreation=${needsRecreation}`,
    );

    if (needsRecreation) {
      await this.cleanup();
    }

    // Ensure consumer is connected
    if (!this.consumer) {
      await this.createConsumer(fromBeginning);
    }

    // Poll for messages
    const maxRecords = request.max_poll_records ?? DEFAULT_MAX_POLL_RECORDS;
    const records = await this.poll(request, maxRecords, signal);

    return this.buildResponse(records);
  }

  /**
   * Creates and connects a new consumer.
   */
  private async createConsumer(fromBeginning: boolean): Promise<void> {
    logger.debug(`nativeConsume: creating consumer for topic=${this.topic.name}`);

    const config = await this.buildKafkaConfig();
    const brokersList = Array.isArray(config.brokers) ? config.brokers.join(",") : "dynamic";
    logger.debug(
      `nativeConsume: kafkajs config: brokers=${brokersList}, ` +
        `ssl=${config.ssl}, sasl=${config.sasl ? config.sasl.mechanism : "none"}`,
    );

    // Dynamic import of kafkajs
    const { Kafka } = await import("kafkajs");
    this.kafka = new Kafka(config);

    const groupId = `${this.clientId}-group`;
    logger.debug(`nativeConsume: creating consumer with groupId=${groupId}`);
    this.consumer = this.kafka.consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxWaitTimeInMs: DEFAULT_POLL_TIMEOUT_MS,
    });

    logger.debug(`nativeConsume: connecting consumer...`);
    await this.consumer.connect();
    logger.debug(`nativeConsume: consumer connected`);

    // Subscribe to topic
    logger.debug(
      `nativeConsume: subscribing to topic=${this.topic.name}, fromBeginning=${fromBeginning}`,
    );
    await this.consumer.subscribe({
      topic: this.topic.name,
      fromBeginning,
    });

    this.subscribedTopic = this.topic.name;
    this.fromBeginning = fromBeginning;

    logger.debug(`nativeConsume: consumer created and subscribed to ${this.topic.name}`);
  }

  /** Track whether consumer.run() has been called */
  private isRunning = false;

  /** Pending resolve callback for current poll */
  private pollResolve: ((records: ConsumeRecord[]) => void) | null = null;

  /** Records collected during current poll */
  private pendingRecords: ConsumeRecord[] = [];

  /** Maximum records for current poll */
  private currentMaxRecords = 0;

  /** Timeout handle for current poll */
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Polls for messages from the consumer.
   */
  private async poll(
    request: ConsumeRequest,
    maxRecords: number,
    signal?: AbortSignal,
  ): Promise<ConsumeRecord[]> {
    // Reset state for this poll
    this.pendingRecords = [];
    this.currentMaxRecords = maxRecords;

    // Store offsets to seek to after run() starts
    const offsetsToSeek = request.offsets ?? [];

    return new Promise((resolve, reject) => {
      this.pollResolve = resolve;

      // Set up abort handler
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            this.finishPoll();
          },
          { once: true },
        );
      }

      // Set up timeout
      this.pollTimeout = setTimeout(() => {
        this.finishPoll();
      }, DEFAULT_POLL_TIMEOUT_MS);

      // Start consumer.run() only once - it runs continuously
      if (!this.isRunning) {
        this.isRunning = true;
        this.consumer!.run({
          autoCommit: false,
          eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
            // Only process if we have an active poll
            if (!this.pollResolve || this.pendingRecords.length >= this.currentMaxRecords) {
              return;
            }

            const record = await this.transformMessage(topic, partition, message);
            this.pendingRecords.push(record);

            if (this.pendingRecords.length >= this.currentMaxRecords) {
              this.finishPoll();
            }
          },
        }).catch((error) => {
          this.isRunning = false;
          if (this.pollResolve) {
            this.pollResolve = null;
            reject(error);
          }
        });
      } else {
        // Consumer is already running - seek to offsets and resume
        for (const offsetReq of offsetsToSeek) {
          if (offsetReq.partition_id !== undefined && offsetReq.offset !== undefined) {
            logger.debug(
              `nativeConsume: seeking partition=${offsetReq.partition_id} to offset=${offsetReq.offset}`,
            );
            this.consumer!.seek({
              topic: this.topic.name,
              partition: offsetReq.partition_id,
              offset: String(offsetReq.offset),
            });
          }
        }

        // Resume the consumer
        logger.debug(`nativeConsume: resuming consumer for topic=${this.topic.name}`);
        this.consumer!.resume([{ topic: this.topic.name }]);
      }

      // Also resolve after timeout if no messages (backup timeout)
      setTimeout(() => {
        this.finishPoll();
      }, DEFAULT_POLL_TIMEOUT_MS + 500);
    });
  }

  /**
   * Finishes the current poll, pausing the consumer and resolving with collected records.
   */
  private finishPoll(): void {
    if (!this.pollResolve) {
      return;
    }

    // Clear timeout if set
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }

    // Pause the consumer
    this.consumer?.pause([{ topic: this.topic.name }]);

    // Resolve with collected records
    const resolve = this.pollResolve;
    const records = [...this.pendingRecords];
    this.pollResolve = null;
    this.pendingRecords = [];

    resolve(records);
  }

  /**
   * Transforms a kafkajs message to ConsumeRecord format.
   * Uses the deserializer if set, otherwise falls back to simple JSON/string parsing.
   */
  private async transformMessage(
    topic: string,
    partition: number,
    message: KafkaMessage,
  ): Promise<ConsumeRecord> {
    let key: unknown = null;
    let value: unknown = null;
    let keyDecodingError: string | undefined;
    let valueDecodingError: string | undefined;
    let metadata: ConsumeRecordMetadata | undefined;

    if (this.deserializer) {
      // Use deserializer for key
      const keyResult = await this.deserializer.deserialize(
        message.key ? Buffer.from(message.key) : null,
        { topicName: topic, isKey: true },
      );
      key = keyResult.value;
      keyDecodingError = keyResult.errorMessage;

      // Use deserializer for value
      const valueResult = await this.deserializer.deserialize(
        message.value ? Buffer.from(message.value) : null,
        { topicName: topic, isKey: false },
      );
      value = valueResult.value;
      valueDecodingError = valueResult.errorMessage;

      // Build metadata from deserialization results (only if we have schema IDs)
      if (keyResult.metadata.schemaId || valueResult.metadata.schemaId) {
        metadata = {
          key_schema_id: keyResult.metadata.schemaId,
          value_schema_id: valueResult.metadata.schemaId,
        };
      }
    } else {
      // Simple fallback parsing when no deserializer
      key = this.simpleParse(message.key);
      value = this.simpleParse(message.value);
    }

    // Convert headers
    const headers = message.headers
      ? Object.entries(message.headers).map(([name, headerValue]) => ({
          name,
          value: headerValue?.toString() ?? "",
        }))
      : undefined;

    return {
      partition_id: partition,
      offset: Number(message.offset),
      timestamp: Number(message.timestamp),
      timestamp_type: "CREATE_TIME",
      key,
      value,
      headers,
      metadata,
      key_decoding_error: keyDecodingError,
      value_decoding_error: valueDecodingError,
    };
  }

  /**
   * Simple parsing for messages when no deserializer is set.
   * Tries JSON parse, falls back to string.
   */
  private simpleParse(buffer: Buffer | null): unknown {
    if (!buffer) {
      return null;
    }
    const str = buffer.toString();
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }

  /**
   * Lists partitions for the topic using kafkajs admin client.
   *
   * @returns Array of partition info with partitionId.
   */
  async listPartitions(): Promise<Array<{ partitionId: number }>> {
    try {
      // Ensure we have a Kafka client
      if (!this.kafka) {
        const config = await this.buildKafkaConfig();
        const { Kafka } = await import("kafkajs");
        this.kafka = new Kafka(config);
      }

      const admin = this.kafka.admin();
      await admin.connect();

      try {
        const topicMetadata = await admin.fetchTopicMetadata({ topics: [this.topic.name] });
        const topicInfo = topicMetadata.topics.find((t) => t.name === this.topic.name);

        if (!topicInfo) {
          return [];
        }

        return topicInfo.partitions.map((p) => ({ partitionId: p.partitionId }));
      } finally {
        await admin.disconnect();
      }
    } catch (error) {
      logger.warn(`nativeConsume: error listing partitions: ${error}`);
      return [];
    }
  }

  /**
   * Builds the consume response from records.
   */
  private buildResponse(records: ConsumeRecord[]): ConsumeResponse {
    // Group records by partition
    const partitionMap = new Map<number, ConsumeRecord[]>();

    for (const record of records) {
      const partitionId = record.partition_id ?? 0;
      if (!partitionMap.has(partitionId)) {
        partitionMap.set(partitionId, []);
      }
      partitionMap.get(partitionId)!.push(record);
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

    logger.debug(`nativeConsume: returning ${records.length} records`);

    return {
      cluster_id: this.topic.clusterId,
      topic_name: this.topic.name,
      partition_data_list: partitionDataList,
    };
  }

  /**
   * Builds kafkajs configuration for the topic's cluster.
   */
  private async buildKafkaConfig(): Promise<KafkaConfig> {
    const credentials = await this.getCredentials();
    const sasl = toSaslOptions(credentials);

    // Get bootstrap servers from the topic's cluster
    const bootstrapServers = await this.getBootstrapServers();

    const config: KafkaConfig = {
      clientId: this.clientId,
      brokers: bootstrapServers.split(",").map((b) => b.trim()),
      connectionTimeout: 10000,
      requestTimeout: 30000,
      logLevel: 1, // ERROR only
    };

    // Configure SASL if credentials provided
    if (sasl) {
      config.sasl = sasl;
      config.ssl = true;
    }

    // Configure SSL based on connection type
    if (this.topic.connectionType === ConnectionType.Local) {
      config.ssl = false;
    } else if (this.topic.connectionType === ConnectionType.Direct && sasl) {
      config.ssl = true;
    }

    return config;
  }

  /**
   * Gets bootstrap servers for the topic's cluster.
   */
  private async getBootstrapServers(): Promise<string> {
    const resourceManager = getResourceManager();

    if (this.topic.connectionType === ConnectionType.Local) {
      // Get the actual cluster to find bootstrap servers (port may be dynamic)
      const clusters = await resourceManager.getKafkaClusters(this.topic.connectionId);
      const cluster = clusters.find((c) => c.id === this.topic.clusterId);
      if (cluster?.bootstrapServers) {
        logger.debug(
          `nativeConsume: using bootstrap servers from cluster: ${cluster.bootstrapServers}`,
        );
        return cluster.bootstrapServers;
      }
      // Fallback to default local port
      logger.warn(`nativeConsume: cluster not found, using default localhost:9092`);
      return "localhost:9092";
    }

    if (this.topic.connectionType === ConnectionType.Direct) {
      const spec = await resourceManager.getDirectConnection(this.topic.connectionId);
      const bootstrapServers = spec?.kafkaCluster?.bootstrapServers;
      if (bootstrapServers) {
        logger.debug(
          `nativeConsume: using bootstrap servers from direct connection: ${bootstrapServers}`,
        );
        return bootstrapServers;
      }
      logger.warn(`nativeConsume: direct connection bootstrap servers not found`);
      return "localhost:9092";
    }

    throw new Error(
      `Unsupported connection type for native consumer: ${this.topic.connectionType}`,
    );
  }

  /**
   * Gets credentials for the topic's cluster.
   */
  private async getCredentials(): Promise<Credentials | undefined> {
    if (this.topic.connectionType === ConnectionType.Local) {
      return undefined;
    }

    if (this.topic.connectionType === ConnectionType.Direct) {
      const resourceManager = getResourceManager();
      const spec = await resourceManager.getDirectConnection(this.topic.connectionId);
      return spec?.kafkaCluster?.credentials;
    }

    return undefined;
  }

  /**
   * Cleans up the consumer resources.
   */
  private async cleanup(): Promise<void> {
    // Clear any pending poll state
    this.finishPoll();

    if (this.consumer) {
      try {
        await this.consumer.disconnect();
      } catch (error) {
        logger.warn(`nativeConsume: error disconnecting consumer: ${error}`);
      }
      this.consumer = null;
    }
    this.kafka = null;
    this.subscribedTopic = null;
    this.fromBeginning = null;
    this.isRunning = false;
  }

  /**
   * Disposes of the consumer.
   */
  async dispose(): Promise<void> {
    await this.cleanup();
  }
}

/**
 * Creates a native Kafka consumer for the given topic.
 *
 * @param topic The topic to consume from.
 * @returns A new NativeKafkaConsumer instance.
 */
export function createNativeKafkaConsumer(topic: KafkaTopic): NativeKafkaConsumer {
  return new NativeKafkaConsumer(topic);
}
