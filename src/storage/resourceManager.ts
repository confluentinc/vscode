import { StorageManager, getStorageManager } from ".";
import { Status } from "../clients/sidecar";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import { Schema } from "../models/schema";
import { CCloudSchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import {
  AUTH_COMPLETED_KEY,
  CCLOUD_AUTH_STATUS_KEY,
  StateEnvironments,
  StateKafkaClusters,
  StateKafkaTopics,
  StateSchemaRegistry,
  StateSchemas,
} from "./constants";

const logger = new Logger("storage.resourceManager");

/** Type for storing {@link CCloudKafkaCluster}s in extension state, where the parent {@link CCloudEnvironment} ID is the key. */
export type CCloudKafkaClustersByEnv = Map<string, CCloudKafkaCluster[]>;

/** Type for storing {@link KafkaTopic}s in extension state, where the parent {@link KafkaCluster} ID is the key. */
export type TopicsByKafkaCluster = Map<string, KafkaTopic[]>;

/**
 * Type for storing {@link CCloudSchemaRegistry}s in extension state, where the parent {@link CCloudEnvironment} ID is the key.
 * @remarks If we ever have to deal with situations where multiple Schema Registries are
 * available under a single parent resource, this type will either need to be updated or a new type
 * will need to be created. For now, we're leaning into the fact that CCloud environments only have
 * one Schema Registry apiece.
 */
export type CCloudSchemaRegistryByEnv = Map<string, CCloudSchemaRegistry>;

/** Type for storing {@link Schema}s in extension state, where the parent {@link CCloudSchemaRegistry} ID is the key. */
export type CCloudSchemaBySchemaRegistry = Map<string, Schema[]>;

/**
 * Singleton helper for interacting with Confluent-/Kafka-specific global/workspace state items and secrets.
 */
export class ResourceManager {
  static instance: ResourceManager | null = null;
  private constructor(private storage: StorageManager) {}

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

  // TODO(shoup): Add method for deleting all local resources once connection tracking is implemented.

  // ENVIRONMENTS

  /**
   * Set the list of available CCloud environments in extension state.
   */
  async setCCloudEnvironments(environments: CCloudEnvironment[]): Promise<void> {
    await this.storage.setWorkspaceState(StateEnvironments.CCLOUD, environments);
  }

  /**
   * Get the list of available CCloud environments from extension state.
   * @returns The list of CCloud environments
   */
  async getCCloudEnvironments(): Promise<CCloudEnvironment[]> {
    // Will be deserialized plain JSON objects, not instances of CCloudEnvironment.
    const plain_json_environments: CCloudEnvironment[] =
      (await this.storage.getWorkspaceState<CCloudEnvironment[]>(StateEnvironments.CCLOUD)) ?? [];

    // Promote each member to be an instance of CCloudEnvironment
    return plain_json_environments.map((env) => CCloudEnvironment.create(env));
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
    await this.storage.deleteWorkspaceState(StateEnvironments.CCLOUD);
  }

  // KAFKA CLUSTERS

  /**
   * Convert an array of available (CCloud) Kafka clusters and store as a {@link CCloudKafkaClustersByEnv}
   * in extension state.
   * @param clusters The array of {@link CCloudKafkaCluster}s to store
   */
  async setCCloudKafkaClusters(clusters: CCloudKafkaCluster[]): Promise<void> {
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
    await this.storage.setWorkspaceState(StateKafkaClusters.CCLOUD, existingEnvClusters);
  }

  /**
   * Get the available {@link CCloudKafkaCluster}s from extension state.
   * @returns The map of <environmentId (string), {@link CCloudKafkaCluster}[]>
   */
  async getCCloudKafkaClusters(): Promise<CCloudKafkaClustersByEnv> {
    const plainJsonClustersByEnv: CCloudKafkaClustersByEnv =
      (await this.storage.getWorkspaceState(StateKafkaClusters.CCLOUD)) ??
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
    if (!environment) {
      return await this.storage.deleteWorkspaceState(StateKafkaClusters.CCLOUD);
    }
    const clusters = await this.getCCloudKafkaClusters();
    clusters.delete(environment);
    await this.storage.setWorkspaceState(StateKafkaClusters.CCLOUD, clusters);
  }

  /**
   * Set the list of available local Kafka clusters in extension state.
   * @param clusters The list of local Kafka clusters to set
   */
  async setLocalKafkaClusters(clusters: LocalKafkaCluster[]): Promise<void> {
    await this.storage.setWorkspaceState(StateKafkaClusters.LOCAL, clusters);
  }

  /**
   * Get the list of available local Kafka clusters from extension state.
   * @returns The list of local Kafka clusters
   */
  async getLocalKafkaClusters(): Promise<LocalKafkaCluster[]> {
    const plainJsonLocalClusters =
      (await this.storage.getWorkspaceState<LocalKafkaCluster[]>(StateKafkaClusters.LOCAL)) ?? [];

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
    await this.storage.deleteWorkspaceState(StateKafkaClusters.LOCAL);
  }

  /** Get the cluster for this topic. May return either a ccloud or local cluster */
  async getClusterForTopic(topic: KafkaTopic): Promise<KafkaCluster | null> {
    if (topic.isLocalTopic()) {
      return this.getLocalKafkaCluster(topic.clusterId);
    } else {
      return this.getCCloudKafkaCluster(topic.environmentId!, topic.clusterId);
    }
  }

  // SCHEMA REGISTRY

  /** Cache all of the CCloud schema registries at once. */
  async setCCloudSchemaRegistries(clusters: CCloudSchemaRegistry[]): Promise<void> {
    const clustersByEnv: CCloudSchemaRegistryByEnv = new Map();
    clusters.forEach((cluster) => {
      clustersByEnv.set(cluster.environmentId, cluster);
    });
    await this.storage.setWorkspaceState(StateSchemaRegistry.CCLOUD, clustersByEnv);
  }

  /**
   * Get the available {@link CCloudSchemaRegistry}s from extension state.
   * @returns The map of <environmentId (string), {@link CCloudSchemaRegistry}>
   */
  async getCCloudSchemaRegistries(): Promise<CCloudSchemaRegistryByEnv> {
    const clustersByEnvPlainJSON: CCloudSchemaRegistryByEnv | undefined =
      await this.storage.getWorkspaceState(StateSchemaRegistry.CCLOUD);

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
    if (!environment) {
      return await this.storage.deleteWorkspaceState(StateSchemaRegistry.CCLOUD);
    }
    const schemaRegistriesByEnv = await this.getCCloudSchemaRegistries();
    schemaRegistriesByEnv.delete(environment);
    await this.storage.setWorkspaceState(StateSchemaRegistry.CCLOUD, schemaRegistriesByEnv);
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

    // Fetch the proper map from storage, or create a new one if none exists.
    const topicsByCluster =
      (await this.storage.getWorkspaceState<TopicsByKafkaCluster>(key)) ||
      new Map<string, KafkaTopic[]>();

    // Set the new topics for the cluster
    topicsByCluster.set(cluster.id, topics);

    // Now save the updated cluster topics into the proper key'd storage.
    await this.storage.setWorkspaceState(key, topicsByCluster);
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
    return await this.storage.deleteWorkspaceState(StateKafkaTopics.CCLOUD);
  }

  /** Return the use-with-storage StateKafkaTopics key for this type of cluster.
   *
   * (not private only for testing)
   */
  topicKeyForCluster(cluster: KafkaCluster): StateKafkaTopics {
    if (cluster instanceof CCloudKafkaCluster) {
      return StateKafkaTopics.CCLOUD;
    } else if (cluster instanceof LocalKafkaCluster) {
      return StateKafkaTopics.LOCAL;
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

    const existingSchemasBySchemaRegistry: CCloudSchemaBySchemaRegistry = await this.getSchemaMap();

    // wholly reassign the list of schemas for this Schema Registry.
    existingSchemasBySchemaRegistry.set(schemaRegistryId, schemas);

    // And repersist.
    await this.storage.setWorkspaceState(StateSchemas.CCLOUD, existingSchemasBySchemaRegistry);
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
      await this.storage.getWorkspaceState(StateSchemas.CCLOUD);
    if (schemaObjectsBySchemaRegistry === undefined) {
      return new Map<string, Schema[]>();
    }
    return schemaObjectsBySchemaRegistry;
  }

  /** Forget about all of the CCLoud schemas. */
  private async deleteCCloudSchemas(): Promise<void> {
    return await this.storage.deleteWorkspaceState(StateSchemas.CCLOUD);
  }

  // AUTH PROVIDER

  /**
   * Set the secret key to indicate that the CCloud auth flow has completed successfully.
   */
  async setAuthFlowCompleted(success: boolean): Promise<void> {
    await this.storage.setSecret(AUTH_COMPLETED_KEY, String(success));
  }

  /**
   * Get the secret key that indicates whether the CCloud auth flow has completed successfully.
   * @returns `true` if the auth flow completed successfully; `false` otherwise
   */
  async getAuthFlowCompleted(): Promise<boolean> {
    const success: string | undefined = await this.storage.getSecret(AUTH_COMPLETED_KEY);
    return success === "true";
  }

  /** Store the latest CCloud auth status from the sidecar, controlled by the auth poller. */
  async setCCloudAuthStatus(status: Status): Promise<void> {
    await this.storage.setSecret(CCLOUD_AUTH_STATUS_KEY, String(status));
  }

  /** Get the latest CCloud auth status from the sidecar, controlled by the auth poller. */
  async getCCloudAuthStatus(): Promise<string | undefined> {
    return await this.storage.getSecret(CCLOUD_AUTH_STATUS_KEY);
  }
}

/**
 * Get the ResourceManager singleton instance.
 * @returns The ResourceManager singleton instance
 */
export function getResourceManager(): ResourceManager {
  return ResourceManager.getInstance();
}
