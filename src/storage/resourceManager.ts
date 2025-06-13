import { Mutex } from "async-mutex";
import { SecretStorage, Uri } from "vscode";
import { AuthCallbackEvent } from "../authn/types";
import {
  ConnectionSpec,
  ConnectionSpecFromJSON,
  ConnectionSpecToJSON,
  ConnectionType,
  Status,
} from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { getExtensionContext } from "../context/extension";
import { FormConnectionType } from "../directConnections/types";
import { ExtensionContextNotSetError } from "../errors";
import { Logger } from "../logging";
import { Environment, getEnvironmentClass } from "../models/environment";
import {
  CCloudKafkaCluster,
  getKafkaClusterClass,
  KafkaCluster,
  KafkaClusterSubclass,
} from "../models/kafkaCluster";
import {
  ConnectionId,
  connectionIdToType,
  EnvironmentId,
  ISchemaRegistryResource,
  UsedConnectionType,
} from "../models/resource";
import { Schema, Subject } from "../models/schema";
import {
  CCloudSchemaRegistry,
  getSchemaRegistryClass,
  SchemaRegistry,
} from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { SecretStorageKeys, UriMetadataKeys, WorkspaceStorageKeys } from "./constants";
import { GlobalState, UriMetadata, UriMetadataMap, WorkspaceState } from "./types";
import { getGlobalState, getSecretStorage, getWorkspaceState } from "./utils";

const logger = new Logger("storage.resourceManager");

/** Typesafe mapping of EnvironmentID -> KafkaCluster subclass[] . */
export type KafkaClustersByEnv<T extends KafkaClusterSubclass> = Map<EnvironmentId, T[]>;

/**
 * Type for storing {@link SchemaRegistry}s in extension state, where the parent {@link CCloudEnvironment} ID is the key.
 * @remarks If we ever have to deal with situations where multiple Schema Registries are
 * available under a single parent resource, this type will either need to be updated or a new type
 * will need to be created. For now, we're leaning into the fact that CCloud environments only have
 * one Schema Registry apiece.
 */
export type CCloudSchemaRegistryByEnv = Map<string, CCloudSchemaRegistry>;

/** Type for storing {@link KafkaTopic}s in extension state, where the parent {@link KafkaCluster} ID is the key. */
export type TopicsByKafkaCluster = Map<string, KafkaTopic[]>;

/** Type for storing {@link Schema}s in extension state, where the parent {@link CCloudSchemaRegistry} ID is the key. */
export type CCloudSchemaBySchemaRegistry = Map<string, Schema[]>;

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

/**
 * Singleton helper for interacting with Confluent-/Kafka-specific global/workspace state items and secrets.
 */
export class ResourceManager {
  /** Mutexes for each workspace/secret storage key to prevent conflicting concurrent writes */
  private mutexes: Map<WorkspaceStorageKeys | SecretStorageKeys, Mutex> = new Map();

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

    // Initialize mutexes for each workspace/secret storage key
    for (const key of [
      ...Object.values(WorkspaceStorageKeys),
      ...Object.values(SecretStorageKeys),
    ]) {
      this.mutexes.set(key, new Mutex());
    }
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
   * Delete all resources from extension state for this connection ID.
   */
  async deleteResources(connectionId: ConnectionId): Promise<void> {
    await Promise.all([
      this.setEnvironments(connectionId, []),
      this.setKafkaClusters(connectionId, []),
      this.setSchemaRegistries(connectionId, []),
      this.deleteTopics(connectionId),
      this.deleteSubjects(connectionId),
    ]);
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
    key: WorkspaceStorageKeys | SecretStorageKeys,
    callback: () => Promise<T>,
  ): Promise<T> {
    const mutex = this.mutexes.get(key);
    if (!mutex) {
      throw new Error(`No mutex found for key: ${key}`);
    }

    return await mutex.runExclusive(callback);
  }

  // ENVIRONMENTS

  getEnvironmentKey(connectionId: ConnectionId): WorkspaceStorageKeys {
    if (connectionId === CCLOUD_CONNECTION_ID) {
      return WorkspaceStorageKeys.CCLOUD_ENVIRONMENTS;
    }
    // we do not support Local or Direct connections for environments (yet, but soon!)
    throw new Error(`Unsupported connectionId ${connectionId} for environment key`);
  }

