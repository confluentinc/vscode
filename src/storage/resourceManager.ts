import { Mutex } from "async-mutex";
import { SecretStorage, Uri } from "vscode";
import { AuthCallbackEvent } from "../authn/types";
import {
  ConnectedState,
  ConnectionSpec,
  ConnectionSpecFromJSON,
  ConnectionSpecToJSON,
  ConnectionType,
} from "../clients/sidecar";
import { getExtensionContext } from "../context/extension";
import { FormConnectionType } from "../directConnections/types";
import { ExtensionContextNotSetError } from "../errors";
import { Logger } from "../logging";
import { Environment, EnvironmentType, getEnvironmentClass } from "../models/environment";
import { KafkaClusterType, getKafkaClusterClass } from "../models/kafkaCluster";
import {
  ConnectionId,
  EnvironmentId,
  IResourceBase,
  ISchemaRegistryResource,
} from "../models/resource";
import { Subject } from "../models/schema";
import { SchemaRegistryType, getSchemaRegistryClass } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { SecretStorageKeys, UriMetadataKeys, WorkspaceStorageKeys } from "./constants";
import { GlobalState, UriMetadata, UriMetadataMap, WorkspaceState } from "./types";
import { getGlobalState, getSecretStorage, getWorkspaceState } from "./utils";

const logger = new Logger("storage.resourceManager");

export interface CustomConnectionSpec extends ConnectionSpec {
  // enforce `ConnectionId` type over `string`
  id: ConnectionId;
  /** The option chosen by the user to describe this connection. Similar to {@link ConnectionType} */
  formConnectionType: FormConnectionType;
  /** If the formConnectionType is "Other" we prompt users to specify the type */
  specifiedConnectionType?: string;
}

/** Map of {@link ConnectionId} to {@link CustomConnectionSpec}; only used for `DIRECT` connections. */
export type DirectConnectionsById = Map<ConnectionId, CustomConnectionSpec>;

/**
 * Used within {@link ResourceManager.setSubjects} / {@link ResourceManager.getSubjects}
 * for the interior cache map of registry id -> {cached subject array} | {nothing cached yet}.
 */
type SubjectStringCache = Map<string, string[] | undefined>;

/** All possible concrete coarse resource instance types */
type CoarseResourceType = KafkaClusterType | SchemaRegistryType | EnvironmentType;

/**
 * Enumeration of strings describing resource kinds we generate
 * per-connection-id storage keys for.
 *
 * See {@link ResourceManager.generateWorkspaceStorageKey}, and, say,
 * {@link ResourceManager.getEnvironments} / {@link ResourceManager.setEnvironments}.
 */
export enum GeneratedKeyResourceType {
  ENVIRONMENTS = "environments",
  KAFKA_CLUSTERS = "kafkaClusters",
  SCHEMA_REGISTRIES = "schemaRegistries",
  TOPICS = "topics",
  SUBJECTS = "subjects",
}

/**
 * Type describing per-connection+resource type generated workspace storage keys.
 * See {@link ResourceManager.generateWorkspaceStorageKey} and callers.
 **/
export type GeneratedWorkspaceKey = string & { readonly __generatedWorkspaceKey: unique symbol };

/**
 * Singleton helper for interacting with Confluent-/Kafka-specific global/workspace state items and secrets.
 */
export class ResourceManager {
  /** Mutexes for each workspace/secret storage key to prevent conflicting concurrent writes */
  private mutexes: Map<WorkspaceStorageKeys | SecretStorageKeys | GeneratedWorkspaceKey, Mutex> =
    new Map();

  private readonly globalState: GlobalState;
  private readonly workspaceState: WorkspaceState;
  private readonly secrets: SecretStorage;

  private constructor() {
    if (!getExtensionContext()) {
      throw new ExtensionContextNotSetError("ResourceManager");
    }
    this.globalState = getGlobalState();
    this.workspaceState = getWorkspaceState();
    this.secrets = getSecretStorage();

    // Initialize mutexes for each pre-known workspace/secret storage key
    for (const key of [
      ...Object.values(WorkspaceStorageKeys),
      ...Object.values(SecretStorageKeys),
    ]) {
      this.mutexes.set(key, new Mutex());
    }
    // GeneratedWorkspaceKey mutexes are created on-the-fly, so no need to pre-populate them.
  }

