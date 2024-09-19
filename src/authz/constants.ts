/** Possible / allowed operations on CCloud Kafka topics
 * @see https://docs.confluent.io/platform/current/security/authorization/acls/overview.html#topic-resource-type-operations
 **/

export const KAFKA_TOPIC_OPERATIONS: readonly string[] = [
  "ALTER",
  "CREATE",
  "DELETE",
  "DESCRIBE",
  "READ",
  "WRITE",
  "ALTER_CONFIGS",
  "DESCRIBE_CONFIGS",
];

/**
 * Whether or not warning notifications will appear when consuming messages without permission to
 * access the associated Schema Registry cluster.
 */
export const SCHEMA_RBAC_WARNING_SETTING_NAME =
  "cloud.messageViewer.showSchemaWarningNotifications";
