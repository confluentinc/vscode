import type { KafkaJS } from "@confluentinc/kafka-javascript";

/** Configuration options for creating a topic. */
export interface TopicConfig {
  name: string;
  numPartitions?: number;
  replicationFactor?: number;
  clusterLabel?: string | RegExp;
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
