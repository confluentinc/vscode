import { KAFKA_TOPIC_OPERATIONS } from "./constants";

/** One of the {@link KAFKA_TOPIC_OPERATIONS} string literals. Promote from string[] using toKafkaTopicOperations() */
export type KafkaTopicOperation = (typeof KAFKA_TOPIC_OPERATIONS)[number];

/** Promote known strings as from list or get topics result into list of KafkaTopicOperation */
export function toKafkaTopicOperations(operations: string[]): KafkaTopicOperation[] {
  const validOperations = operations.filter((op) =>
    KAFKA_TOPIC_OPERATIONS.includes(op as KafkaTopicOperation),
  );

  return validOperations;
}
