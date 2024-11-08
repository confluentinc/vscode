import * as vscode from "vscode";

import { Require } from "dataclass";
import { Disposable } from "vscode";
import { Schema as ResponseSchema, SchemasV1Api } from "../clients/schemaRegistryRest";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../constants";
import { ccloudConnected, localKafkaConnected } from "../emitters";
import { getEnvironments } from "../graphql/environments";
import { Logger } from "../logging";
import { Schema, SchemaType } from "../models/schema";
import { CCloudSchemaRegistry, SchemaRegistry } from "../models/schemaRegistry";
import { getSidecar } from "../sidecar";
import { getResourceManager } from "./resourceManager";

const logger = new Logger("storage.resourceLoader");

/** Construct the singleton resource loaders so they may register their event listeners. */
export function constructResourceLoaderSingletons(): vscode.Disposable[] {
  CCloudResourceLoader.getInstance();
  LocalResourceLoader.getInstance();

  return ResourceLoader.getDisposables();
}

export abstract class ResourceLoader {
  /** What kind of resources does this loader manage? Human readable string. */
  public abstract kind: string;

  /** Disposables belonging to all instances of ResourceLoader to be added to the extension
   * context during activation, cleaned up on extension deactivation.
   * */
  protected static disposables: Disposable[] = [];

  /**  Return all known long lived disposables for extension cleanup. */
  public static getDisposables(): Disposable[] {
    return ResourceLoader.disposables;
  }

  public async getSchemasForRegistry(
    schemaRegistry: SchemaRegistry,
    forceDeepRefresh?: boolean,
  ): Promise<Schema[] | undefined> {
    await this.ensureCoarseResourcesLoaded();
    await this.ensureSchemasLoaded(schemaRegistry, forceDeepRefresh);

    return await getResourceManager().getSchemasForRegistry(schemaRegistry.id);
  }

  /** Have the course resources been cached already? */
  protected coarseLoadingComplete: boolean = false;

  /** If in progress of loading the coarse resources, the promise doing so. */
  protected currentlyCoarseLoadingPromise: Promise<void> | null = null;

  /**
   * Known state of resource manager cache for each schema registry's schemas by schema registry id:
   *  * Undefined: unknown schema registry, call {@link ensureSchemasLoaded} to fetch and cache.
   *  * False: known schema registry, but its schemas not yet fetched, call  {@link ensureSchemasLoaded} to fetch and cache.
   *  * True: Fully cached. Go ahead and make use of resourceManager.getCCloudSchemasForCluster(id)
   *  * Promise<void>: in progress of fetching, join awaiting this promise to know when it's safe to use resourceManager.getCCloudSchemasForCluster(id).
   */
  protected schemaRegistryCacheStates: Map<string, boolean | Promise<void>> = new Map();

  /** Get the ResourceLoader subclass instance corresponding to the given connectionId */
  public static getInstance(connectionId: string): ResourceLoader {
    if (connectionId === CCLOUD_CONNECTION_ID) {
      return CCloudResourceLoader.getInstance();
    } else if (connectionId === LOCAL_CONNECTION_ID) {
      logger.info("returning LocalResourceLoader");
      return LocalResourceLoader.getInstance();
    }

    throw new Error(`Unknown connectionId ${connectionId}`);
  }

  // Coarse resource-related methods.

  protected abstract deleteCoarseResources(): void;

