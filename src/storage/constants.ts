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

  /** CCloud Schema Registry subjects */
  CCLOUD_SR_SUBJECTS = "ccloudSRSubjects",

  /** Local Schema Registry subjects */
  LOCAL_SR_SUBJECTS = "localSRSubjects",

  /** Direct connection Schema Registry Subjects */
  DIRECT_CONNECTION_SR_SUBJECTS = "directConnectionSRSubjects",

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

export enum SecretStorageKeys {
  /**
   * Key holding the auth token to communicate with ide-sidecar.
   */
  SIDECAR_AUTH_TOKEN = "sidecarAuthToken",

  /**
   * Indicate the outcome of the last CCloud authentication attempt.
   * Used by the `ConfluentCloudAuthProvider` to resolve promises that are waiting for the user's
   * browser-based authentication flow to complete after handling a URI callback from the sidecar.
   */
  AUTH_COMPLETED = "authCompleted",
  /** Only used as a way to kick off cross-workspace events for the authentication provider. Only
   * ever set to "true" or deleted. */
  AUTH_SESSION_EXISTS = "authSessionExists",

  /** Store the latest CCloud auth status from the sidecar, controlled by the auth poller. */
  CCLOUD_AUTH_STATUS = "ccloudAuthStatus",

  /** A map of connection id:ConnectionSpec */
  DIRECT_CONNECTIONS = "directConnections",

  /** Any user credentials gathered from `docker-credential-*` to pass via the X-Registry-Auth
   * header to Docker engine API requests. */
  DOCKER_CREDS_SECRET_KEY = "docker-creds",
}

/** Key used to store the current storage version across global/workspace state and SecretStorage. */
export const DURABLE_STORAGE_VERSION_KEY = "storageVersion";
export type MigrationStorageType = "global" | "workspace" | "secret";
