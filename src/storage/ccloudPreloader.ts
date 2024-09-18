import { ccloudConnected } from "../emitters";
import { getEnvironments } from "../graphql/environments";
import { Schema } from "../models/schema";
import { getSchemas } from "../viewProviders/schemas";
import { getResourceManager } from "./resourceManager";

/**
 * Singleton class responsible for preloading Confluent Cloud resources into the extension state.
 */
export class CCLoudResourcePreloader {
  private static instance: CCLoudResourcePreloader | null = null;
  private loadingComplete: boolean = false;
  private currentlyLoadingPromise: Promise<void> | null = null;
  private _hasCCloudConnection: boolean = false;

  public static getInstance(): CCLoudResourcePreloader {
    if (!CCLoudResourcePreloader.instance) {
      CCLoudResourcePreloader.instance = new CCLoudResourcePreloader();
    }
    return CCLoudResourcePreloader.instance;
  }

  private constructor() {
    // Register to listen for ccloud connection events.
    ccloudConnected.event(async (connected: boolean) => {
      this.reset();
      this._hasCCloudConnection = connected;
      if (connected) {
        // Start the preloading process if we think we have a ccloud connection.
        await this.preloadEnvironmentResources();
      }
    });
  }

  /** Do we currently think there's a ccloud connection? */
  public hasCCloudConnection(): boolean {
    return this._hasCCloudConnection;
  }

  /** Reset the preloader to its initial state: not currently fetching, have not fetched,
   * so that the next call to preloadEnvironmentResources() will start from scratch.
   */
  reset(): void {
    this.loadingComplete = false;
    this.currentlyLoadingPromise = null;
  }

  /**
   * Fired off when ccloud edges to connected., and/or when a view controller needs to get at the
   * resources stored in ResourceManager and needs to ensure they are all preloaded.
   */
  public async preloadEnvironmentResources(): Promise<void> {
    // If the resources are already loaded, nothing to wait on.
    if (this.loadingComplete) {
      return;
    }

    // If in progress of loading, await the promise that is currently loading the resources.
    if (this.currentlyLoadingPromise) {
      return this.currentlyLoadingPromise;
    }

    // This caller is the first to request the preload, so do the work in the foreground,
    // but also store the promise so that any other concurrent callers can await it.
    this.currentlyLoadingPromise = this.doPreloadEnvironmentResources();
    await this.currentlyLoadingPromise;
  }

  /**
   * Preload the {@link CCloudEnvironment}s and their children (Kafka clusters, Schema Registry) into
   * the extension state for general use.
   * @remarks this is called after a successful connection to Confluent Cloud, and is done in order to
   * avoid having to fetch each environment's resources on-demand and speed up topic/schema browsing.
   */
  private async doPreloadEnvironmentResources(): Promise<void> {
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

    // For each environment, if there's a schema registry, queue up fetching (and caching) its schemas.
    // Is safe to fetch + cache each environment's schemas in parallel.
    const promises: Promise<Schema[]>[] = [];
    for (const envGroup of envGroups) {
      const schemaRegistry = envGroup.schemaRegistry;
      if (schemaRegistry !== undefined) {
        await resourceManager.setCCloudSchemaRegistryCluster(schemaRegistry);
        // queue up to fetch all the schemas plus mainly tickle the side effect of
        // storing those schemas into the resource manager.
        promises.push(getSchemas(envGroup.environment, schemaRegistry.id));
      }
    }
    await Promise.all(promises);

    // TODO: add flink compute pools here?

    // All done, clear the promise and mark the loading as complete.
    this.currentlyLoadingPromise = null;

    // In case the user logged out _while_ we were loading, err on setting loadingComplete to false.
    this.loadingComplete = this._hasCCloudConnection;
  }
}
