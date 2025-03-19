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
