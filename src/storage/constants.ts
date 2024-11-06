// Global/Workspace state keys
export enum StateEnvironments {
  CCLOUD = "environments.ccloud",
}

export enum StateKafkaClusters {
  LOCAL = "kafkaClusters.local",
  CCLOUD = "kafkaClusters.ccloud",
}

export enum StateKafkaTopics {
  LOCAL = "kafkaTopics.local",
  CCLOUD = "kafkaTopics.ccloud",
}

export enum StateSchemaRegistry {
  CCLOUD = "schemaRegistries.ccloud",
}

export enum StateSchemas {
  CCLOUD = "schemas.ccloud",
}

export enum StateDiffs {
  SELECTED_RESOURCE = "diffs.selectedResource",
}

/** Single enum to hold all of the keys the extension uses
 * within the workspace storage. */
export enum WorkspaceStorageKeys {
  // Eventually migrate all of these to the State* enums above
  // into this enum here for consistency.

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