  async setEnvironments<T extends Environment>(
    connectionId: ConnectionId,
    environments: T[],
  ): Promise<void> {
    const storageKey = this.getEnvironmentKey(connectionId);

    if (environments.some((env) => env.connectionId !== connectionId)) {
      logger.error(
        `Connection ID mismatch in environments: expected ${connectionId}, found ${environments.map(
          (r) => r.connectionId,
        )}`,
      );
      throw new Error("Connection ID mismatch in environments");
    }

    await this.runWithMutex(storageKey, async () => {
      // Get the JSON-stringified map from storage
      const envsByConnectionString: string | undefined = await this.workspaceState.get(storageKey);
      const envsByConnection: Map<ConnectionId, T[]> = envsByConnectionString
        ? stringToMap(envsByConnectionString)
        : new Map<EnvironmentId, T[]>();

      // Set the new environment[] for this connection.
      envsByConnection.set(connectionId, environments);

      // Now save the updated map of connection id -> environment list into workspace storage
      await this.workspaceState.update(storageKey, mapToString(envsByConnection));
    });
  }

  async getEnvironments<T extends Environment>(connectionId: ConnectionId): Promise<T[]> {
    const storageKey = this.getEnvironmentKey(connectionId);

    // Get the JSON-stringified map from storage
    const environmentsByConnectionString: string | undefined =
      await this.workspaceState.get(storageKey);

    const environmentsByConnection: Map<ConnectionId, T[]> = environmentsByConnectionString
      ? stringToMap(environmentsByConnectionString)
      : new Map<ConnectionId, T[]>();

    // Will either be undefined or an array of plain objects since just deserialized from storage.
    const vanillaJSONenvironments: T[] | undefined = environmentsByConnection.get(connectionId);

    if (!vanillaJSONenvironments) {
      return [];
    }

    logger.debug(
      `Found ${vanillaJSONenvironments.length} environments for connection ${connectionId}`,
    );

    // Promote each from-json vanilla object member to be the proper instance of Environment sub-type, return.
    const environmentClass = getEnvironmentClass(connectionId);
    return vanillaJSONenvironments.map((env) => new environmentClass(env as any) as T);
  }

  // KAFKA CLUSTERS

  getKafkaClusterKey(connectionId: ConnectionId): WorkspaceStorageKeys {
    if (connectionId === CCLOUD_CONNECTION_ID) {
      return WorkspaceStorageKeys.CCLOUD_KAFKA_CLUSTERS;
    }

    // we do not support Local or Direct connections for Kafka clusters (yet, but soon!)
    throw new Error(`Unsupported connectionId ${connectionId}`);
  }

  /**
   * Store this array of KafkaCluster associated with this connection id
   * in extension workspace state. Replaces any previously stored array.
   * @param clusters The array of {@link KafkaCluster}s to store.
   */
  async setKafkaClusters<T extends KafkaCluster>(
    connectionId: ConnectionId,
    clusters: T[],
  ): Promise<void> {
    const storageKey = this.getKafkaClusterKey(connectionId);

    if (clusters.some((cluster) => cluster.connectionId !== connectionId)) {
      logger.error(
        `Connection ID mismatch in clusters: expected ${connectionId}, found ${clusters.map(
          (r) => r.connectionId,
        )}`,
      );
      throw new Error("Connection ID mismatch in clusters");
    }

    await this.runWithMutex(storageKey, async () => {
      // Get the JSON-stringified map from storage
      const clustersByConnectionString: string | undefined =
        await this.workspaceState.get(storageKey);
      const clustersByConnection: Map<ConnectionId, T[]> = clustersByConnectionString
        ? stringToMap(clustersByConnectionString)
        : new Map<string, T[]>();

      // Set the new cluster[] for this connection.
      clustersByConnection.set(connectionId, clusters);

      // Now save the updated map of connection id -> kafka cluster list into workspace storage
      // for this connection-type-derived storageKey.
      await this.workspaceState.update(storageKey, mapToString(clustersByConnection));
    });
  }

  /**
   * Get the cached {@link KafkaCluster}s for this connection from extension state.
   * @returns connectionType-related {@link KafkaCluster} subclass []>
   */
  async getKafkaClusters<T extends KafkaCluster>(connectionId: ConnectionId): Promise<T[]> {
    const storageKey = this.getKafkaClusterKey(connectionId);

    // Get the JSON-stringified map from storage
    const clustersByConnectionString: string | undefined =
      await this.workspaceState.get(storageKey);

    const clustersByConnection: Map<ConnectionId, T[]> = clustersByConnectionString
      ? stringToMap(clustersByConnectionString)
      : new Map<ConnectionId, T[]>();

    // Will either be undefined or an array of plain objects since just deserialized from storage.
    const vanillaJSONclusters: T[] | undefined = clustersByConnection.get(connectionId);

    if (!vanillaJSONclusters) {
      return [];
    }

    logger.debug(
      `Found ${vanillaJSONclusters.length} kafka clusters for connection ${connectionId}`,
    );

    // Promote each from-json vanilla object member to be the proper instance of KafkaCluster sub-type, return.
    const kafkaClusterClass = getKafkaClusterClass(connectionId);
    return vanillaJSONclusters.map((cluster) => kafkaClusterClass.create(cluster) as T);
  }

