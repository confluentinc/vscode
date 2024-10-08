// The "section" to add before any of our contributed settings in package.json contributes.configuration
const prefix = "confluent.";

/**
 * Whether or not warning notifications will appear when consuming messages without permission to
 * access the associated Schema Registry cluster.
 */
export const SCHEMA_RBAC_WARNINGS_ENABLED =
  prefix + "cloud.messageViewer.showSchemaWarningNotifications";

/** Array of string paths pointing to .pem files in the current environment for SSL/TLS. */
export const SSL_PEM_PATHS = prefix + "ssl.pemPaths";

/**
 * Disable SSL/TLS server certificate verification when making requests to Confluent/Kafka
 * connections or resources.
 */
export const SSL_VERIFY_SERVER_CERT_DISABLED =
  prefix + "debugging.sslTls.serverCertificateVerificationDisabled";

export const LOCAL_DOCKER_SOCKET_PATH = prefix + "localDocker.socketPath";