  static instance: ResourceManager | null = null; // NOSONAR

  static getInstance(): ResourceManager {
    if (!ResourceManager.instance) {
      // Will throw an ExtensionContextNotSetError if the context isn't set during activation
      ResourceManager.instance = new ResourceManager();
    }
    return ResourceManager.instance;
  }

  /**
   * Run an async callback which will both read and later mutate workspace
   * or secret storage with exclusive access to the elements guarded by that
   * workspace or secret storage key.
   *
   * This strategy prevents concurrent writes to the same workspace/secret storage key, which can
   * lead to data corruption, when multiple asynchronous operations are calling methods which both
   * read and write to the same workspace storage key, namely mutating actions to keys that hold arrays or maps.
   */
  private async runWithMutex<T>(
    key: WorkspaceStorageKeys | SecretStorageKeys | GeneratedWorkspaceKey,
    callback: () => Promise<T>,
  ): Promise<T> {
    let mutex = this.mutexes.get(key);
    if (!mutex) {
      // Generated keys are not pre-populated, so we create a new mutex for them upon demand.
      logger.debug(`Creating new mutex for key: ${key}`);
      mutex = new Mutex();
      this.mutexes.set(key, mutex);
    }
    logger.debug(`Acquiring mutex for key: ${key}`);
    return await mutex.runExclusive(callback);
  }

  /**
   * Purge all the cached resources for a given connection ID.
   */
  async purgeConnectionResources(connectionId: ConnectionId): Promise<void> {
    // Collect array of all of the generated workspace storage keys for this connection ID
    const allConnectionIdStorageKeys = Object.values(GeneratedKeyResourceType).map((resourceType) =>
      this.generateWorkspaceStorageKey(connectionId, resourceType),
    );

    // Promote to promises over calls to clear the workspace storage
    // values for each of the generated keys.
    const updatePromises = allConnectionIdStorageKeys.map((key) =>
      this.workspaceState.update(key, undefined),
    );

    // Run the promises; clearing all cached data for this connection ID.
    await Promise.all(updatePromises);
  }

  // Coarse resources

  private async storeCoarseResources(
    connectionId: ConnectionId,
    resourceKind: GeneratedKeyResourceType,
    resources: IResourceBase[],
  ): Promise<void> {
    const storageKey = this.generateWorkspaceStorageKey(connectionId, resourceKind);

    // Validate that all resources are of the expected type based on the connection type
    // and have the expected connection ID.
    for (const resource of resources) {
      if (resource.connectionId !== connectionId) {
        throw new Error(
          `Connection ID mismatch: expected ${connectionId}, found ${resource.connectionId}`,
        );
      }
    }

    // Reassign this connection's resources in workspace storage.
    await this.workspaceState.update(storageKey, JSON.stringify(resources));

    logger.debug(
      `Stored ${resources.length} resources for connection ${connectionId} in storage key ${storageKey}`,
    );
  }

  private async loadCoarseResources<T extends CoarseResourceType>(
    connectionId: ConnectionId,
    resourceKind: GeneratedKeyResourceType,
    resourceCreator: (fromJson: T) => T,
  ): Promise<T[]> {
    const storageKey = this.generateWorkspaceStorageKey(connectionId, resourceKind);

    // Get the JSON-stringified array from storage
    const resourcesForConnectionString: string | undefined =
      await this.workspaceState.get(storageKey);

    if (!resourcesForConnectionString) {
      return [];
    }

    // Will either be undefined or an array of plain objects since just deserialized from storage.
    const vanillaJSONResources: T[] = JSON.parse(resourcesForConnectionString);

    logger.debug(
      `Found ${vanillaJSONResources.length} ${resourceKind} for connection ${connectionId}`,
    );

    // Promote each from-json vanilla object member to be the proper instance of T; return array.
    return vanillaJSONResources.map((resource) => resourceCreator(resource));
  }

  // ENVIRONMENTS (coarse resource)

