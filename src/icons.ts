/**
 * Ids to use with ThemeIcons for different Confluent/Kafka resources
 * @see https://code.visualstudio.com/api/references/icons-in-labels
 * @remarks Any custom icon IDs must match the `contributes.icons` section of package.json.
 */
export enum IconNames {
  APACHE_KAFKA_LOGO = "apache-kafka",
  CURRENT_RESOURCE = "check",
  CONNECTION = "plug",
  ORGANIZATION = "account",
  CONFLUENT_LOGO = "confluent-logo",
  WARPSTREAM_LOGO = "warpstream-logo",
  CCLOUD_ENVIRONMENT = "confluent-environment",
  KAFKA_CLUSTER = "confluent-kafka-cluster",
  KAFKA_CLUSTER_PRIVATE = "confluent-kafka-cluster-private",
  LOCAL_RESOURCE_GROUP = "device-desktop",
  SCHEMA_REGISTRY = "confluent-schema-registry",
  KEY_SUBJECT = "key",
  VALUE_SUBJECT = "symbol-object",
  OTHER_SUBJECT = "question",
  TOPIC = "confluent-topic",
  TOPIC_WITHOUT_SCHEMA = "confluent-topic-without-schema",
  FLINK_COMPUTE_POOL = "confluent-flink-compute-pool",
  FLINK_STATEMENT = "code",
  FLINK_ARTIFACT = "confluent-code",
  FLINK_FUNCTION = "confluent-function",
  FLINK_STATEMENT_STATUS_COMPLETED = "confluent-flink-statement-status-completed",
  FLINK_STATEMENT_STATUS_RUNNING = "confluent-flink-statement-status-running",
  FLINK_STATEMENT_STATUS_FAILED = "confluent-flink-statement-status-failed",
  FLINK_STATEMENT_STATUS_DEGRADED = "confluent-flink-statement-status-degraded",
  FLINK_STATEMENT_STATUS_DELETING = "confluent-flink-statement-status-deleting",
  FLINK_STATEMENT_STATUS_STOPPED = "confluent-flink-statement-status-stopped",
  FLINK_STATEMENT_STATUS_PENDING = "confluent-flink-statement-status-pending",
  FLINK_VIEW = "confluent-flink-view",
  // Flink AI related connections will use CONNECTION above
  FLINK_AI_AGENT = "robot",
  FLINK_AI_MODEL = "confluent-flink-model",
  FLINK_AI_TOOL = "tools",
  LOADING = "loading~spin",
  /** General-purpose icon to use when we don't have a dedicated icon for a given resource. */
  PLACEHOLDER = "symbol-misc",
}