  /**
   * Get the list of cached Kafka clusters for a specific connection ID + environment from extension state.
   * @param connectionId The ID of the connection for which to get Kafka clusters.
   * @param environmentId The ID of the {@link Environment} for which to get Kafka clusters
   * @returns The list of {@link KafkaCluster}s for the specified environment. If no clusters are found, an empty array is returned.
   */
  async getKafkaClustersForEnvironmentId<T extends KafkaCluster>(
    connectionId: ConnectionId,
    environmentId: EnvironmentId,
  ): Promise<T[]> {
    const clusters: T[] = await this.getKafkaClusters(connectionId);
    return clusters.filter((cluster) => cluster.environmentId === environmentId);
  }

  // SCHEMA REGISTRY

  getSchemaRegistryKey(connectionId: ConnectionId): WorkspaceStorageKeys {
    if (connectionId === CCLOUD_CONNECTION_ID) {
      return WorkspaceStorageKeys.CCLOUD_SCHEMA_REGISTRIES;
    }
    // Only CCloud support to start with, but can easily expand in future.
    throw new Error(`Unsupported connectionId ${connectionId} for schema registry key`);
  }

  /** Cache this connection's schema registry/ies. Generic over SchemaRegistry subclass T. */
  async setSchemaRegistries<T extends SchemaRegistry>(
    connectionId: ConnectionId,
    registries: T[],
  ): Promise<void> {
    /*
     * Store into one of three toplevel storage keys (key in workspace storage based on connection type),
     * where the interior value is a map keyed by connectionId -> an array of SchemaRegistry.
     * (The interior map is useful for when caching Direct connection schema registries,
     *  but is degenerate only single-key for CCloud and Local connections.)
     */
    const storageKey = this.getSchemaRegistryKey(connectionId);

    if (registries.some((registry) => registry.connectionId !== connectionId)) {
      logger.error(
        `Connection ID mismatch in registries: expected ${connectionId}, found ${registries.map(
          (r) => r.connectionId,
        )}`,
      );
      throw new Error("Connection ID mismatch in registries");
    }

    await this.runWithMutex(storageKey, async () => {
      // Get the JSON-stringified map from storage
      const registriesByConnectionString: string | undefined =
        await this.workspaceState.get(storageKey);
      const registriesByConnection: Map<ConnectionId, T[]> = registriesByConnectionString
        ? stringToMap(registriesByConnectionString)
        : new Map<ConnectionId, T[]>();

      // Set the new registries for this connection.
      registriesByConnection.set(connectionId, registries);

      // Now save the updated map of connection id -> schema registry list into workspace storage
      await this.workspaceState.update(storageKey, mapToString(registriesByConnection));
    });
  }

  /** Get the properly subtyped schema registries for this connection id from storage. If none are found, will return empty array. */
  async getSchemaRegistries<T extends SchemaRegistry>(connectionId: ConnectionId): Promise<T[]> {
    const storageKey = this.getSchemaRegistryKey(connectionId);

    // Get the JSON-stringified map from storage
    const registriesByConnectionString: string | undefined =
      await this.workspaceState.get(storageKey);

    const registriesByConnection: Map<string, T[]> = registriesByConnectionString
      ? stringToMap(registriesByConnectionString)
      : new Map<ConnectionId, T[]>();

    // Will either be undefined or an array of plain objects since just deserialized from storage.
    const vanillaJSONRegistries: T[] | undefined = registriesByConnection.get(connectionId);

    if (!vanillaJSONRegistries) {
      return [];
    }

    logger.debug(
      `Found ${vanillaJSONRegistries.length} schema registries for connection ${connectionId}`,
    );

    const schemaRegistryClass = getSchemaRegistryClass(connectionId);
    // Promote each from-json vanilla object member to be the proper instance of SchemaRegistry sub-type, return.
    return vanillaJSONRegistries.map((registry) => schemaRegistryClass.create(registry) as T);
  }