  async setEnvironments(connectionId: ConnectionId, environments: Environment[]): Promise<void> {
    await this.storeCoarseResources(
      connectionId,
      GeneratedKeyResourceType.ENVIRONMENTS,
      environments,
    );
  }

  async getEnvironments<T extends EnvironmentType>(connectionId: ConnectionId): Promise<T[]> {
    const environmentClass = getEnvironmentClass(connectionId);
    const environmentCreator = (fromJson: T): T => new environmentClass(fromJson as any) as T;

    return this.loadCoarseResources<T>(
      connectionId,
      GeneratedKeyResourceType.ENVIRONMENTS,
      environmentCreator,
    );
  }

  // KAFKA CLUSTERS (coarse resource)

  /**
   * Store this array of KafkaCluster associated with this connection id
   * in extension workspace state. Replaces any previously stored array.
   * @param clusters The array of {@link KafkaCluster}s to store.
   */
  async setKafkaClusters<T extends KafkaClusterType>(
    connectionId: ConnectionId,
    clusters: T[],
  ): Promise<void> {
    await this.storeCoarseResources(
      connectionId,
      GeneratedKeyResourceType.KAFKA_CLUSTERS,
      clusters,
    );
  }

  /**
   * Get the cached {@link KafkaCluster}s for this connection from extension state.
   * @returns connectionType-related {@link KafkaCluster} subclass []>
   */
  async getKafkaClusters<T extends KafkaClusterType>(connectionId: ConnectionId): Promise<T[]> {
    const kafkaClusterClass = getKafkaClusterClass(connectionId);
    const kafkaClusterCreator = (fromJson: T): T => kafkaClusterClass.create(fromJson as any) as T;

    return this.loadCoarseResources<T>(
      connectionId,
      GeneratedKeyResourceType.KAFKA_CLUSTERS,
      kafkaClusterCreator,
    );
  }

  /**
   * Get the list of cached Kafka clusters for a specific connection ID + environment from extension state.
   * @param connectionId The ID of the connection for which to get Kafka clusters.
   * @param environmentId The ID of the {@link Environment} for which to get Kafka clusters
   * @returns The list of {@link KafkaCluster}s for the specified environment. If no clusters are found, an empty array is returned.
   */
  async getKafkaClustersForEnvironmentId<T extends KafkaClusterType>(
    connectionId: ConnectionId,
    environmentId: EnvironmentId,
  ): Promise<T[]> {
    const clusters: T[] = await this.getKafkaClusters<T>(connectionId);
    return clusters.filter((cluster) => cluster.environmentId === environmentId);
  }

  // SCHEMA REGISTRY

  /** Cache this connection's schema registry/ies. Generic over SchemaRegistry subclass T. */
  async setSchemaRegistries<T extends SchemaRegistryType>(
    connectionId: ConnectionId,
    registries: T[],
  ): Promise<void> {
    await this.storeCoarseResources(
      connectionId,
      GeneratedKeyResourceType.SCHEMA_REGISTRIES,
      registries,
    );
  }

  /** Get the properly subtyped schema registries for this connection id from storage. If none are found, will return empty array. */
  async getSchemaRegistries<T extends SchemaRegistryType>(
    connectionId: ConnectionId,
  ): Promise<T[]> {
    const schemaRegistryClass = getSchemaRegistryClass(connectionId);
    const schemaRegistryCreator = (fromJson: T): T => schemaRegistryClass.create(fromJson) as T;

    return this.loadCoarseResources<T>(
      connectionId,
      GeneratedKeyResourceType.SCHEMA_REGISTRIES,
      schemaRegistryCreator,
    );
  }

