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
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, isCCloud, ISchemaRegistryResource, isLocal } from "../models/resource";
import { Schema, Subject } from "../models/schema";
import { CCloudSchemaRegistry, SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { SecretStorageKeys, UriMetadataKeys, WorkspaceStorageKeys } from "./constants";
import { GlobalState, UriMetadata, UriMetadataMap, WorkspaceState } from "./types";
import { getGlobalState, getSecretStorage, getWorkspaceState } from "./utils";

const logger = new Logger("storage.resourceManager");

/** Type for storing {@link CCloudKafkaCluster}s in extension state, where the parent {@link CCloudEnvironment} ID is the key. */
export type CCloudKafkaClustersByEnv = Map<string, CCloudKafkaCluster[]>;

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

  private globalState: GlobalState;
  private workspaceState: WorkspaceState;
  private secrets: SecretStorage;

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

  static instance: ResourceManager | null = null;
  static getInstance(): ResourceManager {
    if (!ResourceManager.instance) {
      // will throw an ExtensionContextNotSetError if the context isn't set during activation
      ResourceManager.instance = new ResourceManager();
    }
    return ResourceManager.instance;
  }

  /**
   * Delete all Confluent Cloud-related resources from extension state.
   * @remarks This is primarily used during any CCloud connection changes where we need to "reset".
   * As the scope of stored CCloud resources grows, this method may need to be updated to handle
   * new resource types / storage keys.
   */
  async deleteCCloudResources(): Promise<void> {
    await Promise.all([
      this.deleteCCloudEnvironments(),
      this.deleteCCloudKafkaClusters(),
      this.setSchemaRegistries(CCLOUD_CONNECTION_ID, []), // clear CCloud schema registries
      this.deleteCCloudTopics(),
      this.deleteCCloudSubjects(),
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

  /**
   * Set the list of available CCloud environments in extension state.
   */
  async setCCloudEnvironments(environments: CCloudEnvironment[]): Promise<void> {
    await this.workspaceState.update(WorkspaceStorageKeys.CCLOUD_ENVIRONMENTS, environments);
  }

  /**
   * Get the list of available CCloud environments from extension state.
   * @returns The list of CCloud environments
   */
  async getCCloudEnvironments(): Promise<CCloudEnvironment[]> {
    // Will be deserialized plain JSON objects, not instances of CCloudEnvironment.
    const plain_json_environments: CCloudEnvironment[] =
      this.workspaceState.get(WorkspaceStorageKeys.CCLOUD_ENVIRONMENTS) ?? [];

    // Promote each member to be an instance of CCloudEnvironment
    return plain_json_environments.map((env) => new CCloudEnvironment(env));
  }

  /**
   * Get a specific CCloud environment from extension state.
   * @param environmentId The ID of the environment to get
   * @returns The CCloud environment, or null if the environment is not found
   */
  async getCCloudEnvironment(environmentId: string): Promise<CCloudEnvironment | null> {
    const environments: CCloudEnvironment[] = await this.getCCloudEnvironments();
    return environments.find((env) => env.id === environmentId) ?? null;
  }

  /**
   * Delete the list of available CCloud environments from extension state
   */
  async deleteCCloudEnvironments(): Promise<void> {
    await this.workspaceState.update(WorkspaceStorageKeys.CCLOUD_ENVIRONMENTS, undefined);
  }

  // KAFKA CLUSTERS

  /**
   * Convert an array of available (CCloud) Kafka clusters and store as a {@link CCloudKafkaClustersByEnv}
   * in extension state.
   * @param clusters The array of {@link CCloudKafkaCluster}s to store
   */
  async setCCloudKafkaClusters(clusters: CCloudKafkaCluster[]): Promise<void> {
    const storageKey = WorkspaceStorageKeys.CCLOUD_KAFKA_CLUSTERS;
    await this.runWithMutex(storageKey, async () => {
      // get any existing map of <environmentId, CCloudKafkaCluster[]>
      const existingEnvClusters: CCloudKafkaClustersByEnv =
        (await this.getCCloudKafkaClusters()) ?? new Map();
      // create a map of <environmentId, CCloudKafkaCluster[]> for the new clusters
      const newClustersByEnv: CCloudKafkaClustersByEnv = new Map();
      clusters.forEach((cluster) => {
        if (!newClustersByEnv.has(cluster.environmentId)) {
          newClustersByEnv.set(cluster.environmentId, []);
        }
        newClustersByEnv.get(cluster.environmentId)?.push(cluster);
      });
      // merge the new clusters into the existing map
      for (const [envId, newClusters] of newClustersByEnv) {
        // replace any existing clusters for the environment with the new clusters
        existingEnvClusters.set(envId, newClusters);
      }
      await this.workspaceState.update(storageKey, mapToString(existingEnvClusters));
    });
  }

  /**
   * Get the available {@link CCloudKafkaCluster}s from extension state.
   * @returns The map of <environmentId (string), {@link CCloudKafkaCluster}[]>
   */
  async getCCloudKafkaClusters(): Promise<CCloudKafkaClustersByEnv> {
    // Get the JSON-stringified map from storage
    const clustersByEnvString: string | undefined = this.workspaceState.get(
      WorkspaceStorageKeys.CCLOUD_KAFKA_CLUSTERS,
    );
    const clustersByEnv: Map<string, object[]> = clustersByEnvString
      ? stringToMap(clustersByEnvString)
      : new Map<string, object[]>();
    // cast any values back to CCloudKafkaCluster instances
    return new Map(
      Array.from(clustersByEnv).map(([envId, clusters]) => [
        envId,
        clusters.map((cluster) => CCloudKafkaCluster.create(cluster as CCloudKafkaCluster)),
      ]),
    );
  }

  /**
   * Get a specific CCloud Kafka cluster from extension state.
   * @param environmentId The ID of the {@link CCloudEnvironment} from which to get the Kafka cluster
   * @param clusterId The ID of the {@link CCloudKafkaCluster} to get
   * @returns The {@link CCloudKafkaCluster}, or `null` (if the environment or cluster are not found)
   */
  async getCCloudKafkaCluster(
    environmentId: string,
    clusterId: string,
  ): Promise<CCloudKafkaCluster | null> {
    const clusters: CCloudKafkaClustersByEnv = await this.getCCloudKafkaClusters();
    const clustersForEnv = clusters.get(environmentId);
    if (!clustersForEnv) {
      logger.warn(`No Kafka clusters found for environment ${environmentId}`);
      return null;
    }
    return clustersForEnv.find((cluster) => cluster.id === clusterId) ?? null;
  }

  /**
   * Get the list of available CCloud Kafka clusters for a specific environment from extension state.
   * @param environmentId The ID of the {@link CCloudEnvironment} for which to get Kafka clusters
   * @returns The list of {@link CCloudKafkaCluster}s for the specified environment. If no clusters are found, an empty array is returned.
   */
  async getCCloudKafkaClustersForEnvironment(environmentId: string): Promise<CCloudKafkaCluster[]> {
    const clusters: CCloudKafkaClustersByEnv = await this.getCCloudKafkaClusters();
    return clusters.get(environmentId) ?? [];
  }

  /**
   * Delete the list of available Kafka clusters from extension state.
   * @param environment Optional: the ID of the environment for which to delete Kafka clusters;
   * if not provided, all <environmentId, {@link CCloudKafkaCluster}> pairs will be deleted
   */
  async deleteCCloudKafkaClusters(environment?: string): Promise<void> {
    const storageKey = WorkspaceStorageKeys.CCLOUD_KAFKA_CLUSTERS;
    await this.runWithMutex(storageKey, async () => {
      if (!environment) {
        return await this.workspaceState.update(storageKey, undefined);
      }
      const clusters = await this.getCCloudKafkaClusters();
      clusters.delete(environment);
      await this.workspaceState.update(storageKey, mapToString(clusters));
    });
  }

  /**
   * Set the list of available local Kafka clusters in extension state.
   * @param clusters The list of local Kafka clusters to set
   */
  async setLocalKafkaClusters(clusters: LocalKafkaCluster[]): Promise<void> {
    await this.workspaceState.update(WorkspaceStorageKeys.LOCAL_KAFKA_CLUSTERS, clusters);
  }

  /**
   * Get the list of available local Kafka clusters from extension state.
   * @returns The list of local Kafka clusters
   */
  async getLocalKafkaClusters(): Promise<LocalKafkaCluster[]> {
    const plainJsonLocalClusters: LocalKafkaCluster[] = this.workspaceState.get(
      WorkspaceStorageKeys.LOCAL_KAFKA_CLUSTERS,
      [],
    );

    // Promote each member to be an instance of LocalKafkaCluster, return.
    return plainJsonLocalClusters.map((cluster) => LocalKafkaCluster.create(cluster));
  }

  /**
   * Get a specific local Kafka cluster from extension state.
   * @param clusterId The ID of the cluster to get
   * @returns The local Kafka cluster, or null if the cluster is not found
   */
  async getLocalKafkaCluster(clusterId: string): Promise<LocalKafkaCluster | null> {
    const clusters: LocalKafkaCluster[] = await this.getLocalKafkaClusters();
    return clusters.find((cluster) => cluster.id === clusterId) ?? null;
  }

  /** Get the cluster for this topic. May return either a ccloud or local cluster */
  async getClusterForTopic(topic: KafkaTopic): Promise<KafkaCluster | null> {
    if (isLocal(topic)) {
      return this.getLocalKafkaCluster(topic.clusterId);
    } else if (isCCloud(topic)) {
      return this.getCCloudKafkaCluster(topic.environmentId, topic.clusterId);
    }
    // TODO(shoup): add isDirect() check here?
    return null;
  }

  // SCHEMA REGISTRY

  getSchemaRegistryKey(connectionId: ConnectionId): WorkspaceStorageKeys {
    if (connectionId === CCLOUD_CONNECTION_ID) {
      return WorkspaceStorageKeys.CCLOUD_SCHEMA_REGISTRIES;
    }
    // Only CCLoud support to start with, but can easily expand in future.
    throw new Error(`Unsupported connectionId ${connectionId} for schema registry key`);
  }

  /** Cache this connection's schema registry/ies. Generic over SchemaRegistry subclass T. */
  async setSchemaRegistries<T extends SchemaRegistry>(
    connectionId: ConnectionId,
    registries: T | T[],
  ): Promise<void> {
    /*
     * Store into one of three toplevel storage keys (key in workspace storage based on connection type),
     * where the interior value is a map keyed by connectionId -> an array of SchemaRegistry.
     * (The interior map is useful for when caching Direct connection schema registries,
     *  but is degenerate only single-key for CCloud and Local connections.)
     */
    const storageKey = this.getSchemaRegistryKey(connectionId);

    // If a single registry is provided, promote it to array.
    const registriesArray: T[] = Array.isArray(registries) ? registries : [registries];

    if (registriesArray.some((registry) => registry.connectionId !== connectionId)) {
      logger.error(
        `Connection ID mismatch in registries: expected ${connectionId}, found ${registriesArray.map(
          (r) => r.connectionId,
        )}`,
      );
      throw new Error("Connection ID mismatch in registries");
    }

    await this.runWithMutex(storageKey, async () => {
      // Get the JSON-stringified map from storage
      const registriesByConnectionString: string | undefined =
        await this.workspaceState.get(storageKey);
      const registriesByConnection: Map<string, object[]> = registriesByConnectionString
        ? stringToMap(registriesByConnectionString)
        : new Map<string, object[]>();

      // Set the new registries for this connection.
      registriesByConnection.set(connectionId, registriesArray);

      // Now save the updated map of connection id -> schema registry list into workspace storage
      await this.workspaceState.update(storageKey, mapToString(registriesByConnection));
    });
  }

  /** Get the properly subtyped schema registries for this connection id from storage. If none are found, will return empty array. */
  async getSchemaRegistries<T extends SchemaRegistry>(connectionId: ConnectionId): Promise<T[]> {
    const storageKey = this.getSchemaRegistryKey(connectionId);

    let registriesByConnectionString: string | undefined;

    // Get the JSON-stringified map from storage
    registriesByConnectionString = await this.workspaceState.get(storageKey);

    const registriesByConnection: Map<string, object[]> = registriesByConnectionString
      ? stringToMap(registriesByConnectionString)
      : new Map<string, object[]>();

    // Will either be undefined or an array of plain objects since just deserialized from storage.
    const vanillaJSONRegistries: object[] | undefined = registriesByConnection.get(connectionId);

    if (!vanillaJSONRegistries) {
      return [];
    }

    logger.debug(
      `Found ${vanillaJSONRegistries.length} schema registries for connection ${connectionId}`,
    );

    const schemaRegistryClass = SchemaRegistry.getSchemaRegistryClass(connectionId);
    // Promote each object member to be the proper instance of SchemaRegistry sub-type, return.
    return vanillaJSONRegistries.map((registry) => schemaRegistryClass.create(registry as T) as T);
  }

  /**
   * Delete the list of available local Kafka clusters from extension state.
   */
  async deleteLocalKafkaClusters(): Promise<void> {
    await this.workspaceState.update(WorkspaceStorageKeys.LOCAL_KAFKA_CLUSTERS, undefined);
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
    const workspaceStorageKey = this.subjectKeyForSchemaRegistry(schemaRegistryKeyable);

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

  /**
   * Determine what workspace storage key should be used for subject storage for this schema registry
   * based on its connection type.
   */
  subjectKeyForSchemaRegistry(
    schemaRegistryKeyable: ISchemaRegistryResource,
  ): WorkspaceStorageKeys {
    switch (schemaRegistryKeyable.connectionType) {
      case ConnectionType.Ccloud:
        return WorkspaceStorageKeys.CCLOUD_SR_SUBJECTS;
      case ConnectionType.Local:
        return WorkspaceStorageKeys.LOCAL_SR_SUBJECTS;
      case ConnectionType.Direct:
        return WorkspaceStorageKeys.DIRECT_SR_SUBJECTS;
      default:
        logger.warn("Unknown schema registry connection type", {
          sr: JSON.stringify(schemaRegistryKeyable, null, 2),
        });
        throw new Error("Unknown schema registry connection type");
    }
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