  /** Immutable mapping of connection type -> toplevel storage key for storing schema subjects. */
  private readonly connectionTypeToSubjectsStorageKey: Record<
    UsedConnectionType,
    WorkspaceStorageKeys
  > = {
    [ConnectionType.Ccloud]: WorkspaceStorageKeys.CCLOUD_SR_SUBJECTS,
    [ConnectionType.Local]: WorkspaceStorageKeys.LOCAL_SR_SUBJECTS,
    [ConnectionType.Direct]: WorkspaceStorageKeys.DIRECT_SR_SUBJECTS,
  } as const;

  /**
   * Determine what workspace storage key should be used for subject storage for this schema registry
   * based on its connection type.
   *   - {@link WorkspaceStorageKeys.CCLOUD_SR_SUBJECTS} for ccloud-based schema registries.
   *   - {@link WorkspaceStorageKeys.LOCAL_SR_SUBJECTS} for local-based schema registries.
   *   - {@link WorkspaceStorageKeys.DIRECT_SR_SUBJECTS} for direct-based schema registries.
   */
  getSubjectKey(connectionId: ConnectionId): WorkspaceStorageKeys {
    const connectionType = connectionIdToType(connectionId);

    return this.connectionTypeToSubjectsStorageKey[connectionType];
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
    const workspaceStorageKey = this.getSubjectKey(schemaRegistryKeyable.connectionId);

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

  async deleteSubjects(connectionId: ConnectionId): Promise<void> {
    // Delete all subjects for this connection ID, which will clear the workspace storage key.
    const storageKey = this.getSubjectKey(connectionId);
    await this.workspaceState.update(storageKey, undefined);
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
    const key = this.subjectKeyForSchemaRegistry(schemaRegistryKeyable);

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

  /**
   * Delete all ccloud schema registry subjects.
   */
  async deleteCCloudSubjects(): Promise<void> {
    return await this.workspaceState.update(WorkspaceStorageKeys.CCLOUD_SR_SUBJECTS, undefined);
  }

  /**
   * Delete all local schema registry subjects.
   *
   * Currently not called, but should probably be. Likewise for any direct connection assets.
   * @see {@link deleteCCloudResources}, probably need equivalents for both.
   */
  async deleteLocalSubjects(): Promise<void> {
    return await this.workspaceState.update(WorkspaceStorageKeys.LOCAL_SR_SUBJECTS, undefined);
  }

  // TOPICS

  /**
   *  Store this (possibly empty) list of topics for a cluster, be it local or ccloud, in workspace state.
   *  If is known that a given cluster has no topics, then should call with empty topic array.
   *
   *  Raises an error if the cluster ID of any topic does not match the given cluster's ID.
   */
  async setTopicsForCluster(cluster: KafkaCluster, topics: KafkaTopic[]): Promise<void> {
    // Ensure that all topics have the correct cluster ID.
    if (topics.some((topic) => topic.clusterId !== cluster.id)) {
      logger.warn("Cluster ID mismatch in topics", cluster, topics);
      throw new Error("Cluster ID mismatch in topics");
    }

    const key = this.topicKeyForCluster(cluster);

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
  async getTopicsForCluster(cluster: KafkaCluster): Promise<KafkaTopic[] | undefined> {
    const key = this.topicKeyForCluster(cluster);

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

  /**
   * Delete all ccloud topics from workspace state, such as when user logs out from ccloud.
   */
  async deleteCCloudTopics(): Promise<void> {
    return await this.workspaceState.update(WorkspaceStorageKeys.CCLOUD_KAFKA_TOPICS, undefined);
  }

  /**
   * Return the use-with-storage StateKafkaTopics key for this type of cluster.
   *
   * (not private only for testing)
   */
  topicKeyForCluster(cluster: KafkaCluster): WorkspaceStorageKeys {
    if (cluster instanceof CCloudKafkaCluster) {
      return WorkspaceStorageKeys.CCLOUD_KAFKA_TOPICS;
    } else {
      logger.warn("Unknown cluster type", cluster);
      throw new Error("Unknown cluster type");
    }
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

  /** Store the latest CCloud auth status from the sidecar, controlled by the auth poller. */
  async setCCloudAuthStatus(status: Status): Promise<void> {
    await this.secrets.store(SecretStorageKeys.CCLOUD_AUTH_STATUS, String(status));
  }

  /** Get the latest CCloud auth status from the sidecar, controlled by the auth poller. */
  async getCCloudAuthStatus(): Promise<string | undefined> {
    return await this.secrets.get(SecretStorageKeys.CCLOUD_AUTH_STATUS);
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