  /**
   * Cache subjects for a schema registry in workspace state.
   *
   * Stored in two tiers:
   * - Three different toplevel workspace storage keys for based on the connection type:
   *   - {@link WorkspaceStorageKeys.CCLOUD_SR_SUBJECTS} for ccloud-based schema registries.
   *   - {@link WorkspaceStorageKeys.LOCAL_SR_SUBJECTS} for local-based schema registries.
   *   - {@link WorkspaceStorageKeys.DIRECT_SR_SUBJECTS} for direct-based schema registries.
   *
   * - Each of the above keys contains a JSON-stringified map of schemaRegistryId, -> (string[] | undefined)
   *   where the string[] is a list of subject names. If empty array, then the schema registry
   *   has no subjects. If undefined, then prior cached subjects have been cleared and should be treated as
   *   a cache miss.
   *
   *  To clear all subjects for a single schema registry, call with (registry, undefined).
   *
   * @param schemaRegistry
   * @param subjects
   */
  async setSubjects(
    schemaRegistryKeyable: ISchemaRegistryResource,
    subjects: Subject[] | undefined,
  ): Promise<void> {
    const workspaceStorageKey = this.generateWorkspaceStorageKey(
      schemaRegistryKeyable.connectionId,
      GeneratedKeyResourceType.SUBJECTS,
    );

    logger.debug(
      `Setting ${subjects?.length !== undefined ? subjects.length : "undefined"} subjects for schema registry ${schemaRegistryKeyable.schemaRegistryId} (${workspaceStorageKey})`,
    );

    await this.runWithMutex(workspaceStorageKey, async () => {
      // Get the JSON-stringified map from storage
      const subjectsByRegistryString: string | undefined =
        await this.workspaceState.get(workspaceStorageKey);

      const subjectsStringsByRegistryID: SubjectStringCache = subjectsByRegistryString
        ? stringToMap(subjectsByRegistryString)
        : new Map<string, string[] | undefined>();

      // Reduce any provided Subject instances to a list of strings
      // (or just undefined if clearing the key).
      const subjectsAsStrings: string[] | undefined = subjects
        ? subjects.map((subject) => subject.name)
        : undefined;

      // Set the new subjects for this specific schema registry within per-connection-type stored map.
      subjectsStringsByRegistryID.set(schemaRegistryKeyable.schemaRegistryId, subjectsAsStrings);

      // Now save the updated map of registry id -> subject list into workspace storage
      // (JSON-stringified) according to the connection type's storage key.
      await this.workspaceState.update(
        workspaceStorageKey,
        mapToString(subjectsStringsByRegistryID),
      );
    });
  }

  /**
   * Get the cached subjects for a schema registry, if any.
   * @see {@link setSubjects} for how these are stored.
   *
   * @param schemaRegistry - The schema registry for which to get the subjects
   *
   * @returns An array of {@link Subject} instances, or undefined if no subjects are cached. The array may be empty if
   * the schema registry was last seen with zero subjects.
   */
  async getSubjects(
    schemaRegistryKeyable: ISchemaRegistryResource,
  ): Promise<Subject[] | undefined> {
    const key = this.generateWorkspaceStorageKey(
      schemaRegistryKeyable.connectionId,
      GeneratedKeyResourceType.SUBJECTS,
    );

    let subjectsByRegistryIDString: string | undefined;

    // Access the corresponding workspace storage section only with mutex guarding, assigning
    // into subjectsByRegistryIDString.
    await this.runWithMutex(key, async () => {
      // Get the JSON-stringified map of this conn-type's map from storage
      subjectsByRegistryIDString = await this.workspaceState.get(key);
    });

    const subjectStringsByRegistryID: SubjectStringCache = subjectsByRegistryIDString
      ? stringToMap(subjectsByRegistryIDString)
      : new Map<string, string[] | undefined>();

    // Will either be undefined or an array of plain strings since
    // just deserialized from storage.
    const vanillaJSONSubjects: string[] | undefined = subjectStringsByRegistryID.get(
      schemaRegistryKeyable.schemaRegistryId,
    );

    if (vanillaJSONSubjects === undefined) {
      return;
    }

    logger.debug(
      `Found ${vanillaJSONSubjects.length} subjects for schema registry ${schemaRegistryKeyable.schemaRegistryId}`,
    );

    // Promote each string member to be an instance of Subject, return.

    // (Empty list will be returned as is, indicating that we know there are
    //  no subjects in this schema registry.)
    return vanillaJSONSubjects.map(
      (subject: string) =>
        new Subject(
          subject,
          schemaRegistryKeyable.connectionId,
          schemaRegistryKeyable.environmentId,
          schemaRegistryKeyable.schemaRegistryId,
          null, // no contained schemas cached here.
        ),
    );
  }

  // TOPICS