  protected abstract doLoadCoarseResources(): Promise<void>;

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
  public async ensureCoarseResourcesLoaded(forceDeepRefresh: boolean = false): Promise<void> {
    // If caller requested a deep refresh, reset the loader's state so that we fall through to
    // re-fetching the coarse resources.
    if (forceDeepRefresh) {
      logger.info(`Deep refreshing ${this.kind} resources.`);
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

  // Schema registry related 'fine grained' methods.

  /**
   * Mark this schema registry cache as stale, such as when known that a schema has been added or removed,
   * but the registry isn't currently being displayed
   */
  public purgeSchemas(schemaRegistryId: string): void {
    this.schemaRegistryCacheStates.set(schemaRegistryId, false);
  }

  /** Ensure that this single Schema Registry's schemas have been loaded. */
  public async ensureSchemasLoaded(
    schemaRegistry: SchemaRegistry,
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

  /** Load the schemas for this single Schema Registry into the resource manager. */
  protected abstract doLoadSchemas(schemaRegistry: SchemaRegistry): Promise<void>;

  /** Go back to initial state, not having cached anything. */
  protected reset(): void {
    this.coarseLoadingComplete = false;
    this.currentlyCoarseLoadingPromise = null;
    this.schemaRegistryCacheStates.clear();
  }
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
class CCloudResourceLoader extends ResourceLoader {
  kind = "CCloud";

  private static instance: CCloudResourceLoader | null = null;

  public static getInstance(): ResourceLoader {
    if (!CCloudResourceLoader.instance) {
      CCloudResourceLoader.instance = new CCloudResourceLoader();
    }
    return CCloudResourceLoader.instance;
  }

  private constructor() {
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
      logger.info(`Deep loading schemas for CCloud Schema Registry ${schemaRegistry.id}`);
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
}

class LocalResourceLoader extends ResourceLoader {
  kind = "Local";

  private static instance: LocalResourceLoader | null = null;
  public static getInstance(): ResourceLoader {
    if (!LocalResourceLoader.instance) {
      LocalResourceLoader.instance = new LocalResourceLoader();
    }
    return LocalResourceLoader.instance;
  }

  private constructor() {
    super();

    // When local kafka connection state changes, reset the loader's state
    const localKafkaConnectedSub: Disposable = localKafkaConnected.event(
      async (connected: boolean) => {
        this.reset();

        if (connected) {
          // Start the coarse preloading process if we think we have a local connection.
          await this.ensureCoarseResourcesLoaded();
        }
      },
    );

    ResourceLoader.disposables.push(localKafkaConnectedSub);

    // localSchemaRegistryConnected also?
  }

  protected deleteCoarseResources(): void {
    // Maybe something like this?
    // getResourceManager().deleteLocalResources();
  }

  /*
    load local cluster group into resource manager
  */
  protected async doLoadCoarseResources(): Promise<void> {
    // XXX JLR SCAMMER
    // Fake that we know there's a local schema registry. We know its id.
    this.schemaRegistryCacheStates.set("local-sr", false);
  }

  protected async doLoadSchemas(schemaRegistry: SchemaRegistry): Promise<void> {
    try {
      const schemas = await fetchSchemas(schemaRegistry.id, schemaRegistry.connectionId);
      await getResourceManager().setSchemasForRegistry(schemaRegistry.id, schemas);
      // Mark this cluster as having its schemas loaded.
      this.schemaRegistryCacheStates.set(schemaRegistry.id, true);
    } catch (error) {
      // Perhaps the user logged out of CCloud while the preloading was in progress, or some other API-level error.
      logger.error("Error while preloading local schemas", { error });

      // Forget the current promise, make next call to ensureSchemasLoaded() start from scratch.
      this.schemaRegistryCacheStates.set(schemaRegistry.id, false);

      throw error;
    }
  }
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
  environmentId?: string,
): Promise<Schema[]> {
  const sidecar = await getSidecar();
  const client: SchemasV1Api = sidecar.getSchemasV1Api(schemaRegistryId, connectionId);
  const schemaListRespData: ResponseSchema[] = await client.getSchemas();
  const schemas: Schema[] = schemaListRespData.map((schema: ResponseSchema) => {
    // AVRO doesn't show up in `schemaType`
    // https://docs.confluent.io/platform/current/schema-registry/develop/api.html#get--subjects-(string-%20subject)-versions-(versionId-%20version)
    const schemaType = (schema.schemaType as SchemaType) || SchemaType.Avro;
    // appease typescript because it doesn't want to convert `string | undefined` to `Require<string> | undefined`
    const maybeEnvironmentId = environmentId as Require<string> | undefined;
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
