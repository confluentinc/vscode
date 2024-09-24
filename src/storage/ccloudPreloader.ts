import { get } from "node:http";
import { Schema as ResponseSchema, SchemasV1Api } from "../clients/schemaRegistryRest";
import { ccloudConnected } from "../emitters";
import { getEnvironments } from "../graphql/environments";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { Schema, SchemaType } from "../models/schema";
import { SchemaRegistryCluster } from "../models/schemaRegistry";
import { getSidecar, SidecarHandle } from "../sidecar";
import { getResourceManager } from "./resourceManager";

const logger = new Logger("storage.ccloudPreloader");
/**
 * Singleton class responsible for preloading Confluent Cloud resources into the resource manager.
 * View providers and/or other consumers of CCloud resources stored in the resource manager should
 * call {@link ensureCoarseResourcesLoaded} to ensure that the resources are cached before attempting to
 * access them from the resource manager.
 *
 * The preloader handles loading the following "coarse" resources via ${link ensureCoarseResourcesLoaded}:
 *  - CCloud Environments (ResourceManager.getCCloudEnvironments())
 *  - CCloud Kafka Clusters (ResourceManager.getCCloudKafkaClusters())
 *  - CCloud Schema Registries (ResourceManager.getCCloudSchemaRegistryClusters())
 *
 * Also handles loading the schemas for a single schema registry cluster via {@link ensureSchemasLoaded}, but
 * only after when the coarse resources have been loaded. Because there may be "many" schemas in a schema registry,
 * this is considered a 'fine grained resource' and is not loaded until requested.
 */
export class CCloudResourcePreloader {
  private static instance: CCloudResourcePreloader | null = null;

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
  private schemaRegistryClusterCacheStates: Map<string, boolean | Promise<void>> = new Map();

  public static getInstance(): CCloudResourcePreloader {
    if (!CCloudResourcePreloader.instance) {
      CCloudResourcePreloader.instance = new CCloudResourcePreloader();
    }
    return CCloudResourcePreloader.instance;
  }

  private constructor() {
    // When the ccloud connection state changes, reset the preloader's state.
    ccloudConnected.event(async (connected: boolean) => {
      this.coarseLoadingComplete = false;
      this.currentlyCoarseLoadingPromise = null;
      this.schemaRegistryClusterCacheStates.clear();

      if (connected) {
        // Start the coarse preloading process if we think we have a ccloud connection.
        await this.ensureCoarseResourcesLoaded();
      }
    });
  }