  /**
   *  Store this (possibly empty) list of topics for a cluster, be it local or ccloud, in workspace state.
   *  If is known that a given cluster has no topics, then should call with empty topic array.
   *
   *  Raises an error if the cluster ID of any topic does not match the given cluster's ID.
   */
  async setTopicsForCluster(cluster: KafkaClusterType, topics: KafkaTopic[]): Promise<void> {
    // Ensure that all topics have the correct cluster ID.
    if (topics.some((topic) => topic.clusterId !== cluster.id)) {
      logger.warn("Cluster ID mismatch in topics", cluster, topics);
      throw new Error("Cluster ID mismatch in topics");
    }

    // Will be a per-connection-id key for storing topics by cluster ID.
    const key = this.generateWorkspaceStorageKey(
      cluster.connectionId,
      GeneratedKeyResourceType.TOPICS,
    );

    await this.runWithMutex(key, async () => {
      // Get the JSON-stringified map from storage
      const topicsByClusterString: string | undefined = this.workspaceState.get(key);
      const topicsByCluster: Map<string, object[]> = topicsByClusterString
        ? stringToMap(topicsByClusterString)
        : new Map<string, object[]>();

      // Set the new topics for the cluster
      topicsByCluster.set(cluster.id, topics);

      // Now save the updated cluster topics into the proper key'd storage.
      await this.workspaceState.update(key, mapToString(topicsByCluster));
    });
  }

  /**
   * Get topics given a cluster, be it local or ccloud.
   *
   * @returns KafkaTopic[] (possibly empty) if known, else undefined
   * indicating nothing at all known about this cluster (and should be deep probed).
   */
  async getTopicsForCluster(cluster: KafkaClusterType): Promise<KafkaTopic[] | undefined> {
    const key = this.generateWorkspaceStorageKey(
      cluster.connectionId,
      GeneratedKeyResourceType.TOPICS,
    );

    // Get the JSON-stringified map from storage
    const topicsByClusterString: string | undefined = this.workspaceState.get(key);
    const topicsByCluster: Map<string, object[]> = topicsByClusterString
      ? stringToMap(topicsByClusterString)
      : new Map<string, object[]>();

    // Will either be undefined or an array of plain json objects since
    // just deserialized from storage.
    const vanillaJSONTopics: object[] | undefined = topicsByCluster.get(cluster.id);
    if (vanillaJSONTopics === undefined) {
      return undefined;
    }

    // Promote each member to be an instance of KafkaTopic, return.
    // (Empty list will be returned as is, indicating that we know there are
    //  no topics in this cluster.)
    return vanillaJSONTopics.map((topic) => KafkaTopic.create(topic as KafkaTopic));
  }

  // AUTH PROVIDER

  /**
   * Set the secret key to indicate that the CCloud auth flow has completed successfully.
   *
   * This also sets the `AUTH_PASSWORD_RESET` key to indicate whether the user has reset their
   * password recently, since we will know both the success state and the reset state at the same time.
   */
  async setAuthFlowCompleted(authCallback: AuthCallbackEvent): Promise<void> {
    await Promise.all([
      this.secrets.store(SecretStorageKeys.AUTH_COMPLETED, String(authCallback.success)),
      this.secrets.store(SecretStorageKeys.AUTH_PASSWORD_RESET, String(authCallback.resetPassword)),
    ]);
  }

  /**
   * Get the secret key that indicates whether the CCloud auth flow has completed successfully.
   * @returns `true` if the auth flow completed successfully; `false` otherwise
   */
  async getAuthFlowCompleted(): Promise<boolean> {
    const success: string | undefined = await this.secrets.get(SecretStorageKeys.AUTH_COMPLETED);
    return success === "true";
  }

  /** Get the flag indicating whether or not the user has reset their password recently. */
  async getAuthFlowPasswordReset(): Promise<boolean> {
    const reset: string | undefined = await this.secrets.get(SecretStorageKeys.AUTH_PASSWORD_RESET);
    return reset === "true";
  }

  /** Store the latest CCloud {@link ConnectedState} from the sidecar. */
  async setCCloudState(state: ConnectedState): Promise<void> {
    // no additional stringification needed since this is just a string enum value
    await this.secrets.store(SecretStorageKeys.CCLOUD_STATE, state);
  }

