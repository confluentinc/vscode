import * as vscode from "vscode";

import { Require } from "dataclass";
import { Disposable } from "vscode";
import { toKafkaTopicOperations } from "../authz/types";
import { ResponseError, TopicData, TopicDataList, TopicV3Api } from "../clients/kafkaRest";
import { Schema as ResponseSchema, SchemasV1Api } from "../clients/schemaRegistryRest";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../constants";
import { ccloudConnected } from "../emitters";
import { getEnvironments } from "../graphql/environments";
import { getLocalResources } from "../graphql/local";
import { Logger } from "../logging";
import { CCloudEnvironment, Environment, LocalEnvironment } from "../models/environment";
import { EnvironmentResource } from "../models/interfaces";
import { CCloudKafkaCluster, KafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import { Schema, SchemaType } from "../models/schema";
import {
  CCloudSchemaRegistry,
  LocalSchemaRegistry,
  SchemaRegistry,
} from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { getSidecar } from "../sidecar";
import { getResourceManager } from "./resourceManager";

const logger = new Logger("storage.resourceLoader");

/** Construct the singleton resource loaders so they may register their event listeners. */
export function constructResourceLoaderSingletons(): vscode.Disposable[] {
  CCloudResourceLoader.getInstance();
  LocalResourceLoader.getInstance();

  return ResourceLoader.getDisposables();
}

/** Human readable characterization of the backing technology resources were loaded from */
export enum ResouceLoaderType {
  CCloud = "Confluent Cloud",
  Local = "Local",
}

/**
 * Class family for dealing with loading (and perhaps caching) information
 * about resources (kafka clusters, schema registries, etc). View providers
 * or quickpicks or other consumers of resources should go through this
 * API to make things simple and consistent across CCloud, local, or direct
 * connection clusters.
 */
export abstract class ResourceLoader {
  /**
   * What kind of resources does this loader manage? Human readable string, often
   * used by quickpick separator labels.
   */
  public abstract kind: ResouceLoaderType;

  /** Disposables belonging to all instances of ResourceLoader to be added to the extension
   * context during activation, cleaned up on extension deactivation.
   * TODO: Reconsider when we have less-permanant direct connections also.
   */
  protected static disposables: Disposable[] = [];

  /**  Return all known long lived disposables for extension cleanup. */
  public static getDisposables(): Disposable[] {
    return ResourceLoader.disposables;
  }

  /** Get the ResourceLoader subclass instance corresponding to the given connectionId */
  public static getInstance(connectionId: string): ResourceLoader {
    if (connectionId === CCLOUD_CONNECTION_ID) {
      return CCloudResourceLoader.getInstance();
    } else if (connectionId === LOCAL_CONNECTION_ID) {
      return LocalResourceLoader.getInstance();
    }

    throw new Error(`Unknown connectionId ${connectionId}`);
  }

  // Environment methods

  /**
   * Get the accessible environments from the connection.
   * @param forceDeepRefresh Ignore any previously cached resources and fetch anew?
   */
  public abstract getEnvironments(forceDeepRefresh?: boolean): Promise<Environment[]>;

  // Kafka cluster methods

  /**
   * Get the kafka clusters in the given environment.
   */
  public abstract getKafkaClustersForEnvironment(
    environmentable: EnvironmentResource,
    forceDeepRefresh?: boolean,
  ): Promise<KafkaCluster[]>;

  /**
   * Return the topics present in the cluster. Will also correlate with schemas
   * in the schema registry for the cluster, if any.
   */
  public abstract getTopicsForCluster(
    cluster: KafkaCluster,
    forceDeepRefresh?: boolean,
  ): Promise<KafkaTopic[]>;

  // Schema registry methods

  /**
   * Get all schema registries known to the connection. Optionally accepts an existing SidecarHandle
   * to use if need be if provided.
   */
  public abstract getSchemaRegistries(): Promise<SchemaRegistry[]>;

  /**
   * Return the appropriate schema registry to use, if any, for the given object's environment.
   * @param environmentable The {@link EnvironmentResource} to get the corresponding schema registry for.
   * @returns The {@link SchemaRegistry} for the resource's environment, if any.
   */
  public abstract getSchemaRegistryForEnvironment(
    environmentable: EnvironmentResource,
  ): Promise<SchemaRegistry | undefined>;

  /**
   * Get the possible schemas for an environment's schema registry.
   *
   * @param environmentable The {@link EnvironmentResource} to get the corresponding schema registry's
   * schemas from. Will return empty array if there is no schema registry for the environment,
   * or if said schema registry has no schemas.
   */
  public async getSchemasForEnvironment(
    environmentable: EnvironmentResource,
    forceDeepRefresh: boolean = false,
  ): Promise<Schema[]> {
    const schemaRegistry = await this.getSchemaRegistryForEnvironment(environmentable);
    if (!schemaRegistry) {
      return [];
    }

    return await this.getSchemasForRegistry(schemaRegistry, forceDeepRefresh);
  }

  /**
   * Fetch the schemas from the given schema registry.
   * @param schemaRegistry The schema registry to fetch schemas from.
   * @param forceDeepRefresh If true, will ignore any cached schemas and fetch anew.
   * @returns An array of schemas in the schema registry. Throws an error if the schemas could not be fetched.
   * */
  public abstract getSchemasForRegistry(
    schemaRegistry: SchemaRegistry,
    forceDeepRefresh?: boolean,
  ): Promise<Schema[]>;

  /**
   * Indicate to purge this schema registry's cache of schemas, if the
   * loader implementation caches.
   * This is useful when a schema is known to has been added or removed, but the
   * registry isn't currently being displayed in the view.
   * (So that when it does get displayed, it will fetch the schemas anew).
   */
  public abstract purgeSchemas(schemaRegistryId: string): void;
}

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
  kind = ResouceLoaderType.CCloud;

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
      logger.debug(`Deep refreshing ${this.kind} resources.`);
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
      const schemaRegistries: CCloudSchemaRegistry[] = envGroups
        .map((envGroup) => envGroup.schemaRegistry)
        .filter(
          (schemaRegistry): schemaRegistry is CCloudSchemaRegistry => schemaRegistry !== undefined,
        );

      await resourceManager.setCCloudSchemaRegistries(schemaRegistries);

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
      const environment = await rm.getCCloudEnvironment(ccloudSchemaRegistry.environmentId);
      if (!environment) {
        throw new Error(
          `Environment with id ${ccloudSchemaRegistry.environmentId} is unknown to the resource manager.`,
        );
      }

      // Fetch from sidecar API and store into resource manager.
      const schemas = await fetchSchemas(
        ccloudSchemaRegistry.id,
        environment.connectionId,
        environment.id,
      );
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
   * Get the CCLoud kafka clusters in the given environment.
   */
  public async getKafkaClustersForEnvironment(
    environmentable: EnvironmentResource,
    forceDeepRefresh?: boolean,
  ): Promise<CCloudKafkaCluster[]> {
    if (environmentable.environmentId === undefined) {
      throw new Error(
        `${environmentable} Does not have an environmentId associated with it. Cannot fetch clusters.`,
      );
    }
    await this.ensureCoarseResourcesLoaded(forceDeepRefresh);
    return await getResourceManager().getCCloudKafkaClustersForEnvironment(
      environmentable.environmentId,
    );
  }

  /**
   * Return the topics present in the {@link CCloudKafkaCluster}. Will also correlate with schemas
   * in the schema registry for the cluster, if any.
   */
  public async getTopicsForCluster(
    cluster: CCloudKafkaCluster,
    forceDeepRefresh: boolean = false,
  ): Promise<KafkaTopic[]> {
    if (!cluster.isCCloud) {
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

    // Do a deep fetch, cache the results, then return them.

    // Get the schemas and the topics concurrently. The schemas may either be a cache hit or a deep fetch,
    // but the topics are always a deep fetch.
    const [schemas, responseTopics] = await Promise.all([
      this.getSchemasForEnvironment(cluster, forceDeepRefresh),
      fetchTopics(cluster),
    ]);

    // now correlate the topics with the schemas.
    const topics = correlateTopicsWithSchemas(
      cluster,
      responseTopics as TopicData[],
      schemas as Schema[],
    );

    // Cache the correlated topics for this cluster.
    await resourceManager.setTopicsForCluster(cluster, topics);

    return topics;
  }

  public async getSchemaRegistryForEnvironment(
    environmentable: EnvironmentResource,
  ): Promise<CCloudSchemaRegistry | undefined> {
    await this.ensureCoarseResourcesLoaded();

    const schemaRegistries = await this.getSchemaRegistries();
    return schemaRegistries.find(
      (schemaRegistry) => schemaRegistry.environmentId === environmentable.environmentId,
    );
  }

  public async getSchemasForEnvironment(
    environmentable: EnvironmentResource,
    forceDeepRefresh?: boolean,
  ): Promise<Schema[]> {
    // Guard against programming error. Only resources from ccloud should get this far.
    if (environmentable.environmentId === undefined) {
      throw new Error(
        `${environmentable} Does not have an environmentId associated with it. Cannot fetch schemas.`,
      );
    }

    await this.ensureCoarseResourcesLoaded(forceDeepRefresh);

    const schemaRegistries = await this.getSchemaRegistries();
    const registry = schemaRegistries.find(
      (schemaRegistry) => schemaRegistry.environmentId === environmentable.environmentId,
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

/**
 * ResourceLoader implementation atop the LOCAL "cluster".
 * Does no caching at all. Directly fetches from the local sidecar API
 * each time a resource is requested.
 */
export class LocalResourceLoader extends ResourceLoader {
  kind = ResouceLoaderType.Local;

  private static instance: LocalResourceLoader | null = null;
  public static getInstance(): LocalResourceLoader {
    if (!LocalResourceLoader.instance) {
      LocalResourceLoader.instance = new LocalResourceLoader();
    }
    return LocalResourceLoader.instance;
  }

  // singleton class, get instance via getInstance()
  // (construct only public for testing / signon mocking purposes.)
  constructor() {
    super();
  }

  public async getEnvironments(): Promise<Environment[]> {
    // todo: resolve the impedance mismatch between
    // LocalResourceGroup vs LocalEnvironment. Perhaps have getLocalResources
    // return something closer to an evolved LocalEnvironment?
    const localResourceGroups = await getLocalResources();
    if (localResourceGroups.length === 0) {
      return [];
    } else {
      // respell as a single LocalEnvironment
      return [
        LocalEnvironment.create({
          id: "local",
          name: "Local",
          hasClusters: true,
        }),
      ];
    }
  }

  public async getKafkaClustersForEnvironment(): Promise<LocalKafkaCluster[]> {
    const localGroups = await getLocalResources();
    return localGroups.flatMap((group) => group.kafkaClusters);
  }

  /**
   * Return the topics present in the {@link LocalKafkaCluster}. Will also correlate with schemas
   * in the schema registry for the cluster, if any.
   */
  public async getTopicsForCluster(cluster: LocalKafkaCluster): Promise<KafkaTopic[]> {
    if (!cluster.isLocal) {
      throw new Error(
        `Cluster ${cluster.id} is not a local cluster, yet is passed to LocalResourceLoader.`,
      );
    }

    // Deep fetch the schemas and the topics concurrently.
    const [schemas, responseTopics]: [Schema[], TopicData[]] = await Promise.all([
      this.getSchemasForEnvironment(),
      fetchTopics(cluster),
    ]);

    return correlateTopicsWithSchemas(cluster, responseTopics, schemas);
  }

  public async getSchemaRegistries(): Promise<LocalSchemaRegistry[]> {
    const localGroups = await getLocalResources();

    return localGroups
      .filter((group) => group.schemaRegistry !== undefined)
      .map((group) => group.schemaRegistry!);
  }

  public async getSchemaRegistryForEnvironment(): Promise<LocalSchemaRegistry | undefined> {
    const allRegistries = await this.getSchemaRegistries();
    if (allRegistries.length === 0) {
      return undefined;
    } else {
      // local environment should only have at most one schema registry
      if (allRegistries.length > 1) {
        logger.warn(
          "Local environment has more than one schema registry! Using first one",
          allRegistries.length,
        );
      }
      return allRegistries[0];
    }
  }

  public async getSchemasForEnvironment(): Promise<Schema[]> {
    const schemaRegistries = await this.getSchemaRegistries();
    if (schemaRegistries.length === 0) {
      return [];
    }

    return fetchSchemas(schemaRegistries[0].id, LOCAL_CONNECTION_ID, undefined);
  }

  /**
   * Fetch schemas from local schema registry.
   * Simple, pass through to deep fetch every time.
   */
  public async getSchemasForRegistry(schemaRegistry: SchemaRegistry): Promise<Schema[]> {
    return fetchSchemas(schemaRegistry.id, LOCAL_CONNECTION_ID, undefined);
  }

  /** Purge schemas from this registry from cache.
   * Simple, we don't cache anything in this loader!
   */
  public purgeSchemas(): void {
    // no-op
  }
}

export class TopicFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopicFetchError";
  }
}

/**
 * Deep read and return of all topics in a Kafka cluster.
 */
export async function fetchTopics(cluster: KafkaCluster): Promise<TopicData[]> {
  const sidecar = await getSidecar();
  const client: TopicV3Api = sidecar.getTopicV3Api(cluster.id, cluster.connectionId);
  let topicsResp: TopicDataList;

  try {
    topicsResp = await client.listKafkaTopics({
      cluster_id: cluster.id,
      includeAuthorizedOperations: true,
    });
  } catch (error) {
    if (error instanceof ResponseError) {
      // XXX todo improve this, raise a more specific error type.
      const body = await error.response.json();

      throw new TopicFetchError(JSON.stringify(body));
    } else {
      throw new TopicFetchError(JSON.stringify(error));
    }
  }

  return topicsResp.data;
}

/**
 * Convert an array of {@link TopicData} to an array of {@link KafkaTopic}
 * and set whether or not each topic has a matching schema.
 */
export function correlateTopicsWithSchemas(
  cluster: KafkaCluster,
  topicsRespTopics: TopicData[],
  schemas: Schema[],
): KafkaTopic[] {
  const topics: KafkaTopic[] = topicsRespTopics.map((topic) => {
    const hasMatchingSchema: boolean = schemas.some((schema) =>
      schema.matchesTopicName(topic.topic_name),
    );

    return KafkaTopic.create({
      name: topic.topic_name,
      is_internal: topic.is_internal,
      replication_factor: topic.replication_factor,
      partition_count: topic.partitions_count,
      partitions: topic.partitions,
      configs: topic.configs,
      clusterId: cluster.id,
      environmentId: cluster instanceof CCloudKafkaCluster ? cluster.environmentId : undefined,
      hasSchema: hasMatchingSchema,
      operations: toKafkaTopicOperations(topic.authorized_operations!),
    });
  });

  return topics;
}

/**
 * Deep read and return of all schemas in a CCloud or local environment's Schema Registry.
 * Does not store into the resource manager.
 *
 * @param schemaRegistryId The Schema Registry ID to fetch schemas from (within the environment).
 * @param connectionId The connection ID to use to fetch schemas.
 * @param environmentId Optional: the CCloud environment ID to associate CCloud schemas with.
 * @returns An array of all the schemas in the environment's Schema Registry.
 */
export async function fetchSchemas(
  schemaRegistryId: string,
  connectionId: string,
  environmentId: string | undefined = undefined,
): Promise<Schema[]> {
  const sidecarHandle = await getSidecar();
  const client: SchemasV1Api = sidecarHandle.getSchemasV1Api(schemaRegistryId, connectionId);
  const schemaListRespData: ResponseSchema[] = await client.getSchemas();
  const schemas: Schema[] = schemaListRespData.map((schema: ResponseSchema) => {
    // AVRO doesn't show up in `schemaType`
    // https://docs.confluent.io/platform/current/schema-registry/develop/api.html#get--subjects-(string-%20subject)-versions-(versionId-%20version)
    const schemaType = (schema.schemaType as SchemaType) || SchemaType.Avro;
    // appease typescript because it doesn't want to convert `string | undefined` to `Require<string> | undefined`
    const maybeEnvironmentId = environmentId as Require<string | undefined>;
    // casting `id` from number to string to allow returning Schema types in `.getChildren()` above
    return Schema.create({
      id: schema.id!.toString(),
      subject: schema.subject!,
      version: schema.version!,
      type: schemaType,
      schemaRegistryId: schemaRegistryId,
      environmentId: maybeEnvironmentId,
    });
  });
  return schemas;
}
