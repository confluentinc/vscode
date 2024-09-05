/** @see https://docs.confluent.io/platform/current/security/authorization/acls/overview.html#topic-resource-type-operations */
export const KafkaTopicAuthorizedOperations = [
  "ALTER",
  "CREATE",
  "DELETE",
  "DESCRIBE",
  "READ",
  "WRITE",
  "ALTER_CONFIGS",
  "DESCRIBE_CONFIGS",
] as const;
/** One of the {@link KafkaTopicAuthorizedOperations} string literals. */
export type KafkaTopicAuthorizedOperation = (typeof KafkaTopicAuthorizedOperations)[number];