  /**
   * Promise ensuring that the "coarse" ccloud resources are cached into the resource manager.
   *
   * Fired off when CCloud edges to connected, and/or when any view controller needs to get at
   * any of the following CCloud resources stored in ResourceManager. Is safe to call multiple times
   * in a ccloud session, as it will only fetch the resources once. Concurrent calls while the resources
   * are being fetched will await the same promise. Subsequent calls after completion will return
   * immediately.
   *
   * Currently, when the CCloud connection / authentication session is closed/ended, the resources
   * are left in the resource manager, however the preloader will reset its state to not having fetched
   * the resources, so that the next call to ensureResourcesLoaded() will re-fetch the resources.
   *
   * Coarse resources are:
   *   - CCloud Environments (ResourceManager.getCCloudEnvironments())
   *   - CCloud Kafka Clusters (ResourceManager.getCCloudKafkaClusters())
   *   - CCloud Schema Registries (ResourceManager.getCCloudSchemaRegistryClusters())
   *
   * They do not include topics within a cluster or schemas within a schema registry, which are fetched
   * and cached more closely to when they are needed.
   */
  public async ensureCoarseResourcesLoaded(forceDeepRefresh: boolean = false): Promise<void> {
    // If caller requested a deep refresh, reset the preloader's state so that we fall through to
    // re-fetching the coarse resources.
    if (forceDeepRefresh) {
      logger.info("Deep refreshing CCloud resources, forgetting all ccloud cached resources.");
      this.coarseLoadingComplete = false;
      this.currentlyCoarseLoadingPromise = null;
      // Also implies forgetting any cached schemas so that they will be re-fetched upon demand.
      this.schemaRegistryClusterCacheStates.clear();
      getResourceManager().deleteCCloudResources();
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
   */
  private async doLoadCoarseResources(): Promise<void> {
    // Start loading the ccloud-related resources from sidecar API into the resource manager for local caching.
    // If the loading fails at any time (including, say, the user logs out of CCloud while in progress), then
    // an exception will be thrown and the loadingComplete flag will remain false.
    try {
      const resourceManager = getResourceManager();

      // Fetch the from-sidecar-API list of triplets of (environment, kafkaClusters, schemaRegistry)
      const envGroups = await getEnvironments();

      // Queue up to store the environments in the resource manager
      const environments = envGroups.map((envGroup) => envGroup.environment);
      await resourceManager.setCCloudEnvironments(environments);

      // Collect all of the Kafka clusters into a single array and queue up to store them in the resource manager.
      // (Each environment may have many clusters.)
      const kafkaClusters = envGroups.flatMap((envGroup) => envGroup.kafkaClusters);
      await resourceManager.setCCloudKafkaClusters(kafkaClusters);

      // Likewise the schema registries, but filter out any undefineds for environments that don't have one.
      const schemaRegistries: SchemaRegistryCluster[] = envGroups
        .map((envGroup) => envGroup.schemaRegistry)
        .filter(
          (schemaRegistry): schemaRegistry is SchemaRegistryCluster => schemaRegistry !== undefined,
        );

      await resourceManager.setCCloudSchemaRegistryClusters(schemaRegistries);

      // Mark each schema registry as existing, but schemas not yet loaded.
      this.schemaRegistryClusterCacheStates.clear();
      schemaRegistries.forEach((schemaRegistry) => {
        this.schemaRegistryClusterCacheStates.set(schemaRegistry.id, false);
      });

      // TODO: add flink compute pools here?

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

  /** Ensure that this single schema registry cluster's schemas have been loaded. */
  public async ensureSchemasLoaded(
    schemaRegistryClusterId: string,
    forceDeepRefresh: boolean = false,
  ): Promise<void> {
    if (forceDeepRefresh) {
      // If the caller wants to force a deep refresh, then reset this cluster's state to not having
      // fetched the schemas yet, so that we'll ignore any prior cached schemas and fetch them anew.
      this.schemaRegistryClusterCacheStates.set(schemaRegistryClusterId, false);
    }

    const schemaClusterCacheState =
      this.schemaRegistryClusterCacheStates.get(schemaRegistryClusterId);

    // Ensure is a valid schema registry cluster id. See doLoadResources() for initial setting
    // of these keys.
    if (schemaClusterCacheState === undefined) {
      throw new Error(
        `Schema registry cluster with id ${schemaRegistryClusterId} is unknown to the preloader.`,
      );
    }

    // If schemas for this cluster are already loaded, nothing to wait on.
    if (schemaClusterCacheState === true) {
      return;
    }

    // If in progress of loading, have the caller await the promise that is currently loading the schemas.
    if (schemaClusterCacheState instanceof Promise) {
      return schemaClusterCacheState;
    }

    // This caller is the first to request the preload of the schemas in this registry,
    // so do the work in the foreground, but also store the promise so that any other
    // concurrent callers can await it.
    const schemaLoadingPromise = this.doLoadSchemas(schemaRegistryClusterId);
    this.schemaRegistryClusterCacheStates.set(schemaRegistryClusterId, schemaLoadingPromise);
    await schemaLoadingPromise;
  }

  /** Load the schemas for this single schema registry cluster into the resource manager. */
  private async doLoadSchemas(schemaRegistryClusterId: string): Promise<void> {
    try {
      logger.info("Deep loading schemas for schema registry cluster", { schemaRegistryClusterId });
      const rm = getResourceManager();
      // Need to fetch the schema registry cluster to get the environment.
      const schemaRegistry = await rm.getCCloudSchemaRegistryClusterById(schemaRegistryClusterId);

      if (!schemaRegistry) {
        throw new Error(
          `Schema registry cluster with id ${schemaRegistryClusterId} is unknown to the resource manager.`,
        );
      }

      const environment = await rm.getCCloudEnvironment(schemaRegistry.environmentId);
      if (!environment) {
        throw new Error(
          `Environment with id ${schemaRegistry.environmentId} is unknown to the resource manager.`,
        );
      }

      // Fetch from sidecar API and store into resource manager.
      const schemas = await fetchSchemas(environment, schemaRegistry.id);
      await rm.setSchemasForRegistry(schemaRegistry.id, schemas);

      // Mark this cluster as having its schemas loaded.
      this.schemaRegistryClusterCacheStates.set(schemaRegistryClusterId, true);
    } catch (error) {
      // Perhaps the user logged out of CCloud while the preloading was in progress, or some other API-level error.
      logger.error("Error while preloading CCloud schemas", { error });

      // Forget the current promise, make next call to ensureSchemasLoaded() start from scratch.
      this.schemaRegistryClusterCacheStates.set(schemaRegistryClusterId, false);

      throw error;
    }
  }
}

/**
 * Deep read and return of all schemas in a ccloud environment + schema registry cluster. Does not store into the resource manager.
 * @param sidecar Sidecar handle to use for the fetch.
 * @param environment The CCloud environment to fetch schemas from.
 * @param schemaRegistryClusterId The schema registry cluster ID to fetch schemas from (within the environment).
 * @returns An array of all the schemas in the environment's schema registry cluster.
 */
export async function fetchSchemas(
  environment: CCloudEnvironment,
  schemaRegistryClusterId: string,
): Promise<Schema[]> {
  const sidecar = await getSidecar();

  const client: SchemasV1Api = sidecar.getSchemasV1Api(
    schemaRegistryClusterId,
    environment.connectionId,
  );
  const schemaListRespData: ResponseSchema[] = await client.getSchemas();
  const schemas: Schema[] = schemaListRespData.map((schema: ResponseSchema) => {
    // AVRO doesn't show up in `schemaType`
    // https://docs.confluent.io/platform/current/schema-registry/develop/api.html#get--subjects-(string-%20subject)-versions-(versionId-%20version)
    const schemaType = (schema.schemaType as SchemaType) || SchemaType.Avro;
    // casting `id` from number to string to allow returning Schema types in `.getChildren()` above
    return Schema.create({
      id: schema.id!.toString(),
      subject: schema.subject!,
      version: schema.version!,
      type: schemaType,
      schemaRegistryId: schemaRegistryClusterId,
      environmentId: environment.id,
    });
  });
  return schemas;
}
