import { Disposable } from "vscode";

import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ccloudConnected } from "../emitters";
import { getEnvironments } from "../graphql/environments";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import { isCCloud } from "../models/resource";
import { Schema } from "../models/schema";
import { CCloudSchemaRegistry, SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { fetchSchemas } from "./loaderUtils";
import { ResourceLoader } from "./resourceLoader";
import { getResourceManager } from "./resourceManager";

const logger = new Logger("storage.ccloudResourceLoader");

/**
 * Singleton class responsible for loading / caching CCLoud resources into the resource manager.
 * View providers and/or other consumers of resources stored in the resource manager should
 * call {@link ensureCoarseResourcesLoaded} to ensure that the resources are cached before attempting to
 * access them from the resource manager.
 *
 * Handles loading the following "coarse" resources via ${link ensureCoarseResourcesLoaded}:
 *  - CCloud Environments (ResourceManager.getCCloudEnvironments())
 *  - CCloud Kafka Clusters (ResourceManager.getCCloudKafkaClusters())
 *  - CCloud Schema Registries (ResourceManager.getCCloudSchemaRegistries())
 *
 * Also handles loading the schemas for a single Schema Registry via {@link ensureSchemasLoaded}, but
 * only after when the coarse resources have been loaded. Because there may be "many" schemas in a schema registry,
 * this is considered a 'fine grained resource' and is not loaded until requested.
 */
export class CCloudResourceLoader extends ResourceLoader {
  connectionId = CCLOUD_CONNECTION_ID;
  connectionType = ConnectionType.Ccloud;

  private static instance: CCloudResourceLoader | null = null;

  public static getInstance(): CCloudResourceLoader {
    if (!CCloudResourceLoader.instance) {
      CCloudResourceLoader.instance = new CCloudResourceLoader();
    }
    return CCloudResourceLoader.instance;
  }

  /** Have the course resources been cached already? */
  private coarseLoadingComplete: boolean = false;

  /** If in progress of loading the coarse resources, the promise doing so. */
  private currentlyCoarseLoadingPromise: Promise<void> | null = null;

  /**
   * Known state of resource manager cache for each schema registry's schemas by schema registry id:
   *  * Undefined: unknown schema registry, call {@link ensureSchemasLoaded} to fetch and cache.
   *  * False: known schema registry, but its schemas not yet fetched, call  {@link ensureSchemasLoaded} to fetch and cache.
   *  * True: Fully cached. Go ahead and make use of resourceManager.getCCloudSchemasForCluster(id)
   *  * Promise<void>: in progress of fetching, join awaiting this promise to know when it's safe to use resourceManager.getCCloudSchemasForCluster(id).
   */
  private schemaRegistryCacheStates: Map<string, boolean | Promise<void>> = new Map();

  // Singleton class. Use getInstance() to get the singleton instance.
  // (Only public for testing / signon mocking purposes.)
  constructor() {
    super();

    // When the ccloud connection state changes, reset the loader's state.
    const ccloudConnectedSub: Disposable = ccloudConnected.event(async (connected: boolean) => {
      this.reset();

      if (connected) {
        // Start the coarse preloading process if we think we have a ccloud connection.
        await this.ensureCoarseResourcesLoaded();
      }
    });

    ResourceLoader.disposables.push(ccloudConnectedSub);
  }

  protected deleteCoarseResources(): void {
    getResourceManager().deleteCCloudResources();
  }

  /**
   * Promise ensuring that the "coarse" ccloud resources are cached into the resource manager.
   *
   * Fired off when the connection edges to connected, and/or when any view controller needs to get at
   * any of the following resources stored in ResourceManager. Is safe to call multiple times
   * in a connected session, as it will only fetch the resources once. Concurrent calls while the resources
   * are being fetched will await the same promise. Subsequent calls after completion will return
   * immediately.
   *
   * Currently, when the connection / authentication session is closed/ended, the resources
   * are left in the resource manager, however the loader will reset its state to not having fetched
   * the resources, so that the next call to ensureResourcesLoaded() will re-fetch the resources.
   *
   * Coarse resources are:
   *   - Environments
   *   - Kafka Clusters
   *   - Schema Registries
   *
   * They do not include topics within a cluster or schemas within a schema registry, which are fetched
   * and cached more closely to when they are needed.
   */
  private async ensureCoarseResourcesLoaded(forceDeepRefresh: boolean = false): Promise<void> {
    // TODO make this private, fix all the callers via ensuring there's an adequate
    // ResourceLoader API covering the use case end-user code is directly calling
    // ensureCoarseResourcesLoaded().
    // Issue https://github.com/confluentinc/vscode/issues/568

    // If caller requested a deep refresh, reset the loader's state so that we fall through to
    // re-fetching the coarse resources.
    if (forceDeepRefresh) {
      logger.debug(`Deep refreshing ${this.connectionType} resources.`);
      this.reset();
      this.deleteCoarseResources();
    }

    // If the resources are already loaded, nothing to wait on.
    if (this.coarseLoadingComplete) {
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
   * Load the {@link CCloudEnvironment}s and their direct children (Kafka clusters, schema registry) into
   * the resource manager.
   *
   * Worker function that does the actual loading of the coarse resources:
   *   - Environments (ResourceManager.getCCloudEnvironments())
   *   - Kafka Clusters (ResourceManager.getCCloudKafkaClusters())
   *   - Schema Registries (ResourceManager.getCCloudSchemaRegistries())
   */
  protected async doLoadCoarseResources(): Promise<void> {
    // Start loading the ccloud-related resources from sidecar API into the resource manager for local caching.
    // If the loading fails at any time (including, say, the user logs out of CCloud while in progress), then
    // an exception will be thrown and the loadingComplete flag will remain false.
    try {
      const resourceManager = getResourceManager();

      // Queue up to store the environments in the resource manager
      const environments: CCloudEnvironment[] = await getEnvironments();
      await resourceManager.setCCloudEnvironments(environments);

      // Collect all of the CCloudKafkaCluster and CCloudSchemaRegistries into individual arrays
      // before storing them via the resource manager.
      const kafkaClusters: CCloudKafkaCluster[] = [];
      const schemaRegistries: CCloudSchemaRegistry[] = [];
      environments.forEach((env: CCloudEnvironment) => {
        kafkaClusters.push(...env.kafkaClusters);
        if (env.schemaRegistry) schemaRegistries.push(env.schemaRegistry);
      });
      await Promise.all([
        resourceManager.setCCloudKafkaClusters(kafkaClusters),
        resourceManager.setCCloudSchemaRegistries(schemaRegistries),
      ]);

      // Mark each schema registry as existing, but schemas not yet loaded.
      this.schemaRegistryCacheStates.clear();
      schemaRegistries.forEach((schemaRegistry) => {
        this.schemaRegistryCacheStates.set(schemaRegistry.id, false);
      });

      // If made it to this point, all the coarse resources have been fetched and cached and can be trusted.
      this.coarseLoadingComplete = true;
    } catch (error) {
      // Perhaps the user logged out of CCloud while the preloading was in progress, or some other API-level error.
      logger.error("Error while preloading CCloud resources", { error });
      throw error;
    } finally {
      // Regardless of success or failure, clear the currently loading promise so that the next call to
      // ensureResourcesLoaded() can start again from scratch if needed.
      this.currentlyCoarseLoadingPromise = null;
    }
  }

  protected async doLoadSchemas(schemaRegistry: SchemaRegistry): Promise<void> {
    try {
      logger.debug(`Deep loading schemas for CCloud Schema Registry ${schemaRegistry.id}`);
      const rm = getResourceManager();

      const ccloudSchemaRegistry: CCloudSchemaRegistry = schemaRegistry as CCloudSchemaRegistry;
      const environment: CCloudEnvironment | null = await rm.getCCloudEnvironment(
        ccloudSchemaRegistry.environmentId,
      );
      if (!environment) {
        throw new Error(
          `Environment with id ${ccloudSchemaRegistry.environmentId} is unknown to the resource manager.`,
        );
      }

      // Fetch from sidecar API and store into resource manager.
      const schemas: Schema[] = await fetchSchemas(ccloudSchemaRegistry);
      await rm.setSchemasForRegistry(schemaRegistry.id, schemas);

      // Mark this cluster as having its schemas loaded.
      this.schemaRegistryCacheStates.set(schemaRegistry.id, true);
    } catch (error) {
      // Perhaps the user logged out of CCloud while the preloading was in progress, or some other API-level error.
      logger.error("Error while preloading CCloud schemas", { error });

      // Forget the current promise, make next call to ensureSchemasLoaded() start from scratch.
      this.schemaRegistryCacheStates.set(schemaRegistry.id, false);

      throw error;
    }
  }

  /**
   * Fetch the CCloud environments accessible from the current CCloud auth session.
   * @param forceDeepRefresh Should we ignore any cached resources and fetch anew?
   * @returns
   */
  public async getEnvironments(forceDeepRefresh: boolean = false): Promise<CCloudEnvironment[]> {
    await this.ensureCoarseResourcesLoaded(forceDeepRefresh);
    return await getResourceManager().getCCloudEnvironments();
  }

  /**
   * Get all of the known schema registries in the accessible CCloud environments.
   *
   * Ensures that the coarse resources are loaded before returning the schema registries from
   * the resource manager cache.
   *
   * If there is no CCloud auth session, returns an empty array.
   **/
  public async getSchemaRegistries(): Promise<CCloudSchemaRegistry[]> {
    await this.ensureCoarseResourcesLoaded(false);
    // TODO: redapt this resource manager API to just return the array directly.
    const registryByEnvId = await getResourceManager().getCCloudSchemaRegistries();

    return Array.from(registryByEnvId.values());
  }

  /**
   * Get the CCLoud kafka clusters in the given environment ID.
   */
  public async getKafkaClustersForEnvironmentId(
    environmentId: string,
    forceDeepRefresh?: boolean,
  ): Promise<CCloudKafkaCluster[]> {
    if (environmentId === undefined) {
      throw new Error(`Cannot fetch clusters w/o an environmentId.`);
    }
    await this.ensureCoarseResourcesLoaded(forceDeepRefresh);
    return await getResourceManager().getCCloudKafkaClustersForEnvironment(environmentId);
  }

  /**
   * Return the topics present in the {@link CCloudKafkaCluster}. Will also correlate with schemas
   * in the schema registry for the cluster, if any.
   *
   * Augments the implementation in base class ResourceLoader by handling caching
   * within the resource manager.
   */
  public async getTopicsForCluster(
    cluster: CCloudKafkaCluster,
    forceDeepRefresh: boolean = false,
  ): Promise<KafkaTopic[]> {
    if (!isCCloud(cluster)) {
      // Programming error.
      throw new Error(`Cluster ${cluster.id} is not a CCloud cluster.`);
    }

    await this.ensureCoarseResourcesLoaded(forceDeepRefresh);

    const resourceManager = getResourceManager();
    let cachedTopics = await resourceManager.getTopicsForCluster(cluster);
    if (cachedTopics !== undefined && !forceDeepRefresh) {
      // Cache hit.
      logger.debug(`Returning ${cachedTopics.length} cached topics for cluster ${cluster.id}`);
      return cachedTopics;
    }

    // Do a deep fetch and schema subject correlation via the base implementation.
    const topics: KafkaTopic[] = await super.getTopicsForCluster(cluster);

    // Cache the correlated topics for this cluster.
    await resourceManager.setTopicsForCluster(cluster, topics);

    return topics;
  }

  public async getSchemaRegistryForEnvironmentId(
    environmentId: string,
  ): Promise<CCloudSchemaRegistry | undefined> {
    await this.ensureCoarseResourcesLoaded();

    const schemaRegistries = await this.getSchemaRegistries();
    return schemaRegistries.find(
      (schemaRegistry) => schemaRegistry.environmentId === environmentId,
    );
  }

  public async getSchemasForEnvironmentId(
    environmentId: string,
    forceDeepRefresh?: boolean,
  ): Promise<Schema[]> {
    // Guard against programming error. Only resources from ccloud should get this far.
    if (environmentId === undefined) {
      throw new Error(`Cannot fetch schemas w/o an environmentId.`);
    }

    await this.ensureCoarseResourcesLoaded(forceDeepRefresh);

    const schemaRegistries = await this.getSchemaRegistries();
    const registry = schemaRegistries.find(
      (schemaRegistry) => schemaRegistry.environmentId === environmentId,
    );

    if (!registry) {
      // No schema registry for this topic's environment, so no schemas.
      return [];
    }

    return this.getSchemasForRegistry(registry, forceDeepRefresh);
  }

  public async getSchemasForRegistry(
    schemaRegistry: CCloudSchemaRegistry,
    forceDeepRefresh?: boolean,
  ): Promise<Schema[]> {
    // Ensure coarse resources (envs, clusters, schema registries) are cached.
    // We need to be aware of the schema registry ids before next step will work.
    await this.ensureCoarseResourcesLoaded(forceDeepRefresh);

    // Ensure this schema registry's schemas are cached.
    await this.ensureSchemasLoaded(schemaRegistry, forceDeepRefresh);

    const schemas = await getResourceManager().getSchemasForRegistry(schemaRegistry.id);
    if (!schemas) {
      throw new Error(`Schemas for schema registry ${schemaRegistry.id} are not loaded.`);
    }

    return schemas;
  }

  /**
   * Mark this schema registry cache as stale, such as when known that a schema has been added or removed,
   * but the registry isn't currently being displayed
   */
  public purgeSchemas(schemaRegistryId: string): void {
    this.schemaRegistryCacheStates.set(schemaRegistryId, false);
  }

  /** Ensure that this single Schema Registry's schemas have been loaded. */
  private async ensureSchemasLoaded(
    schemaRegistry: CCloudSchemaRegistry,
    forceDeepRefresh: boolean = false,
  ): Promise<void> {
    if (forceDeepRefresh) {
      // If the caller wants to force a deep refresh, then reset this Schema Registry's state to not having
      // fetched the schemas yet, so that we'll ignore any prior cached schemas and fetch them anew.
      this.schemaRegistryCacheStates.set(schemaRegistry.id, false);
    }

    const schemaRegistryCacheState = this.schemaRegistryCacheStates.get(schemaRegistry.id);

    // Ensure is a valid Schema Registry id. See doLoadResources() for initial setting
    // of these keys.
    if (schemaRegistryCacheState === undefined) {
      throw new Error(`Schema registry with id ${schemaRegistry.id} is unknown to the loader.`);
    }

    // If schemas for this Schema Registry are already loaded, nothing to wait on.
    if (schemaRegistryCacheState === true) {
      return;
    }

    // If in progress of loading, have the caller await the promise that is currently loading the schemas.
    if (schemaRegistryCacheState instanceof Promise) {
      return schemaRegistryCacheState;
    }

    // This caller is the first to request the preload of the schemas in this registry,
    // so do the work in the foreground, but also store the promise so that any other
    // concurrent callers can await it.
    const schemaLoadingPromise = this.doLoadSchemas(schemaRegistry);
    this.schemaRegistryCacheStates.set(schemaRegistry.id, schemaLoadingPromise);
    await schemaLoadingPromise;
  }

  /** Go back to initial state, not having cached anything. */
  private reset(): void {
    this.coarseLoadingComplete = false;
    this.currentlyCoarseLoadingPromise = null;
    this.schemaRegistryCacheStates.clear();
  }
}
