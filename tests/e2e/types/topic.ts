import type { KafkaJS } from "@confluentinc/kafka-javascript";

/** Configuration options for creating a topic. */
export interface TopicConfig {
  /**
   * The slug portion of the topic name. The {@linkcode topic} fixture in `baseTest.ts` wraps
   * this in `e2eResourceName()`, which adds the `e2e-vscode-` prefix and a random suffix. Pass a
   * meaningful, low-cardinality slug like `produce-message-avro` so a leftover topic is easy to
   * trace back to the originating test.
   */
  name: string;
  numPartitions?: number;
  replicationFactor?: number;
  clusterLabel?: string;
  /** Options for producing messages to the topic after creation. */
  produce?: ProducerOptions;
}

/** Configuration options for producing messages to a Kafka topic. */
export interface ProducerOptions {
  /** The number of messages to produce. Default: 10 */
  numMessages?: number;
  /** The compression codec to use for messages. If not set, no compression will be applied. */
  compressionType?: KafkaJS.CompressionTypes;
  /** Optional key prefix for the messages. If provided, each message will have a key like `${keyPrefix}-${index}`. */
  keyPrefix?: string;
  /** Optional value prefix for the messages. If provided, each message will have a value like `${valuePrefix}-${index}`. */
  valuePrefix?: string;
}
