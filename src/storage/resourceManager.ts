import { Mutex } from "async-mutex";
import { getStorageManager, StorageManager } from ".";
import { AuthCallbackEvent } from "../authn/types";
import {
  ConnectionSpec,
  ConnectionSpecFromJSON,
  ConnectionSpecToJSON,
  ConnectionType,
  Status,
} from "../clients/sidecar";
import { FormConnectionType } from "../directConnections/types";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, isCCloud, ISchemaRegistryResource, isLocal } from "../models/resource";
import { Schema, Subject } from "../models/schema";
import { CCloudSchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { SecretStorageKeys, UriMetadataKeys, WorkspaceStorageKeys } from "./constants";

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

/** Single URI's confluent-extension-centric metadata */
export type UriMetadata = Map<UriMetadataKeys, string>;

/** Map of string of uri for a file -> dict of its confluent-extension-centric metadata */
export type AllUriMetadata = Map<string, UriMetadata>;

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
  static instance: ResourceManager | null = null;

  /** Mutexes for each workspace/secret storage key to prevent conflicting concurrent writes */
  private mutexes: Map<WorkspaceStorageKeys | SecretStorageKeys, Mutex> = new Map();

  private constructor(private storage: StorageManager) {
    // Initialize mutexes for each workspace/secret storage key
    for (const key of [
      ...Object.values(WorkspaceStorageKeys),
      ...Object.values(SecretStorageKeys),
    ]) {
      this.mutexes.set(key, new Mutex());
    }
  }

  static getInstance(): ResourceManager {
    if (!ResourceManager.instance) {
      // will throw an ExtensionContextNotSetError if the context isn't available for StorageManager
      ResourceManager.instance = new ResourceManager(getStorageManager());
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
      this.deleteCCloudSchemaRegistries(),
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
    await this.storage.setWorkspaceState(WorkspaceStorageKeys.CCLOUD_ENVIRONMENTS, environments);
  }

  /**
   * Get the list of available CCloud environments from extension state.
   * @returns The list of CCloud environments
   */
  async getCCloudEnvironments(): Promise<CCloudEnvironment[]> {
    // Will be deserialized plain JSON objects, not instances of CCloudEnvironment.
    const plain_json_environments: CCloudEnvironment[] =
      (await this.storage.getWorkspaceState<CCloudEnvironment[]>(
        WorkspaceStorageKeys.CCLOUD_ENVIRONMENTS,
      )) ?? [];

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
    await this.storage.deleteWorkspaceState(WorkspaceStorageKeys.CCLOUD_ENVIRONMENTS);
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
      await this.storage.setWorkspaceState(storageKey, mapToString(existingEnvClusters));
    });
  }

  /**
   * Get the available {@link CCloudKafkaCluster}s from extension state.
   * @returns The map of <environmentId (string), {@link CCloudKafkaCluster}[]>
   */
  async getCCloudKafkaClusters(): Promise<CCloudKafkaClustersByEnv> {
    // Get the JSON-stringified map from storage
    const clustersByEnvString: string | undefined = await this.storage.getWorkspaceState(
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
        return await this.storage.deleteWorkspaceState(storageKey);
      }
      const clusters = await this.getCCloudKafkaClusters();
      clusters.delete(environment);
      await this.storage.setWorkspaceState(storageKey, mapToString(clusters));
    });
  }

  /**
   * Set the list of available local Kafka clusters in extension state.
   * @param clusters The list of local Kafka clusters to set
   */
  async setLocalKafkaClusters(clusters: LocalKafkaCluster[]): Promise<void> {
    await this.storage.setWorkspaceState(WorkspaceStorageKeys.LOCAL_KAFKA_CLUSTERS, clusters);
  }

  /**
   * Get the list of available local Kafka clusters from extension state.
   * @returns The list of local Kafka clusters
   */
  async getLocalKafkaClusters(): Promise<LocalKafkaCluster[]> {
    const plainJsonLocalClusters =
      (await this.storage.getWorkspaceState<LocalKafkaCluster[]>(
        WorkspaceStorageKeys.LOCAL_KAFKA_CLUSTERS,
      )) ?? [];

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

  /**
   * Delete the list of available local Kafka clusters from extension state.
   */
  async deleteLocalKafkaClusters(): Promise<void> {
    await this.storage.deleteWorkspaceState(WorkspaceStorageKeys.LOCAL_KAFKA_CLUSTERS);
  }

  /** Get the cluster for this topic. May return either a ccloud or local cluster */
  async getClusterForTopic(topic: KafkaTopic): Promise<KafkaCluster | null> {
    if (isLocal(topic)) {
      return this.getLocalKafkaCluster(topic.clusterId);
    } else if (isCCloud(topic)) {
      return this.getCCloudKafkaCluster(topic.environmentId!, topic.clusterId);
    }
    // TODO(shoup): add isDirect() check here?
    return null;
  }

  // SCHEMA REGISTRY

  /** Cache all of the CCloud schema registries at once. */
  async setCCloudSchemaRegistries(clusters: CCloudSchemaRegistry[]): Promise<void> {
    const clustersByEnv: CCloudSchemaRegistryByEnv = new Map();
    clusters.forEach((cluster) => {
      clustersByEnv.set(cluster.environmentId, cluster);
    });
    await this.storage.setWorkspaceState(
      WorkspaceStorageKeys.CCLOUD_SCHEMA_REGISTRIES,
      mapToString(clustersByEnv),
    );
  }

  /**
   * Get the available {@link CCloudSchemaRegistry}s from extension state.
   * @returns The map of <environmentId (string), {@link CCloudSchemaRegistry}>
   */
  async getCCloudSchemaRegistries(): Promise<CCloudSchemaRegistryByEnv> {
    // Get the JSON-stringified map from storage
    const registriesByEnvString: string | undefined = await this.storage.getWorkspaceState(
      WorkspaceStorageKeys.CCLOUD_SCHEMA_REGISTRIES,
    );
    const registriesByEnv: Map<string, object> = registriesByEnvString
      ? stringToMap(registriesByEnvString)
      : new Map<string, object>();
    // cast any values back to CCloudSchemaRegistry instances
    return new Map(
      Array.from(registriesByEnv).map(([envId, registry]) => [
        envId,
        CCloudSchemaRegistry.create(registry as CCloudSchemaRegistry),
      ]),
    );
  }

  /**
   * Get a specific Schema Registry from extension state.
   * @param environmentId The ID of the {@link CCloudEnvironment} from which to get the Schema Registry
   * @returns The associated {@link CCloudSchemaRegistry}, or `null` (if the environment is not found or has no Schema Registry)
   */
  async getCCloudSchemaRegistry(environmentId: string): Promise<CCloudSchemaRegistry | null> {
    const schemaRegistries: CCloudSchemaRegistryByEnv = await this.getCCloudSchemaRegistries();
    const schemaRegistryForEnv: CCloudSchemaRegistry | null =
      schemaRegistries.get(environmentId) ?? null;
    if (!schemaRegistryForEnv) {
      logger.warn(`No Schema Registry found for environment ${environmentId}`);
    }
    return schemaRegistryForEnv;
  }

  /** Get a specific Schema Registry by its id */
  async getCCloudSchemaRegistryById(id: string): Promise<CCloudSchemaRegistry | null> {
    const clusters = await this.getCCloudSchemaRegistries();
    for (const cluster of clusters.values()) {
      if (cluster.id === id) {
        return cluster;
      }
    }
    return null;
  }

  /**
   * Delete the list of available Schema Registries from extension state.
   * @param environment Optional: the ID of the environment for which to delete Schema Registries;
   * if not provided, all <environmentId, {@link CCloudSchemaRegistry}> pairs will be deleted
   */
  async deleteCCloudSchemaRegistries(environment?: string): Promise<void> {
    const storageKey = WorkspaceStorageKeys.CCLOUD_SCHEMA_REGISTRIES;
    await this.runWithMutex(storageKey, async () => {
      if (!environment) {
        return await this.storage.deleteWorkspaceState(storageKey);
      }
      const schemaRegistriesByEnv = await this.getCCloudSchemaRegistries();
      schemaRegistriesByEnv.delete(environment);
      await this.storage.setWorkspaceState(storageKey, mapToString(schemaRegistriesByEnv));
    });
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
        await this.storage.getWorkspaceState<string>(workspaceStorageKey);

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
      await this.storage.setWorkspaceState(
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
      subjectsByRegistryIDString = await this.storage.getWorkspaceState<string>(key);
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
    return await this.storage.deleteWorkspaceState(WorkspaceStorageKeys.CCLOUD_SR_SUBJECTS);
  }

  /**
   * Delete all local schema registry subjects.
   *
   * Currently not called, but should probably be. Likewise for any direct connection assets.
   * @see {@link deleteCCloudResources}, probably need equivalents for both.
   */
  async deleteLocalSubjects(): Promise<void> {
    return await this.storage.deleteWorkspaceState(WorkspaceStorageKeys.LOCAL_SR_SUBJECTS);
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
      const topicsByClusterString: string | undefined =
        await this.storage.getWorkspaceState<string>(key);
      const topicsByCluster: Map<string, object[]> = topicsByClusterString
        ? stringToMap(topicsByClusterString)
        : new Map<string, object[]>();

      // Set the new topics for the cluster
      topicsByCluster.set(cluster.id, topics);

      // Now save the updated cluster topics into the proper key'd storage.
      await this.storage.setWorkspaceState(key, mapToString(topicsByCluster));
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
    const topicsByClusterString: string | undefined =
      await this.storage.getWorkspaceState<string>(key);
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
    return await this.storage.deleteWorkspaceState(WorkspaceStorageKeys.CCLOUD_KAFKA_TOPICS);
  }

  /**
   * Delete all local topics from workspace state, such as when we notice that the local cluster has been deleted.
   * or we just started up a new local cluster.
   */
  async deleteLocalTopics(): Promise<void> {
    return await this.storage.deleteWorkspaceState(WorkspaceStorageKeys.LOCAL_KAFKA_TOPICS);
  }

  /**
   * Return the use-with-storage StateKafkaTopics key for this type of cluster.
   *
   * (not private only for testing)
   */
  topicKeyForCluster(cluster: KafkaCluster): WorkspaceStorageKeys {
    if (cluster instanceof CCloudKafkaCluster) {
      return WorkspaceStorageKeys.CCLOUD_KAFKA_TOPICS;
    } else if (cluster instanceof LocalKafkaCluster) {
      return WorkspaceStorageKeys.LOCAL_KAFKA_TOPICS;
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
      this.storage.setSecret(SecretStorageKeys.AUTH_COMPLETED, String(authCallback.success)),
      this.storage.setSecret(
        SecretStorageKeys.AUTH_PASSWORD_RESET,
        String(authCallback.resetPassword),
      ),
    ]);
  }

  /**
   * Get the secret key that indicates whether the CCloud auth flow has completed successfully.
   * @returns `true` if the auth flow completed successfully; `false` otherwise
   */
  async getAuthFlowCompleted(): Promise<boolean> {
    const success: string | undefined = await this.storage.getSecret(
      SecretStorageKeys.AUTH_COMPLETED,
    );
    return success === "true";
  }

  /** Get the flag indicating whether or not the user has reset their password recently. */
  async getAuthFlowPasswordReset(): Promise<boolean> {
    const reset: string | undefined = await this.storage.getSecret(
      SecretStorageKeys.AUTH_PASSWORD_RESET,
    );
    return reset === "true";
  }

  /** Store the latest CCloud auth status from the sidecar, controlled by the auth poller. */
  async setCCloudAuthStatus(status: Status): Promise<void> {
    await this.storage.setSecret(SecretStorageKeys.CCLOUD_AUTH_STATUS, String(status));
  }

  /** Get the latest CCloud auth status from the sidecar, controlled by the auth poller. */
  async getCCloudAuthStatus(): Promise<string | undefined> {
    return await this.storage.getSecret(SecretStorageKeys.CCLOUD_AUTH_STATUS);
  }

  // DIRECT CONNECTIONS - entirely handled through SecretStorage

  /** Look up the {@link ConnectionId}:{@link ConnectionSpec} map for any existing `DIRECT` connections. */
  async getDirectConnections(): Promise<DirectConnectionsById> {
    // Get the JSON-stringified map from storage
    const connectionsString: string | undefined = await this.storage.getSecret(
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
      connectionIds.set(spec.id! as ConnectionId, spec);
      const serializedConnections = Object.fromEntries(
        Array.from(connectionIds.entries()).map(([id, spec]) => [
          id,
          CustomConnectionSpecToJSON(spec),
        ]),
      );
      await this.storage.setSecret(key, JSON.stringify(serializedConnections));
    });
  }

  async deleteDirectConnection(id: ConnectionId): Promise<void> {
    const key = SecretStorageKeys.DIRECT_CONNECTIONS;
    return await this.runWithMutex(key, async () => {
      const connections: DirectConnectionsById = await this.getDirectConnections();
      connections.delete(id);
      await this.storage.setSecret(key, mapToString(connections));
    });
  }

  async deleteDirectConnections(): Promise<void> {
    const key = SecretStorageKeys.DIRECT_CONNECTIONS;
    return await this.runWithMutex(key, async () => {
      await this.storage.deleteSecret(key);
    });
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
