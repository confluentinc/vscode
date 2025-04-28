import { Disposable } from "vscode";

import {
  ListSqlv1StatementsRequest,
  SqlV1StatementListDataInner,
  SqlV1StatementSpec,
  SqlV1StatementTraits,
} from "../clients/flinkSql";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ccloudConnected } from "../emitters";
import { getEnvironments } from "../graphql/environments";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement } from "../models/flinkStatement";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import { EnvironmentId, IFlinkQueryable, OrganizationId, isCCloud } from "../models/resource";
import { CCloudSchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { getSidecar, SidecarHandle } from "../sidecar";
import { getResourceManager } from "../storage/resourceManager";
import { ObjectSet } from "../utils/objectset";
import { executeInWorkerPool, ExecutionResult, extract } from "../utils/workerPool";
import { ResourceLoader } from "./resourceLoader";

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
 *
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

  /** The user's current ccloud organization. Determined along with coarse resources. */
  private organizationId: OrganizationId | null = null;

  // Singleton class. Use getInstance() to get the singleton instance.
  // (Only public for testing / signon mocking purposes.)
  constructor() {
    if (CCloudResourceLoader.instance) {
      throw new Error("Use CCloudResourceLoader.getInstance()");
    }
    super();

    this.registerEventListeners();
  }

  private registerEventListeners(): void {
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
    this.organizationId = null;
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

      // Do the GraphQL fetches concurrently.
      // (this.getOrganizationId() internally caches its result, so we don't need to worry about)
      const gqlResults = await Promise.all([getEnvironments(), this.getOrganizationId()]);

      // Store the environments, clusters, schema registries in the resource manager
      const environments: CCloudEnvironment[] = gqlResults[0];
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

  /**
   * Get the current organization ID either from cached value or
   * directly from the sidecar GraphQL API.
   *
   * @returns The current organization ID.
   */
  public async getOrganizationId(): Promise<OrganizationId> {
    if (this.organizationId) {
      return this.organizationId;
    }

    const organization = await getCurrentOrganization();
    if (organization) {
      this.organizationId = organization.id as unknown as OrganizationId;
      return this.organizationId;
    }
    logger.error("getOrganizationId(): No current organization found.");
    throw new Error("No current organization found.");
  }

  /**
   * Convert the given CCloudEnvironment or CCloudFlinkComputePool
   * into a list of distinct IFlinkQueryable objects. Each object
   * will be for a separate provider-region pair within the environment.
   */
  public async determineFlinkQueryables(
    resource: CCloudEnvironment | CCloudFlinkComputePool,
  ): Promise<IFlinkQueryable[]> {
    const orgId = await this.getOrganizationId();
    if (resource instanceof CCloudFlinkComputePool) {
      // If we have a single compute pool, just reexpress it.
      return [
        {
          organizationId: orgId,
          environmentId: resource.environmentId,
          computePoolId: resource.id,
          provider: resource.provider,
          region: resource.region,
        },
      ];
    } else {
      // The environment may have many resources in the same
      // provider-region pair. We need to deduplicate them by provider-region.
      const providerRegionSet: ObjectSet<IFlinkQueryable> = new ObjectSet(
        (queryable) => `${queryable.provider}-${queryable.region}`,
      );

      // Collect all regions inferred from existing Flink compute pools

      // (Not also Kafka clusters, as that the user may have
      //  Kafka clusters in not-yet-Flink-supported provider-regions,
      //  and at time of writing, inquiring causes 500 errors.
      //
      //  There must be some way of determining if a provider-region
      //  is Flink-supported, but not sure what it is yet.)

      resource.flinkComputePools.forEach((pool) => {
        providerRegionSet.add({
          provider: pool.provider,
          region: pool.region,
          organizationId: orgId,
          environmentId: resource.id,
        });
      });

      return providerRegionSet.items();
    }
  }

  /**
   * Query the Flink statements for the given CCloud environment + provider-region.
   * @returns The Flink statements for the given environment + provider-region.
   * @param providerRegion The CCloud environment, provider, region to get the Flink statements for.
   */
  public async getFlinkStatements(
    resource: CCloudEnvironment | CCloudFlinkComputePool,
  ): Promise<FlinkStatement[]> {
    const queryables: IFlinkQueryable[] = await this.determineFlinkQueryables(resource);
    const handle = await getSidecar();

    // For each provider-region pair, get the Flink statements with reasonable concurrency.
    const concurrentResults: ExecutionResult<FlinkStatement[]>[] = await executeInWorkerPool(
      (queryable: IFlinkQueryable) => loadStatementsForProviderRegion(handle, queryable),
      queryables,
      { maxWorkers: 5 },
    );

    logger.debug(`getFlinkStatements() loaded ${concurrentResults.length} provider-region pairs`);

    // Assemble the results into a single array of Flink statements.
    const flinkStatements: FlinkStatement[] = [];

    // extract will raise first error if any error was encountered.
    const blocks: FlinkStatement[][] = extract(concurrentResults);
    for (const block of blocks) {
      flinkStatements.push(...block);
    }

    return flinkStatements;
  }

  /** Go back to initial state, not having cached anything. */
  private reset(): void {
    this.coarseLoadingComplete = false;
    this.currentlyCoarseLoadingPromise = null;
  }
}

/**
 * Load statements for a single provider/region and perhaps cluster-id
 * (Sub-unit of getFlinkStatements(), factored out for concurrency
 *  via executeInWorkerPool())
 * */

async function loadStatementsForProviderRegion(
  handle: SidecarHandle,
  queryable: IFlinkQueryable,
): Promise<FlinkStatement[]> {
  const statementsClient = handle.getFlinkSqlStatementsApi(queryable);

  const request: ListSqlv1StatementsRequest = {
    organization_id: queryable.organizationId,
    environment_id: queryable.environmentId,
    page_size: 100, // ccloud max page size
    page_token: "", // start with the first page

    // Possibly filter by compute pool ID, if specified (as when we're called with a CCloudFlinkComputePool instance).
    spec_compute_pool_id: queryable.computePoolId,

    // Don't show hidden statements, only user-created ones. "System" queries like
    // ccloud workspaces UI examining the system catalog are created with this label
    // set to true.
    label_selector: "user.confluent.io/hidden!=true",
  };

  logger.debug(
    `getFlinkStatements() requesting from ${queryable.provider}-${queryable.region} :\n${JSON.stringify(request, null, 2)}`,
  );

  const flinkStatements: FlinkStatement[] = [];

  let needMore: boolean = true;

  while (needMore) {
    const restResult = await statementsClient.listSqlv1Statements(request);

    // Convert each Flink statement from the REST API representation to our codebase model.
    for (const restStatement of restResult.data) {
      const statement = restFlinkStatementToModelFlinkStatement(restStatement);
      flinkStatements.push(statement);
    }

    // If this wasn't the last page, update the request to get the next page.
    if (restResult.metadata.next) {
      // `restResult.metadata.next` will be a full URL like "https://.../statements?page_token=UvmDWOB1iwfAIBPj6EYb"
      // Must extract the page token from the URL.
      const nextUrl = new URL(restResult.metadata.next);
      const pageToken = nextUrl.searchParams.get("page_token");
      if (!pageToken) {
        // Should never happen, but just in case.
        logger.error("Wacky. No page token found in next URL.");
        needMore = false;
      } else {
        request.page_token = pageToken;
      }
    } else {
      // No more pages to fetch.
      needMore = false;
    }
  }

  return flinkStatements;
}

/** Convert a from-REST API depiction of a Flink statement to our codebase's  FlinkStatement model. */
function restFlinkStatementToModelFlinkStatement(
  restFlinkStatement: SqlV1StatementListDataInner,
): FlinkStatement {
  return new FlinkStatement({
    connectionId: CCLOUD_CONNECTION_ID,
    connectionType: ConnectionType.Ccloud,
    environmentId: restFlinkStatement.environment_id as EnvironmentId,
    organizationId: restFlinkStatement.organization_id as OrganizationId,
    name: restFlinkStatement.name,
    spec: restFlinkStatement.spec,
    metadata: restFlinkStatement.metadata,
    status: restFlinkStatement.status,
  });
}
