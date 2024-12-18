import { Mutex } from "async-mutex";
import { Uri } from "vscode";
import { StorageManager, getStorageManager } from ".";
import { ConnectionSpec, Status } from "../clients/sidecar";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, isCCloud, isLocal } from "../models/resource";
import { Schema } from "../models/schema";
import { CCloudSchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { FormConnectionType } from "../webview/direct-connect-form";
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
}

/** Map of {@link ConnectionId} to {@link CustomConnectionSpec}; only used for `DIRECT` connections. */
export type DirectConnectionsById = Map<ConnectionId, CustomConnectionSpec>;

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
      this.deleteCCloudSchemas(),
      this.deleteCCloudTopics(),
    ]);
  }

  /**
   * Run an async callback which will both read and later mutate workspace storage with exclusive access to a workspace storage key.
   *
   * This strategy prevents concurrent writes to the same workspace storage key, which can lead to data corruption, when multiple
   * asynchronous operations are calling methods which both read and write to the same workspace storage key, namely mutating
   * actions to keys that hold arrays or maps.
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
      await this.storage.setWorkspaceState(storageKey, existingEnvClusters);
    });
  }

  /**
   * Get the available {@link CCloudKafkaCluster}s from extension state.
   * @returns The map of <environmentId (string), {@link CCloudKafkaCluster}[]>
   */
  async getCCloudKafkaClusters(): Promise<CCloudKafkaClustersByEnv> {
    const plainJsonClustersByEnv: CCloudKafkaClustersByEnv =
      (await this.storage.getWorkspaceState(WorkspaceStorageKeys.CCLOUD_KAFKA_CLUSTERS)) ??
      new Map<string, CCloudKafkaCluster[]>();

    // Promote each member in the map to be a true instance of CCloudKafkaCluster
    return new Map(
      Array.from(plainJsonClustersByEnv).map(([envId, clusters]) => [
        envId,
        clusters.map((cluster) => CCloudKafkaCluster.create(cluster)),
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
      await this.storage.setWorkspaceState(storageKey, clusters);
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
      clustersByEnv,
    );
  }

  /**
   * Get the available {@link CCloudSchemaRegistry}s from extension state.
   * @returns The map of <environmentId (string), {@link CCloudSchemaRegistry}>
   */
  async getCCloudSchemaRegistries(): Promise<CCloudSchemaRegistryByEnv> {
    const clustersByEnvPlainJSON: CCloudSchemaRegistryByEnv | undefined =
      await this.storage.getWorkspaceState(WorkspaceStorageKeys.CCLOUD_SCHEMA_REGISTRIES);

    if (clustersByEnvPlainJSON) {
      // Promote each member to be an instance of SchemaRegistry
      return new Map(
        Array.from(clustersByEnvPlainJSON).map(([envId, cluster]) => [
          envId,
          CCloudSchemaRegistry.create(cluster),
        ]),
      );
    } else {
      return new Map<string, CCloudSchemaRegistry>();
    }
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
      await this.storage.setWorkspaceState(storageKey, schemaRegistriesByEnv);
    });
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
      // Fetch the proper map from storage, or create a new one if none exists.
      const topicsByCluster =
        (await this.storage.getWorkspaceState<TopicsByKafkaCluster>(key)) ||
        new Map<string, KafkaTopic[]>();

      // Set the new topics for the cluster
      topicsByCluster.set(cluster.id, topics);

      // Now save the updated cluster topics into the proper key'd storage.
      await this.storage.setWorkspaceState(key, topicsByCluster);
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

    // Fetch the proper map from storage.
    const topicsByCluster: TopicsByKafkaCluster | undefined =
      await this.storage.getWorkspaceState<TopicsByKafkaCluster>(key);

    if (topicsByCluster === undefined) {
      return undefined;
    }

    // Will either be undefined or an array of plain json objects since
    // just deserialized from storage.
    const vanillaJSONTopics = topicsByCluster.get(cluster.id);

    if (vanillaJSONTopics === undefined) {
      return undefined;
    }

    // Promote each member to be an instance of KafkaTopic, return.
    // (Empty list will be returned as is, indicating that we know there are
    //  no topics in this cluster.)
    return vanillaJSONTopics.map((topic) => KafkaTopic.create(topic));
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

  /** Return the use-with-storage StateKafkaTopics key for this type of cluster.
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

  // SCHEMAS

  /**
   * (Re)assign the list of schemas associated with a Schema Registry.
   */
  async setSchemasForRegistry(schemaRegistryId: string, schemas: Schema[]): Promise<void> {
    // Ensure that all schemas have the expected schema registry ID.
    if (schemas.some((schema) => schema.schemaRegistryId !== schemaRegistryId)) {
      logger.warn("Schema registry ID mismatch in schemas", schemaRegistryId, schemas);
      throw new Error("Schema registry ID mismatch in schemas");
    }

    const workspaceKey = WorkspaceStorageKeys.CCLOUD_SCHEMAS;
    await this.runWithMutex(workspaceKey, async () => {
      const existingSchemasBySchemaRegistry: CCloudSchemaBySchemaRegistry =
        await this.getSchemaMap();

      // wholly reassign the list of schemas for this Schema Registry.
      existingSchemasBySchemaRegistry.set(schemaRegistryId, schemas);

      // And repersist.
      await this.storage.setWorkspaceState(workspaceKey, existingSchemasBySchemaRegistry);
    });
  }

  /**
   * Get the available {@link Schema}s for a specific {@link CCloudSchemaRegistry} from extension state.
   * @param schemaRegistryId The ID of the Schema Registry for which to get schemas
   * @returns The list of {@link Schema}s for the specified Schema Registry, or undefined if we do not have this Schema Registry currently cached.
   */
  async getSchemasForRegistry(schemaRegistryId: string): Promise<Schema[] | undefined> {
    // Will have already promoted the from-JSON objects to instances of Schema.
    const schemasBySchemaRegistry = await this.getSchemaMap();
    const schemasFromStorage = schemasBySchemaRegistry.get(schemaRegistryId);
    if (schemasFromStorage === undefined) {
      return undefined;
    }
    // Promote each plain-json member to be an instance of Schema, return.
    return schemasFromStorage.map((schema) => Schema.create(schema));
  }

  /**
   * Get the available {@link Schema}s from extension state, in the form of a map of <clusterId, Schema[]>
   * The Schema[] values will be the plain from-json spelling of the schemas.
   * @returns The map of <clusterId (string), {@link Schema}[]>
   */
  private async getSchemaMap(): Promise<CCloudSchemaBySchemaRegistry> {
    const schemaObjectsBySchemaRegistry: CCloudSchemaBySchemaRegistry | undefined =
      await this.storage.getWorkspaceState(WorkspaceStorageKeys.CCLOUD_SCHEMAS);
    if (schemaObjectsBySchemaRegistry === undefined) {
      return new Map<string, Schema[]>();
    }
    return schemaObjectsBySchemaRegistry;
  }

  /** Forget about all of the CCLoud schemas. */
  private async deleteCCloudSchemas(): Promise<void> {
    return await this.storage.deleteWorkspaceState(WorkspaceStorageKeys.CCLOUD_SCHEMAS);
  }

  // AUTH PROVIDER

  /**
   * Set the secret key to indicate that the CCloud auth flow has completed successfully.
   */
  async setAuthFlowCompleted(success: boolean): Promise<void> {
    await this.storage.setSecret(SecretStorageKeys.AUTH_COMPLETED, String(success));
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

  /** Store the latest CCloud auth status from the sidecar, controlled by the auth poller. */
  async setCCloudAuthStatus(status: Status): Promise<void> {
    await this.storage.setSecret(SecretStorageKeys.CCLOUD_AUTH_STATUS, String(status));
  }

  /** Get the latest CCloud auth status from the sidecar, controlled by the auth poller. */
  async getCCloudAuthStatus(): Promise<string | undefined> {
    return await this.storage.getSecret(SecretStorageKeys.CCLOUD_AUTH_STATUS);
  }

  // Scratch storage for relating key/values to URIs, for files or otherwise.

  /** Wholly reset this URI's extension metadata. Rewrites, does not merge.
   * Should only be used when having just created a new file and needing to
   * set multiple metadata values at once.
   *
   * See {@link mergeURIMetadata} for when needing to further annotate a possibly preexisting URI.
   */
  async setURIMetadata(uri: Uri, metadata: UriMetadata): Promise<void> {
    const storageKey = WorkspaceStorageKeys.URI_METADATA;
    await this.runWithMutex(storageKey, async () => {
      const allMetadata =
        (await this.storage.getWorkspaceState<AllUriMetadata>(storageKey)) ??
        new Map<string, UriMetadata>();

      allMetadata.set(uri.toString(), metadata);

      await this.storage.setWorkspaceState(storageKey, allMetadata);
    });
  }

  /** Merge new values into any preexisting extension URI metadata. Use when needing to further
   * annotate a possibly preexisting URI.
   *
   * @returns The new metadata for the URI after the merge.
   */
  async mergeURIMetadata(uri: Uri, metadata: UriMetadata): Promise<UriMetadata> {
    return await this.runWithMutex(WorkspaceStorageKeys.URI_METADATA, async () => {
      const allMetadata =
        (await this.storage.getWorkspaceState<AllUriMetadata>(WorkspaceStorageKeys.URI_METADATA)) ??
        new Map<string, UriMetadata>();

      const existingMetadata =
        allMetadata.get(uri.toString()) ?? new Map<UriMetadataKeys, string>();

      for (const [key, value] of metadata) {
        existingMetadata.set(key, value);
      }

      allMetadata.set(uri.toString(), existingMetadata);

      await this.storage.setWorkspaceState(WorkspaceStorageKeys.URI_METADATA, allMetadata);

      return existingMetadata;
    });
  }

  /**
   * Merge a single new URI metadata value into preexisting metadata. See {@link mergeURIMetadata}
   *
   * @returns The new complete set of metadata for the URI after the merge.
   */
  async mergeURIMetadataValue(uri: Uri, key: UriMetadataKeys, value: string): Promise<UriMetadata> {
    const metadata = new Map<UriMetadataKeys, string>();
    metadata.set(key, value);
    return await this.mergeURIMetadata(uri, metadata);
  }

  /** Get all of the extension metadata annotations for the given URI. */
  async getUriMetadata(uri: Uri): Promise<UriMetadata | undefined> {
    const allMetadata =
      (await this.storage.getWorkspaceState<AllUriMetadata>(WorkspaceStorageKeys.URI_METADATA)) ??
      new Map<string, UriMetadata>();

    return allMetadata.get(uri.toString());
  }
  /** Get a single extension metadata value for a URI. Use when a codepath will only be
   * interested in this single value. See {@link getUriMetadata} for when needing many values.
   */
  async getUriMetadataValue(uri: Uri, key: UriMetadataKeys): Promise<string | undefined> {
    const metadata = await this.getUriMetadata(uri);
    return metadata?.get(key);
  }

  /** Clear one or more metadata values from a URI.
   * @returns The new metadata for the URI after the clear(s), or undefined if the URI has no metadata remaining.
   */
  async clearURIMetadataValues(
    uri: Uri,
    ...keys: UriMetadataKeys[]
  ): Promise<UriMetadata | undefined> {
    return await this.runWithMutex(WorkspaceStorageKeys.URI_METADATA, async () => {
      const allMetadata =
        (await this.storage.getWorkspaceState<AllUriMetadata>(WorkspaceStorageKeys.URI_METADATA)) ??
        new Map<string, UriMetadata>();

      let existingMetadata = allMetadata.get(uri.toString());
      if (existingMetadata === undefined) {
        return undefined;
      }

      for (const key of keys) {
        existingMetadata.delete(key);
      }

      if (existingMetadata.size === 0) {
        // all gone, remove the whole entry. Future calls
        // to getUriMetadata() will return undefined.
        allMetadata.delete(uri.toString());
        existingMetadata = undefined;
      } else {
        allMetadata.set(uri.toString(), existingMetadata);
      }

      await this.storage.setWorkspaceState(WorkspaceStorageKeys.URI_METADATA, allMetadata);

      return existingMetadata;
    });
  }

  /** Forget all extension metadata for a URI. Useful if knowing that the URI was just destroyed. */
  async deleteURIMetadata(uri: Uri): Promise<void> {
    await this.runWithMutex(WorkspaceStorageKeys.URI_METADATA, async () => {
      const allMetadata =
        (await this.storage.getWorkspaceState<AllUriMetadata>(WorkspaceStorageKeys.URI_METADATA)) ??
        new Map<string, UriMetadata>();

      allMetadata.delete(uri.toString());

      await this.storage.setWorkspaceState(WorkspaceStorageKeys.URI_METADATA, allMetadata);
    });
  }

  // DIRECT CONNECTIONS - entirely handled through SecretStorage

  /** Look up the {@link ConnectionId}:{@link ConnectionSpec} map for any existing `DIRECT` connections. */
  async getDirectConnections(): Promise<DirectConnectionsById> {
    const connectionsString: string | undefined = await this.storage.getSecret(
      SecretStorageKeys.DIRECT_CONNECTIONS,
    );
    if (!connectionsString) {
      return new Map<ConnectionId, CustomConnectionSpec>();
    }
    const connections: Map<ConnectionId, CustomConnectionSpec> = JSON.parse(connectionsString);
    const connectionsById: DirectConnectionsById = new Map(
      Object.entries(connections),
    ) as DirectConnectionsById;
    return connectionsById;
  }

  async getDirectConnection(id: ConnectionId): Promise<CustomConnectionSpec | null> {
    const connections: DirectConnectionsById = await this.getDirectConnections();
    return connections.get(id) ?? null;
  }

  /**
   * Add a direct connection to the extension state by looking up the existing
   * {@link DirectConnectionsById} map and adding/overwriting the `connection` by its `id`.
   */
  async addDirectConnection(connection: CustomConnectionSpec): Promise<void> {
    const key = SecretStorageKeys.DIRECT_CONNECTIONS;
    return await this.runWithMutex(key, async () => {
      const connectionIds: DirectConnectionsById = await this.getDirectConnections();
      connectionIds.set(connection.id! as ConnectionId, connection);
      await this.storage.setSecret(key, JSON.stringify(Object.fromEntries(connectionIds)));
    });
  }

  async deleteDirectConnection(id: ConnectionId): Promise<void> {
    const key = SecretStorageKeys.DIRECT_CONNECTIONS;
    return await this.runWithMutex(key, async () => {
      const connections: DirectConnectionsById = await this.getDirectConnections();
      connections.delete(id);
      await this.storage.setSecret(key, JSON.stringify(Object.fromEntries(connections)));
    });
  }

  async deleteDirectConnections(): Promise<void> {
    await this.storage.deleteSecret(SecretStorageKeys.DIRECT_CONNECTIONS);
  }
}

/**
 * Get the ResourceManager singleton instance.
 * @returns The ResourceManager singleton instance
 */
export function getResourceManager(): ResourceManager {
  return ResourceManager.getInstance();
}
