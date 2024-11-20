/** Workspace state keys. A single enum to hold all of the keys the extension uses
 * to cache data within the workspace storage via ResourceManager + StorageManager. */
export enum WorkspaceStorageKeys {
  /** Environments found in ccloud */
  CCLOUD_ENVIRONMENTS = "ccloudEnvironments",

  /** Kafka clusters found in CCLoud */
  CCLOUD_KAFKA_CLUSTERS = "ccloudKafkaClusters",
  /** Kafka clusters found from local, should be removed in #637 */
  LOCAL_KAFKA_CLUSTERS = "localKafkaClusters",

  /** CCloud Kafka topics */
  CCLOUD_KAFKA_TOPICS = "ccloudKafkaTopics",
  /** Local Kafka topics, should be removed in #638 */
  LOCAL_KAFKA_TOPICS = "localKafkaTopics",

  /** CCloud schema registries */
  CCLOUD_SCHEMA_REGISTRIES = "ccloudSchemaRegistries",

  /** CCLoud schema bindings (not the schema documents themselves) */
  CCLOUD_SCHEMAS = "ccloudSchemas",

  /** What (Schema) URI was chosen first to diff against? */
  DIFF_BASE_URI = "diffs.selectedResource",

  /** URI annotation facility, setURIMetadata() and the like.*/
  URI_METADATA = "uriMetadata",
}

/** Keys for use within URI Metadata dicts */
export enum UriMetadataKeys {
  SCHEMA_REGISTRY_ID = "schemaRegistryId",
  SCHEMA_SUBJECT = "schemaSubject",
}

// SECRET STORAGE KEYS
// NOTE: these aren't actually storing any secrets, just used for cross-workspace event handling

/**
 * Indicate the outcome of the last CCloud authentication attempt.
 * Used by the `ConfluentCloudAuthProvider` to resolve promises that are waiting for the user's
 * browser-based authentication flow to complete after handling a URI callback from the sidecar.
 */
export const AUTH_COMPLETED_KEY = "authCompleted";
/** Only used as a way to kick off cross-workspace events foir the authentication provider. Only\
 * ever set to "true" or deleted. */
export const AUTH_SESSION_EXISTS_KEY = "authSessionExists";

/** Store the latest CCloud auth status from the sidecar, controlled by the auth poller. */
export const CCLOUD_AUTH_STATUS_KEY = "ccloudAuthStatus";

/** Secret Storage key to look up a map of connection id:ConnectionSpec */
export const DIRECT_CONNECTIONS = "directConnections";
