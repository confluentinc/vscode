import { ccloudConnected } from "../emitters";
import { getEnvironments } from "../graphql/environments";
import { Schema } from "../models/schema";
import { SchemaRegistryCluster } from "../models/schemaRegistry";
import { getSchemas } from "../viewProviders/schemas";
import { getResourceManager } from "./resourceManager";

/**
 * Singleton class responsible for preloading Confluent Cloud resources into the resource manager.
 * View providers and/or other consumers of CCloud resources stored in the resource manager should
 * call {@link ensureResourcesLoaded} to ensure that the resources are cached before attempting to
 * access them from the resource manager.
 */
export class CCloudResourcePreloader {
  private static instance: CCloudResourcePreloader | null = null;
  private loadingComplete: boolean = false;
  private currentlyLoadingPromise: Promise<void> | null = null;
  private _hasCCloudConnection: boolean = false;

  public static getInstance(): CCloudResourcePreloader {
    if (!CCloudResourcePreloader.instance) {
      CCloudResourcePreloader.instance = new CCloudResourcePreloader();
    }
    return CCloudResourcePreloader.instance;
  }

  private constructor() {
    // Register to listen for ccloud connection events.
    ccloudConnected.event(async (connected: boolean) => {
      this.reset();
      this._hasCCloudConnection = connected;
      if (connected) {
        // Start the preloading process if we think we have a ccloud connection.
        await this.ensureResourcesLoaded();
      }
    });
  }

  /** Do we currently think there's a ccloud connection? */
  public hasCCloudConnection(): boolean {
    return this._hasCCloudConnection;
  }

  /**
   * Promise ensuring that all the ccloud resources are cached into the resource manager.
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
   *   - CCloud Environments (ResourceManager.getCCloudEnvironments())
   *   - CCloud Kafka Clusters (ResourceManager.getCCloudKafkaClusters())
   *   - CCloud Schema Registries (ResourceManager.getCCloudSchemaRegistryClusters())
   *   - CCloud Schemas (ResourceManager.getCCloudSchemas())
   */
  public async ensureResourcesLoaded(): Promise<void> {
    // If the resources are already loaded, nothing to wait on.
    if (this.loadingComplete) {
      return;
    }

    // If in progress of loading, have the caller await the promise that is currently loading the resources.
    if (this.currentlyLoadingPromise) {
      return this.currentlyLoadingPromise;
    }

    // This caller is the first to request the preload, so do the work in the foreground,
    // but also store the promise so that any other concurrent callers can await it.
    this.currentlyLoadingPromise = this.doLoadResources();
    await this.currentlyLoadingPromise;
  }

  /**
   * Load the {@link CCloudEnvironment}s and their children (Kafka clusters, schema registry, schemas) into
   * the resource manager  for general use.
   */
  private async doLoadResources(): Promise<void> {
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

    // For each environment, if there's a schema registry, queue up fetching (and caching) its schemas.
    // Is safe to fetch + cache each environment's schemas in parallel.
    const promises: Promise<Schema[]>[] = [];

    for (const envGroup of envGroups) {
      const schemaRegistry = envGroup.schemaRegistry;
      if (schemaRegistry !== undefined) {
        // queue up to fetch all the schemas plus mainly tickle the side effect of
        // storing those schemas into the resource manager.
        promises.push(getSchemas(envGroup.environment, schemaRegistry.id));
      }
    }
    await Promise.all(promises);

    // TODO: add flink compute pools here?

    // All done, clear the promise and mark the loading as complete.
    this.currentlyLoadingPromise = null;

    // In case the user logged out _while_ we were busy loading, err on setting loadingComplete to false.
    this.loadingComplete = this._hasCCloudConnection;
  }

  /** Reset the preloader to its initial state: not currently fetching, have not fetched,
   * so that the next call to {@link ensureResourcesLoaded} will start from scratch.
   */
  public reset(): void {
    this.loadingComplete = false;
    this.currentlyLoadingPromise = null;
  }
}
