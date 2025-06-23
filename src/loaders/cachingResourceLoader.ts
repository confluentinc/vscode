import { TopicData } from "../clients/kafkaRest";
import { Logger } from "../logging";
import { Environment, EnvironmentType } from "../models/environment";
import { KafkaCluster, KafkaClusterType } from "../models/kafkaCluster";
import { EnvironmentId } from "../models/resource";
import { Subject } from "../models/schema";
import { SchemaRegistry, SchemaRegistryType } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { getResourceManager } from "../storage/resourceManager";
import { correlateTopicsWithSchemaSubjects, fetchTopics } from "./loaderUtils";
import { ResourceLoader } from "./resourceLoader";

const logger = new Logger("cachingResourceLoader");

/**
 * Intermediate abstract subclass of ResourceLoader which encapsulates caching of environments,
 * their direct children (Kafka clusters, schema registries), and also kafka topics.
 *
 * This is done outside of the ResourceLoader class itself so that the generic types are
 * encapsulated right at this level, known only to the three concrete subclasses,
 * and not at every mention of ResourceLoader.
 **/
export abstract class CachingResourceLoader<
  ET extends EnvironmentType,
  KCT extends KafkaClusterType,
  SRT extends SchemaRegistryType,
> extends ResourceLoader {
  /** Have the course resources been cached already? */
  private coarseLoadingComplete: boolean = false;

  /** If in progress of loading the coarse resources, the promise doing so. */
  private currentlyCoarseLoadingPromise: Promise<void> | null = null;

  /**
   * Drive the GraphQL query to return all environments for this connection type.
   * Subclasses must implement this method to return the environments
   * from the GraphQL API for the given connection type.
   */
  protected abstract getEnvironmentsFromGraphQL(): Promise<ET[] | undefined>;

  /** Reset to original state, clearing all cached data for this connection. */
  public async reset(): Promise<void> {
    this.coarseLoadingComplete = false;
    this.currentlyCoarseLoadingPromise = null;

    const rm = getResourceManager();
    await rm.purgeConnectionResources(this.connectionId);
  }

  /**
   * Promise ensuring that the "coarse" resources are cached into the resource manager.
   *
   * Fired off when the connection edges to connected, and/or when any view controller needs to get at
   * any of the following resources stored in ResourceManager. Is safe to call multiple times
   * in a connected session, as it will only fetch the resources once. Concurrent calls while the resources
   * are being fetched will await the same promise. Subsequent calls after completion will return
   * immediately.
   *
   * Coarse resources are:
   *   - Environments
   *   - Kafka Clusters
   *   - Schema Registries
   *
   * They do not include topics within a cluster or schemas within a schema registry, which are fetched
   * and cached more closely to when they are needed.
   */
  protected async ensureCoarseResourcesLoaded(forceDeepRefresh: boolean = false): Promise<void> {
    if (forceDeepRefresh) {
      // If caller requested a deep refresh, reset the loader's state so that we fall through to
      // re-fetching the coarse resources.
      logger.debug(`Deep refreshing ${this.connectionType} resources.`);
      await this.reset();
    } else if (this.coarseLoadingComplete) {
      // If the resources are already loaded, nothing to wait on.
      return;
    }

    // If in progress of loading, have the caller await the promise that is currently loading the resources.
    if (this.currentlyCoarseLoadingPromise) {
      return this.currentlyCoarseLoadingPromise;
    }

    // This caller is the first to request the preload, so do the work in the foreground,
    // but also store the promise so that any other concurrent callers can await it.
    this.currentlyCoarseLoadingPromise = this.doLoadCoarseResources();
    await this.currentlyCoarseLoadingPromise;
  }

  /**
   * Load the {@link Environment}s and their direct children (Kafka clusters, schema registry) into
   * the resource manager.
   *
   * Worker function that does the actual loading of the coarse resources:
   *   - Environments (ResourceManager.getEnvironments())
   *   - Kafka Clusters (ResourceManager.getKafkaClusters())
   *   - Schema Registries (ResourceManager.getSchemaRegistries())
   */
  protected async doLoadCoarseResources(): Promise<void> {
    // Start loading the resources for this connection idfrom sidecar API into the resource manager for local caching.
    // If the loading fails at any time (including, say, the user logs out of CCloud while in progress), then
    // an exception will be thrown and the loadingComplete flag will remain false.
    try {
      const resourceManager = getResourceManager();

      // Perform the GraphQL fetch(es)
      const environments = await this.getEnvironmentsFromGraphQL();

      if (!environments) {
        // GraphQL returned undefined, which can happen for Direct connections in rare cases.
        // Already was logged. Short circuit here w/o storing anything in the resource manager.
        // Do _not_ set this.coarseLoadingComplete so that the next call to ensureResourcesLoaded()
        // will re-fetch the coarse resources for this connection.
        logger.warn(`No environments found for connectionId ${this.connectionId}`);
        return;
      }

      // Store the environments, clusters, schema registries in the resource manager ...
      const kafkaClusters: KafkaCluster[] = [];
      const schemaRegistries: SchemaRegistry[] = [];

      environments.forEach((env: Environment) => {
        kafkaClusters.push(...env.kafkaClusters);
        if (env.schemaRegistry) schemaRegistries.push(env.schemaRegistry);
      });

      await Promise.all([
        resourceManager.setEnvironments(this.connectionId, environments),
        resourceManager.setKafkaClusters(this.connectionId, kafkaClusters),
        resourceManager.setSchemaRegistries(this.connectionId, schemaRegistries),
      ]);

      // If made it to this point, all the coarse resources have been fetched and cached and can be trusted.
      this.coarseLoadingComplete = true;
    } catch (error) {
      // Perhaps the user logged out of CCloud while the preloading was in progress, or some other API-level error.
      logger.error(`Error while preloading ${this.connectionId} resources`, { error });
      throw error;
    } finally {
      // Regardless of success or failure, clear the currently loading promise so that the next call to
      // ensureResourcesLoaded() can start again from scratch if needed.
      this.currentlyCoarseLoadingPromise = null;
    }
  }

  /**
   * Fetch the environments accessible from this connection.
   * @param forceDeepRefresh Should we ignore any cached resources and fetch anew?
   * @returns
   */
  public async getEnvironments(forceDeepRefresh: boolean = false): Promise<ET[]> {
    await this.ensureCoarseResourcesLoaded(forceDeepRefresh);
    return await getResourceManager().getEnvironments<ET>(this.connectionId);
  }

  /**
   * Get all of the known schema registries in the accessible environments.
   *
   * Ensures that the coarse resources are loaded before returning the schema registries from
   * the resource manager cache.
   **/
  public async getSchemaRegistries(): Promise<SRT[]> {
    await this.ensureCoarseResourcesLoaded(false);
    return await getResourceManager().getSchemaRegistries<SRT>(this.connectionId);
  }

  /**
   * Get the kafka clusters in the given environment ID.
   */
  public async getKafkaClustersForEnvironmentId(
    environmentId: EnvironmentId,
    forceDeepRefresh?: boolean,
  ): Promise<KCT[]> {
    if (environmentId === undefined) {
      throw new Error("Cannot fetch clusters w/o an environmentId.");
    }

    await this.ensureCoarseResourcesLoaded(forceDeepRefresh);

    return await getResourceManager().getKafkaClustersForEnvironmentId<KCT>(
      this.connectionId,
      environmentId,
    );
  }

  public async getSchemaRegistryForEnvironmentId(
    environmentId: EnvironmentId,
  ): Promise<SRT | undefined> {
    await this.ensureCoarseResourcesLoaded();

    const schemaRegistries = await this.getSchemaRegistries();
    return schemaRegistries.find(
      (schemaRegistry) => schemaRegistry.environmentId === environmentId,
    );
  }

  /**
   * Return the topics present in the Kafka cluster. Will also correlate with schemas
   * in the schema registry for the cluster, if any.
   *
   * Caches the correlated w/schemas topics for the cluster in the resource manager.
   */
  public async getTopicsForCluster(
    cluster: KCT,
    forceDeepRefresh: boolean = false,
  ): Promise<KafkaTopic[]> {
    if (cluster.connectionId !== this.connectionId) {
      throw new Error(
        `Mismatched connectionId ${this.connectionId} for cluster ${JSON.stringify(cluster, null, 2)}`,
      );
    }

    await this.ensureCoarseResourcesLoaded(forceDeepRefresh);

    const resourceManager = getResourceManager();
    let cachedTopics = await resourceManager.getTopicsForCluster(cluster);
    if (cachedTopics !== undefined && !forceDeepRefresh) {
      // Cache hit.
      logger.debug(`Returning ${cachedTopics.length} cached topics for cluster ${cluster.id}`);
      return cachedTopics;
    }

    // Do a deep fetch and schema subject correlation.

    // Deep fetch the topics and schema registry subject names concurrently.
    const [subjects, responseTopics]: [Subject[], TopicData[]] = await Promise.all([
      this.checkedGetSubjects(cluster.environmentId, forceDeepRefresh),
      fetchTopics(cluster),
    ]);

    const topics = correlateTopicsWithSchemaSubjects(cluster, responseTopics, subjects);

    // Cache the correlated topics for this cluster.
    await resourceManager.setTopicsForCluster(cluster, topics);

    return topics;
  }
}
