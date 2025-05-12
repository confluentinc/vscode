// The "section" to add before any of our contributed settings in package.json contributes.configuration
const prefix = "confluent.";

/**
 * Whether or not warning notifications will appear when consuming messages without permission to
 * access the associated Schema Registry.
 */
export const SCHEMA_RBAC_WARNINGS_ENABLED =
  prefix + "cloud.messageViewer.showSchemaWarningNotifications";

/** Array of string paths pointing to .pem files in the current environment for SSL/TLS. */
export const SSL_PEM_PATHS = prefix + "ssl.pemPaths";
/** Default value for the {@link SSL_PEM_PATHS} setting. */
export const DEFAULT_SSL_PEM_PATHS: string[] = [];

/**
 * Disable SSL/TLS server certificate verification when making requests to Confluent/Kafka
 * connections or resources.
 */
export const SSL_VERIFY_SERVER_CERT_DISABLED =
  prefix + "debugging.sslTls.serverCertificateVerificationDisabled";
/** Default value for the {@link SSL_VERIFY_SERVER_CERT_DISABLED} setting. */
export const DEFAULT_TRUST_ALL_CERTIFICATES = false;

export const LOCAL_DOCKER_SOCKET_PATH = prefix + "localDocker.socketPath";

export const LOCAL_KAFKA_IMAGE = prefix + "localDocker.kafkaImageRepo";
export const LOCAL_KAFKA_IMAGE_TAG = prefix + "localDocker.kafkaImageTag";
export const LOCAL_SCHEMA_REGISTRY_IMAGE = prefix + "localDocker.schemaRegistryImageRepo";
export const LOCAL_SCHEMA_REGISTRY_IMAGE_TAG = prefix + "localDocker.schemaRegistryImageTag";

/** Whether to use `TopicNameStrategy` by default for producing messages to a topic.
 * When disabled, will prompt the user to select a subject name strategy. */
export const USE_TOPIC_NAME_STRATEGY =
  prefix + "topic.produceMessages.schemas.useTopicNameStrategy";
/** Whether to allow selecting older (than latest) schema versions when producing messages to a topic. */
export const ALLOW_OLDER_SCHEMA_VERSIONS =
  prefix + "topic.produceMessages.schemas.allowOlderVersions";

export const ENABLE_FLINK = prefix + "preview.enableFlink";
export const ENABLE_CHAT_PARTICIPANT = prefix + "experimental.enableChatParticipant";

/** Default Flink compute pool ID. */
export const FLINK_CONFIG_COMPUTE_POOL = prefix + "flink.computePoolId";
/** Default Flink database (Kafka cluster) ID. */
export const FLINK_CONFIG_DATABASE = prefix + "flink.database";

/**
 * Whether or not to update {@link FLINK_CONFIG_COMPUTE_POOL} when interacting with the
 * "Set Compute Pool" codelens. Possible values are `never`, `ask`, or `always`.
 */
export const UPDATE_DEFAULT_POOL_ID_FROM_LENS = prefix + "flink.updateComputePoolIdFromCodelens";
/**
 * Whether or not to update {@link FLINK_CONFIG_DATABASE} when interacting with the
 * "Set Catalog & Database" codelens. Possible values are `never`, `ask`, or `always`.
 */
export const UPDATE_DEFAULT_DATABASE_FROM_LENS = prefix + "flink.updateDatabaseFromCodelens";

/**
 * Frequency in seconds for polling non-terminal Flink statements. 0 means no polling.
 */
export const STATEMENT_POLLING_FREQUENCY = prefix + "flink.statementPollingFrequency";
export const DEFAULT_STATEMENT_POLLING_FREQUENCY = 10; // seconds.
/**
 * Maximum number of nonterminal Flink statements to poll for updates.
 */
export const STATEMENT_POLLING_LIMIT = prefix + "flink.statementPollingLimit";
export const DEFAULT_STATEMENT_POLLING_LIMIT = 100; // non-terminal statements

export const STATEMENT_POLLING_CONCURRENCY: string = prefix + "flink.statementPollingConcurrency";
export const DEFAULT_STATEMENT_POLLING_CONCURRENCY = 5; // concurrent polling requests
