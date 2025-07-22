import { ExtensionSetting, SettingsSection } from "./base";

export type NeverAskAlways = "never" | "ask" | "always";

// ===== MAIN CONFIGS =====

/** Whether to show an error notification on sidecar process exceptions (for debugging purposes). */
export const SHOW_SIDECAR_EXCEPTIONS = new ExtensionSetting<boolean>(
  "confluent.debugging.showSidecarExceptions",
  SettingsSection.GENERAL,
);
/** Whether to use `TopicNameStrategy` by default for producing messages to a topic.
 * When disabled, will prompt the user to select a subject name strategy. */
export const USE_TOPIC_NAME_STRATEGY = new ExtensionSetting<boolean>(
  "confluent.topic.produceMessages.schemas.useTopicNameStrategy",
  SettingsSection.GENERAL,
);
/** Whether to allow selecting older (than latest) schema versions when producing messages to a topic. */
export const ALLOW_OLDER_SCHEMA_VERSIONS = new ExtensionSetting<boolean>(
  "confluent.topic.produceMessages.schemas.allowOlderVersions",
  SettingsSection.GENERAL,
);
/**
 * Whether or not to show notifications when the extension is first installed or updated to a new
 * version. Disabling this will prevent welcome messages and update notifications from appearing
 * during extension activation.
 */
export const SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS = new ExtensionSetting<boolean>(
  "confluent.showNewVersionNotifications",
  SettingsSection.GENERAL,
);

// ===== CCLOUD CONFIGS =====

/**
 * Whether or not warning notifications will appear when consuming messages without permission to
 * access the associated Schema Registry.
 */
export const SCHEMA_RBAC_WARNINGS_ENABLED = new ExtensionSetting<boolean>(
  "confluent.cloud.messageViewer.showSchemaWarningNotifications",
  SettingsSection.CCLOUD,
);
/**
 * Disable SSL/TLS server certificate verification when making requests to Confluent/Kafka
 * connections or resources.
 */
export const SSL_VERIFY_SERVER_CERT_DISABLED = new ExtensionSetting<boolean>(
  "confluent.debugging.sslTls.serverCertificateVerificationDisabled",
  SettingsSection.CCLOUD,
);
/** Array of string paths pointing to .pem files in the current environment for SSL/TLS. */
export const SSL_PEM_PATHS = new ExtensionSetting<string[]>(
  "confluent.ssl.pemPaths",
  SettingsSection.CCLOUD,
);

// ===== DIRECT CONNECTION CONFIGS =====

/** Path to the krb5.conf file for Kerberos authentication in direct connections. */
export const KRB5_CONFIG_PATH = new ExtensionSetting<string>(
  "confluent.krb5ConfigPath",
  SettingsSection.DIRECT_CONNECTIONS,
);

// ===== LOCAL CONFIGS =====

/** Path to the local Docker socket for managing local resources. */
export const LOCAL_DOCKER_SOCKET_PATH = new ExtensionSetting<string>(
  "confluent.localDocker.socketPath",
  SettingsSection.LOCAL,
);
/** Docker image to use with {@link LOCAL_KAFKA_IMAGE_TAG} when creating local Kafka containers. */
export const LOCAL_KAFKA_IMAGE = new ExtensionSetting<string>(
  "confluent.localDocker.kafkaImageRepo",
  SettingsSection.LOCAL,
);
/** Docker image tag to use with {@link LOCAL_KAFKA_IMAGE} when creating local Kafka containers. */
export const LOCAL_KAFKA_IMAGE_TAG = new ExtensionSetting<string>(
  "confluent.localDocker.kafkaImageTag",
  SettingsSection.LOCAL,
);
/** Docker image to use with {@link LOCAL_SCHEMA_REGISTRY_IMAGE_TAG} when creating local Schema Registry containers. */
export const LOCAL_SCHEMA_REGISTRY_IMAGE = new ExtensionSetting<string>(
  "confluent.localDocker.schemaRegistryImageRepo",
  SettingsSection.LOCAL,
);
/** Docker image tag to use when creating local Schema Registry containers. */
export const LOCAL_SCHEMA_REGISTRY_IMAGE_TAG = new ExtensionSetting<string>(
  "confluent.localDocker.schemaRegistryImageTag",
  SettingsSection.LOCAL,
);