  /** Get the last stored CCloud {@link ConnectedState} we received from the sidecar. */
  async getCCloudState(): Promise<ConnectedState> {
    const storedState: string | undefined = await this.secrets.get(SecretStorageKeys.CCLOUD_STATE);
    if (!storedState) {
      return ConnectedState.None;
    }

    if (!Object.values(ConnectedState).includes(storedState as ConnectedState)) {
      logger.warn(
        `Invalid CCloud state found in storage: ${storedState}. Defaulting to ${ConnectedState.None}.`,
      );
      return ConnectedState.None;
    }
    return storedState as ConnectedState;
  }

  // DIRECT CONNECTIONS - entirely handled through SecretStorage

  /** Look up the {@link ConnectionId}:{@link ConnectionSpec} map for any existing `DIRECT` connections. */
  async getDirectConnections(): Promise<DirectConnectionsById> {
    // Get the JSON-stringified map from storage
    const connectionsString: string | undefined = await this.secrets.get(
      SecretStorageKeys.DIRECT_CONNECTIONS,
    );
    const connectionsById: Map<string, object> = connectionsString
      ? stringToMap(connectionsString)
      : new Map<string, object>();
    // cast any values back to CustomConnectionSpec instances
    return new Map(
      Array.from(connectionsById).map(([id, spec]) => [
        id as ConnectionId,
        CustomConnectionSpecFromJSON(spec),
      ]),
    );
  }

  async getDirectConnection(id: ConnectionId): Promise<CustomConnectionSpec | null> {
    const connections: DirectConnectionsById = await this.getDirectConnections();
    return connections.get(id) ?? null;
  }

  /**
   * Add a direct connection spec to the extension state by looking up the existing
   * {@link DirectConnectionsById} map and adding/overwriting the `spec` by its `id`.
   */
  async addDirectConnection(spec: CustomConnectionSpec): Promise<void> {
    const key = SecretStorageKeys.DIRECT_CONNECTIONS;
    return await this.runWithMutex(key, async () => {
      const connectionIds: DirectConnectionsById = await this.getDirectConnections();
      connectionIds.set(spec.id, spec);
      const serializedConnections = Object.fromEntries(
        Array.from(connectionIds.entries()).map(([id, spec]) => [
          id,
          CustomConnectionSpecToJSON(spec),
        ]),
      );
      await this.secrets.store(key, JSON.stringify(serializedConnections));
    });
  }

  async deleteDirectConnection(id: ConnectionId): Promise<void> {
    const key = SecretStorageKeys.DIRECT_CONNECTIONS;
    return await this.runWithMutex(key, async () => {
      const connections: DirectConnectionsById = await this.getDirectConnections();
      connections.delete(id);
      await this.secrets.store(key, mapToString(connections));
    });
  }

  async deleteDirectConnections(): Promise<void> {
    const key = SecretStorageKeys.DIRECT_CONNECTIONS;
    return await this.runWithMutex(key, async () => {
      await this.secrets.delete(key);
    });
  }

  // URI METADATA

  /** Store the full {@link UriMetadataMap} (for possibly multiple {@link Uri}s). */
  private async setAllUriMetadata(metadataMap: UriMetadataMap): Promise<void> {
    await this.workspaceState.update(WorkspaceStorageKeys.URI_METADATA, mapToString(metadataMap));
  }

  /** Get the full {@link UriMetadataMap} (for possibly multiple {@link Uri}s). */
  async getAllUriMetadata(): Promise<UriMetadataMap> {
    const metadataString: string | undefined = this.workspaceState.get(
      WorkspaceStorageKeys.URI_METADATA,
    );
    return metadataString ? (stringToMap(metadataString) as UriMetadataMap) : new Map();
  }

  /** Delete the full {@link UriMetadataMap} (for possibly multiple {@link Uri}s). */
  async deleteAllUriMetadata(): Promise<void> {
    const key = WorkspaceStorageKeys.URI_METADATA;
    await this.runWithMutex(key, async () => {
      await this.workspaceState.update(key, undefined);
    });
  }