// ===== FLINK CONFIGS =====

/** Whether or not to enable the Confluent Cloud language client+server integration for Flink SQL documents. */
export const ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER = new ExtensionSetting<boolean>(
  "confluent.flink.enableConfluentCloudLanguageServer",
  SettingsSection.FLINK,
);
/** Default Flink compute pool ID. */
export const FLINK_CONFIG_COMPUTE_POOL = new ExtensionSetting<string>(
  "confluent.flink.computePoolId",
  SettingsSection.FLINK,
);
/** Default Flink database (Kafka cluster) ID. */
export const FLINK_CONFIG_DATABASE = new ExtensionSetting<string>(
  "confluent.flink.database",
  SettingsSection.FLINK,
);
/**
 * Whether or not to update {@link FLINK_CONFIG_COMPUTE_POOL} when interacting with the
 * "Set Compute Pool" codelens. Possible values are `never`, `ask`, or `always`.
 */
export const UPDATE_DEFAULT_POOL_ID_FROM_LENS = new ExtensionSetting<NeverAskAlways>(
  "confluent.flink.updateComputePoolIdFromCodelens",
  SettingsSection.FLINK,
);
/**
 * Whether or not to update {@link FLINK_CONFIG_DATABASE} when interacting with the
 * "Set Catalog & Database" codelens. Possible values are `never`, `ask`, or `always`.
 */
export const UPDATE_DEFAULT_DATABASE_FROM_LENS = new ExtensionSetting<NeverAskAlways>(
  "confluent.flink.updateDatabaseFromCodelens",
  SettingsSection.FLINK,
);
/** Frequency in seconds for polling non-terminal Flink statements. 0 means no polling. */
export const STATEMENT_POLLING_FREQUENCY_SECONDS = new ExtensionSetting<number>(
  "confluent.flink.statementPollingFrequency",
  SettingsSection.FLINK,
);
/**
 * Maximum number of nonterminal Flink statements to poll for updates.
 * If the number of nonterminal statements exceeds this limit, only the
 * N with the most recent `createdAt` timestamps will be polled.
 */
export const STATEMENT_POLLING_LIMIT = new ExtensionSetting<number>(
  "confluent.flink.statementPollingLimit",
  SettingsSection.FLINK,
);
/** Setting to control the concurrency level when polling requests for Flink statements. */
export const STATEMENT_POLLING_CONCURRENCY = new ExtensionSetting<number>(
  "confluent.flink.statementPollingConcurrency",
  SettingsSection.FLINK,
);

// ===== COPILOT CONFIGS =====

/** Whether or not to enable Flink Artifacts functionality including the artifacts view. */
export const ENABLE_FLINK_ARTIFACTS = new ExtensionSetting<boolean>(
  "confluent.flink.enableFlinkArtifacts",
  SettingsSection.FLINK,
);

/** Whether or not to enable the `@Confluent` chat participant and associated tools. */
export const ENABLE_CHAT_PARTICIPANT = new ExtensionSetting<boolean>(
  "confluent.experimental.enableChatParticipant",
  SettingsSection.COPILOT,
);
/**
 * Whether or not to include `errorDetails` from the `ChatResult` while handling `ChatResultFeedback`.
 * Also affects whether we send `error` data for "message handling failed" telemetry events.
 */
export const CHAT_SEND_ERROR_DATA = new ExtensionSetting<boolean>(
  "confluent.chat.telemetry.sendErrorData",
  SettingsSection.COPILOT,
);
/**
 * Whether or not to include tool call inputs and tool result contents while handling `ChatResultFeedback`.
 * Also affects whether we include tool call inputs in general tool-handling telemetry events.
 */
export const CHAT_SEND_TOOL_CALL_DATA = new ExtensionSetting<boolean>(
  "confluent.chat.telemetry.sendToolCallData",
  SettingsSection.COPILOT,
);