  /**
   * Set the metadata for a specific {@link Uri}.
   *
   * This will merge with any existing metadata, overwriting any preexisting keys with (new) values
   * provided in `metadata`.
   */
  async setUriMetadata(uri: Uri, metadata: UriMetadata): Promise<void> {
    const key = WorkspaceStorageKeys.URI_METADATA;
    await this.runWithMutex(key, async () => {
      const metadataMap: UriMetadataMap = await this.getAllUriMetadata();
      const existingMetadata: UriMetadata = metadataMap.get(uri.toString()) ?? ({} as UriMetadata);
      metadataMap.set(uri.toString(), { ...existingMetadata, ...metadata });
      await this.setAllUriMetadata(metadataMap);
    });
  }

  /** Get the metadata object for a specific {@link Uri}. */
  async getUriMetadata(uri: Uri): Promise<UriMetadata | undefined> {
    const metadataMap: UriMetadataMap = await this.getAllUriMetadata();
    return metadataMap.get(uri.toString());
  }

  /** Delete the metadata for a specific {@link Uri}. */
  async deleteUriMetadata(uri: Uri): Promise<void> {
    const key = WorkspaceStorageKeys.URI_METADATA;
    await this.runWithMutex(key, async () => {
      const metadataMap: UriMetadataMap = await this.getAllUriMetadata();
      metadataMap.delete(uri.toString());
      await this.setAllUriMetadata(metadataMap);
    });
  }

  /** Set a metadata key/value pair for a specific {@link Uri}. */
  async setUriMetadataValue(
    uri: Uri,
    metadataKey: UriMetadataKeys,
    metadataValue: any,
  ): Promise<void> {
    const key = WorkspaceStorageKeys.URI_METADATA;
    await this.runWithMutex(key, async () => {
      const metadataMap: UriMetadataMap = await this.getAllUriMetadata();
      const metadata: UriMetadata = metadataMap.get(uri.toString()) ?? {};
      metadata[metadataKey] = metadataValue;
      metadataMap.set(uri.toString(), metadata);
      await this.setAllUriMetadata(metadataMap);
    });
  }

  /** Get a metadata value for a specific {@link Uri}. */
  async getUriMetadataValue(uri: Uri, metadataKey: UriMetadataKeys): Promise<any> {
    const metadataMap: UriMetadataMap = await this.getAllUriMetadata();
    const metadata: Record<string, any> | undefined = metadataMap.get(uri.toString());
    return metadata ? metadata[metadataKey] : undefined;
  }

  generateWorkspaceStorageKey(
    connectionId: ConnectionId,
    resourceType: GeneratedKeyResourceType,
  ): GeneratedWorkspaceKey {
    return `${connectionId}-${resourceType}` as GeneratedWorkspaceKey;
  }
}

/**
 * Get the ResourceManager singleton instance.
 * @returns The ResourceManager singleton instance
 */
export function getResourceManager(): ResourceManager {
  return ResourceManager.getInstance();
}

/** Convert an object to a typed {@link CustomConnectionSpec}. */
export function CustomConnectionSpecFromJSON(obj: any): CustomConnectionSpec {
  if (obj == null) {
    return obj;
  }
  return {
    ...ConnectionSpecFromJSON(obj),
    id: obj["id"] as ConnectionId,
    formConnectionType: obj["formConnectionType"],
    specifiedConnectionType: obj["specifiedConnectionType"],
  };
}

/** Convert a typed {@link CustomConnectionSpec} to an object. */
export function CustomConnectionSpecToJSON(spec: CustomConnectionSpec): any {
  return {
    ...ConnectionSpecToJSON(spec),
    formConnectionType: spec.formConnectionType,
    specifiedConnectionType: spec.specifiedConnectionType,
  };
}

/** JSON-stringify a `Map`. Opposite of {@link stringToMap}. */
export function mapToString(map: Map<any, any>): string {
  return JSON.stringify(Object.fromEntries(map));
}

/** Convert a JSON-stringified Map back to a `Map`. Opposite of {@link mapToString}. */
export function stringToMap(str: string): Map<any, any> {
  return new Map(Object.entries(JSON.parse(str)));
}
