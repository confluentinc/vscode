import type { Disposable } from "vscode";

import type { ArtifactV1FlinkArtifactListDataInner } from "../clients/flinkArtifacts";
import type {
  FcpmV2RegionListDataInner,
  ListFcpmV2RegionsRequest,
} from "../clients/flinkComputePool";
import type { ListSqlv1StatementsRequest } from "../clients/flinkSql";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ccloudConnected, flinkStatementDeleted } from "../emitters";
import type { IFlinkStatementSubmitParameters } from "../flinkSql/statementUtils";
import {
  determineFlinkStatementName,
  parseAllFlinkStatementResults,
  refreshFlinkStatement,
  submitFlinkStatement,
  waitForStatementCompletion,
} from "../flinkSql/statementUtils";
import { getCCloudResources } from "../graphql/ccloud";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import type { CCloudEnvironment } from "../models/environment";
import { FlinkArtifact } from "../models/flinkArtifact";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import type { FlinkStatement } from "../models/flinkStatement";
import { Phase, restFlinkStatementToModel } from "../models/flinkStatement";
import type { FlinkRelation } from "../models/flinkSystemCatalog";
import { FlinkUdf } from "../models/flinkUDF";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import type { CCloudOrganization } from "../models/organization";
import type { EnvironmentId, IFlinkQueryable, IProviderRegion } from "../models/resource";
import type { CCloudSchemaRegistry } from "../models/schemaRegistry";
import type { SidecarHandle } from "../sidecar";
import { getSidecar } from "../sidecar";
import { getResourceManager } from "../storage/resourceManager";
import { ObjectSet } from "../utils/objectset";
import type { ExecutionResult } from "../utils/workerPool";
import { executeInWorkerPool, extract } from "../utils/workerPool";
import { CachingResourceLoader } from "./cachingResourceLoader";
import { generateFlinkStatementKey } from "./utils/loaderUtils";
import type { RawRelationsAndColumnsRow } from "./utils/relationsAndColumnsSystemCatalogQuery";
import {
  getRelationsAndColumnsSystemCatalogQuery,
  parseRelationsAndColumnsSystemCatalogQueryResponse,
} from "./utils/relationsAndColumnsSystemCatalogQuery";
import type { RawUdfSystemCatalogRow } from "./utils/udfSystemCatalogQuery";
import {
  getUdfSystemCatalogQuery,
  transformUdfSystemCatalogRows,
} from "./utils/udfSystemCatalogQuery";

const logger = new Logger("storage.ccloudResourceLoader");

/**
 * Singleton class responsible for loading / caching CCloud resources into the resource manager.
 * View providers and/or other consumers of resources stored in the resource manager should
 * call {@link ensureCoarseResourcesLoaded} to ensure that the resources are cached before attempting to
 * access them from the resource manager.
 *
 * Handles loading the following "coarse" resources via ${link ensureCoarseResourcesLoaded}:
 *  - CCloud Environments (ResourceManager.getCCloudEnvironments())
 *  - CCloud Kafka Clusters (ResourceManager.getCCloudKafkaClusters())
 *
 */
export class CCloudResourceLoader extends CachingResourceLoader<
  CCloudEnvironment,
  CCloudKafkaCluster,
  CCloudSchemaRegistry
> {
  connectionId = CCLOUD_CONNECTION_ID;
  connectionType = ConnectionType.Ccloud;

  private static instance: CCloudResourceLoader | null = null;

  public static getInstance(): CCloudResourceLoader {
    if (!CCloudResourceLoader.instance) {
      CCloudResourceLoader.instance = new CCloudResourceLoader();
    }
    return CCloudResourceLoader.instance;
  }

  /** The user's current ccloud organization. Determined along with coarse resources. */
  private organization: CCloudOrganization | null = null;

  // Singleton class. Use getInstance() to get the singleton instance.
  // (Only public for testing / signon mocking purposes.)
  constructor() {
    if (CCloudResourceLoader.instance) {
      throw new Error("Use CCloudResourceLoader.getInstance()");
    }
    super();

    this.disposables.push(...this.setEventListeners());
  }

  /** Register event handlers, returning the array of Disposable registrations. */
  protected setEventListeners(): Disposable[] {
    return [ccloudConnected.event(this.ccloudConnectedHandler.bind(this))];
  }

  /**
   * When the ccloud connection state changes, reset the loader's state. If
   * we just transitioned to connected, preemptively perform the coarse preloading process.
   */
  public async ccloudConnectedHandler(connected: boolean): Promise<void> {
    await this.reset();

    if (connected) {
      // Start the coarse preloading process if we think we have a ccloud connection.
      await this.ensureCoarseResourcesLoaded();
    }
  }

  /** Fulfill ResourceLoader::getEnvironmentsFromGraphQL */
  protected async getEnvironmentsFromGraphQL(): Promise<CCloudEnvironment[]> {
    // Drive the GQL query.
    return await getCCloudResources();
  }

  /** Fulfill ResourceLoader::reset(), taking care of clearing in-memory cached organization. */
  public async reset(): Promise<void> {
    // Upcall, clearing resource manager cached on-disk state,
    await super.reset();
    // ... then also forget the organization (in memory only).
    this.organization = null;
  }

  /**
   * Refine CoarseCachingResourceLoader:: doLoadCoarseResources() to
   * also concurrently load the organization (cached in memory).
   */
  protected async doLoadCoarseResources(): Promise<void> {
    // Load our organization concurrenty with the base class coarse resources.
    await Promise.all([super.doLoadCoarseResources(), this.getOrganization()]);
  }

  /**
   * Get the current organization ID either from cached value or
   * directly from the sidecar GraphQL API.
   *
   * If we do not have a ccloud connection, this will return undefined. This undefined
   * is the signal to callers that they should not be trying to access CCloud resources.
   *
   * @returns The {@link CCloudOrganization} for the current CCloud connection, either from cached
   * value or deep fetch, or undefined if no organization is found (i.e., not connected).
   */
  public async getOrganization(): Promise<CCloudOrganization | undefined> {
    if (this.organization) {
      return this.organization;
    }

    const organization = await getCurrentOrganization();
    if (organization) {
      this.organization = organization;
      return this.organization;
    } else {
      logger.withCallpoint("getOrganization()").error("No current organization found.");
    }
  }

  /**
   * Get all Flink compute pools in all environments, or in a specific environment if given.
   * @param environmentId Optional environment ID to filter by.
   * @returns Array of {@link CCloudFlinkComputePool} objects.
   */
  public async getFlinkComputePools(
    environmentId?: EnvironmentId,
  ): Promise<CCloudFlinkComputePool[]> {
    const envs: CCloudEnvironment[] = await this.getEnvironments();
    const pools: CCloudFlinkComputePool[] = [];
    for (const env of envs) {
      if (environmentId && env.id !== environmentId) {
        continue;
      }
      pools.push(...env.flinkComputePools);
    }
    return pools;
  }

  /**
   * Get a specific Flink compute pool by ID.
   * @param computePoolId The compute pool ID to look for.
   * @returns The {@link CCloudFlinkComputePool} with the given ID, or undefined if not found.
   */
  public async getFlinkComputePool(
    computePoolId: string,
  ): Promise<CCloudFlinkComputePool | undefined> {
    const pools = await this.getFlinkComputePools();
    return pools.find((p) => p.id === computePoolId);
  }

  /**
   * Get all Flink databases (Flink-enabled Kafka clusters) for one or all environments.
   * @param environmentId Optional environment ID to filter by.
   * @returns Array of {@link CCloudFlinkDbKafkaCluster} objects.
   */
  public async getFlinkDatabases(
    environmentId?: EnvironmentId,
  ): Promise<CCloudFlinkDbKafkaCluster[]> {
    let clusters = await this.getKafkaClusters((cluster) => cluster.isFlinkable());
    const databases = environmentId
      ? clusters.filter((c) => c.environmentId === environmentId)
      : clusters;
    return databases as CCloudFlinkDbKafkaCluster[];
  }

  /**
   * Get a specific Flink database (Flink-enabled Kafka cluster) by environment and database/cluster ID.
   * @param environmentId The environment ID to look for.
   * @param databaseId The database/cluster ID to look for.
   * @returns The {@link CCloudFlinkDbKafkaCluster} with the given ID, or undefined if not found.
   */
  public async getFlinkDatabase(
    environmentId: EnvironmentId,
    databaseId: string,
  ): Promise<CCloudFlinkDbKafkaCluster | undefined> {
    const databases: CCloudFlinkDbKafkaCluster[] = await this.getFlinkDatabases(environmentId);
    return databases.find((db) => db.id === databaseId);
  }

  /**
   * Convert the given CCloudEnvironment, CCloudFlinkComputePool, or CCloudKafkaCluster
   * into a list of distinct IFlinkQueryable objects. Each object
   * will be for a separate provider-region pair within the environment.
   */
  public async determineFlinkQueryables(
    resource: CCloudEnvironment | CCloudFlinkComputePool | CCloudKafkaCluster,
  ): Promise<IFlinkQueryable[]> {
    if (resource instanceof CCloudFlinkComputePool || resource instanceof CCloudKafkaCluster) {
      return [await this.toFlinkQueryable(resource)];
    } else {
      // Must be a CCloudEnvironment. Gather all provider-region pairs.
      // The environment may have many resources in the same
      // provider-region pair. We need to deduplicate them by provider-region.

      const org = await this.getOrganization();
      if (!org) {
        // not connected to CCloud, therefore never any Flink queryables.
        return [];
      }

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
          organizationId: org.id,
          environmentId: resource.id,
        });
      });

      return providerRegionSet.items();
    }
  }

  /**
   * Convert the given CCloudFlinkComputePool or CCloudKafkaCluster
   * into a single IFlinkQueryable object.
   */
  public async toFlinkQueryable(
    resource: CCloudFlinkComputePool | CCloudKafkaCluster,
  ): Promise<IFlinkQueryable> {
    const org = await this.getOrganization();
    if (!org) {
      throw new Error("Not connected to CCloud, cannot determine Flink queryable.");
    }

    const singleton: IFlinkQueryable = {
      organizationId: org.id,
      environmentId: resource.environmentId,
      provider: resource.provider,
      region: resource.region,
    };

    if (resource instanceof CCloudFlinkComputePool) {
      // Only fix to a single compute pool if we were given a compute pool.
      singleton.computePoolId = resource.id;
    }
    return singleton;
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

  /**
   * Reload the given Flink statement from the sidecar API.
   * @param statement The Flink statement to refresh.
   * @returns Updated Flink statement or null if it was not found.
   * @throws Error if there was an error while refreshing the Flink statement.
   */
  public async refreshFlinkStatement(statement: FlinkStatement): Promise<FlinkStatement | null> {
    // Defer to core implementation in flinkSql/statementUtils.ts
    return await refreshFlinkStatement(statement);
  }

  /**
   * Delete the given Flink statement via the sidecar API.
   * @param statement The Flink statement to delete.
   */
  public async deleteFlinkStatement(statement: FlinkStatement): Promise<void> {
    const handle = await getSidecar();
    const statementsClient = handle.getFlinkSqlStatementsApi(statement);

    logger.info(
      `Deleting Flink statement ${statement.id} on ${statement.provider}-${statement.region} in environment ${statement.environmentId}`,
    );

    try {
      await statementsClient.deleteSqlv1Statement({
        organization_id: statement.organizationId,
        environment_id: statement.environmentId,
        statement_name: statement.name,
      });
    } catch (error) {
      logger.error(`Error deleting Flink statement ${statement.id}`, { error });
      throw error;
    }

    // fire event to get the UI refreshed
    flinkStatementDeleted.fire(statement.id);
  }

  /** Stop a currently running Flink statement */
  public async stopFlinkStatement(statement: FlinkStatement): Promise<void> {
    const handle = await getSidecar();
    const statementsClient = handle.getFlinkSqlStatementsApi(statement);

    // Refresh the statement otherwise we cannot stop it, will always get an error.
    const refreshedStatement = await this.refreshFlinkStatement(statement);

    if (!refreshedStatement) {
      throw new Error(`Could not find Flink statement ${statement.id} to stop.`);
    }

    if (!refreshedStatement.stoppable) {
      throw new Error(`Statement ${statement.id} is not in a stoppable state.`);
    }

    logger.info(
      `Stopping Flink statement ${statement.id} in ${statement.cloudRegion} and environment ${statement.environmentId}`,
    );

    try {
      // One does not merely stop a Flink statement, one must update its spec to indicate our desire
      // for it to be stopped.
      await statementsClient.updateSqlv1Statement({
        organization_id: refreshedStatement.organizationId,
        environment_id: refreshedStatement.environmentId,
        statement_name: refreshedStatement.name,
        UpdateSqlv1StatementRequest: {
          metadata: refreshedStatement.metadata,
          name: refreshedStatement.name,
          organization_id: refreshedStatement.organizationId,
          environment_id: refreshedStatement.environmentId,
          status: refreshedStatement.status,
          spec: {
            ...refreshedStatement.spec,
            stopped: true,
          },
        },
      });
    } catch (error) {
      logger.error(`Error stopping Flink statement ${statement.id}`, { error });
      throw error;
    }

    // Since the statement was running, the FlinkStatementManager will already
    // be polling its status, so no need to do anything more here. When it transitions
    // to a terminal phase, the FlinkStatementManager will fire events to update the UI.
  }

  /**
   * Query the Flink artifacts for the given CCloudFlinkDbKafkaCluster's CCloud environment + provider-region.
   * Looks to the resource manager cache first, and only does a deep fetch if not found (or told to force refresh).
   * @returns The Flink artifacts for the given environment + provider-region.
   * @param resource The CCloud Flink Database (a Flink-enabled Kafka Cluster) to get the Flink artifacts for.
   */
  public async getFlinkArtifacts(
    resource: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkArtifact[]> {
    const queryable = await this.toFlinkQueryable(resource);

    // Look to see if we have cached artifacts for this environment/provider/region already.
    const rm = getResourceManager();
    let artifacts = await rm.getFlinkArtifacts(queryable);
    if (artifacts === undefined || forceDeepRefresh) {
      // Nope, deep fetch them (or was told to ignore cache and refetch).
      const handle = await getSidecar();
      artifacts = await loadArtifactsForProviderRegion(handle, queryable);

      // Cache them in the resource manager for future reference.
      await rm.setFlinkArtifacts(queryable, artifacts);
    }

    return artifacts;
  }

  /**
   * Get the Flink UDFs for the given Flinkable CCloud Kafka cluster.
   *
   * @param cluster The Flink database to get the UDFs for.
   * @param forceDeepRefresh Whether to bypass the ResourceManager cache and fetch fresh data.
   * @returns Array of {@link FlinkUdf} objects representing the UDFs in the cluster.
   */
  public async getFlinkUDFs(
    cluster: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkUdf[]> {
    // Look to see if we have cached UDFs for this Flink database already.
    const rm = getResourceManager();
    let udfs = await rm.getFlinkUDFs(cluster);

    if (udfs === undefined || forceDeepRefresh) {
      // Run the statement to list UDFs.

      // Get the query to run, limiting by the given cluster's ID.
      const udfSystemCatalogQuery = getUdfSystemCatalogQuery(cluster);

      // Will raise Error if the cluster isn't Flinkable or if the statement
      // execution fails. Will use the first compute pool in the cluster's
      // flinkPools array to execute the statement.
      const rawResults = await this.executeBackgroundFlinkStatement<RawUdfSystemCatalogRow>(
        udfSystemCatalogQuery,
        cluster,
        { nameSpice: "list-udfs" },
      );

      // Convert the raw results into FlinkUdf objects.
      udfs = transformUdfSystemCatalogRows(cluster, rawResults);

      // Cache them in the resource manager for future reference.
      await rm.setFlinkUDFs(cluster, udfs);
    }

    return udfs;
  }

  /**
   * Get the tables / views / columns of a given Flink database via system catalog queries.
   */
  public async getFlinkRelations(database: CCloudFlinkDbKafkaCluster): Promise<FlinkRelation[]> {
    const query = getRelationsAndColumnsSystemCatalogQuery(database);
    const relationsAndColumns =
      await this.executeBackgroundFlinkStatement<RawRelationsAndColumnsRow>(query, database);
    return parseRelationsAndColumnsSystemCatalogQueryResponse(relationsAndColumns);
  }

  /**
   * Map of outstanding promises for calls to executeBackgroundFlinkStatement(), keyed by hash
   * of (databaseId, computePoolId, sqlStatement).
   */
  private readonly backgroundStatementPromises: Map<string, Promise<Array<any>>> = new Map();

  /**
   * Execute a system/hidden/background Flink SQL statement for VSCode Extension internals to
   * then make use of, returning the results as an array of objects of type RT.
   * Should be used for batch statements, such as system catalog queries, registering
   * or listing UDFs, etc.
   *
   * At most only one single promise for a given (sqlStatement, database, computePool) is
   * outstanding at a time. If this function is called again with the same parameters
   * while a previous call is still pending, the previous promise will be returned.
   *
   * All such queries should complete within 10s, or an error will be raised.
   *
   * @param sqlStatement The SQL statement (string) to execute.
   * @param database The database (CCloudKafkaCluster) to execute the statement against.
   * @param options Optional parameters for statement execution
   * @param options.computePool The compute pool to use for execution, defaults to the first compute pool in the database's flinkPools array.
   * @param options.timeout Custom timeout for the statement execution.
   * @param options.nameSpice Additional spice parameter for extending statement name to prevent different statement operations from colliding when executed quickly in succession.
   * @returns Array of results, each of type RT (generic type parameter) corresponding to the result row structure from the query.
   *
   */
  async executeBackgroundFlinkStatement<RT>(
    sqlStatement: string,
    database: CCloudFlinkDbKafkaCluster,
    options: {
      computePool?: CCloudFlinkComputePool;
      timeout?: number;
      nameSpice?: string;
    } = {},
  ): Promise<Array<RT>> {
    const organization = await this.getOrganization();
    if (!organization) {
      throw new Error("Not connected to CCloud, cannot execute Flink statement.");
    }

    if (!options.computePool) {
      options.computePool = database.flinkPools[0];
    } else if (!database.isSameEnvCloudRegion(options.computePool)) {
      // Ensure the provided compute pool is valid for this database.
      throw new Error(
        `Compute pool ${options.computePool.name} is not in the same cloud/region as cluster ${database.name}`,
      );
    }

    const statementParams: IFlinkStatementSubmitParameters = {
      statement: sqlStatement,
      statementName: await determineFlinkStatementName(options.nameSpice),
      organizationId: organization.id,
      computePool: options.computePool,
      hidden: true, // Hidden statement, user didn't author it.
      properties: database.toFlinkSpecProperties(),
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    };

    const promiseKey = generateFlinkStatementKey(statementParams);

    if (this.backgroundStatementPromises.has(promiseKey)) {
      // If we already have a pending promise for this same statement in this same database/compute pool,
      // just return the existing promise.
      logger.debug(
        `executeBackgroundFlinkStatement() deduplicating identical pending statement: ${sqlStatement}`,
      );
      return this.backgroundStatementPromises.get(promiseKey)!;
    }

    // Create a new promise for this statement execution, and store it in the map of pending promises.
    const statementPromise = this.doExecuteBackgroundFlinkStatement<RT>(statementParams).finally(
      () => {
        // When the promise settles (either resolves or rejects), remove it from the map of pending promises.
        this.backgroundStatementPromises.delete(promiseKey);
      },
    );

    this.backgroundStatementPromises.set(promiseKey, statementPromise);

    return statementPromise;
  }

  /** Actual implementation of executeBackgroundFlinkStatement(), without deduplication logic. */
  private async doExecuteBackgroundFlinkStatement<RT>(
    statementParams: IFlinkStatementSubmitParameters,
  ): Promise<Array<RT>> {
    const computePool = statementParams.computePool;
    logger.info(
      `Executing Flink statement on ${computePool?.provider}-${computePool?.region} in environment ${computePool?.environmentId} : ${statementParams.statement}`,
    );

    let statement = await submitFlinkStatement(statementParams);

    // Refresh the statement at 150ms intervals for at most 10s until it is in a terminal phase.
    const timeout = statementParams.timeout ?? 10_000;
    statement = await waitForStatementCompletion(statement, timeout, 150);

    if (statement.phase !== Phase.COMPLETED) {
      logger.error(
        `Statement ${statement.id} did not complete successfully, phase ${statement.phase}`,
      );
      throw new Error(
        `Statement did not complete successfully, phase ${statement.phase}. Error detail: ${statement.status.detail}`,
      );
    }

    // Consume all results.
    const resultRows: Array<RT> = await parseAllFlinkStatementResults<RT>(statement);

    // Delete the now completed statement. Even though is a hidden statement and won't be displayed
    // in the UI, we still want to delete it to avoid accumulating so many completed statements
    // in the backend. And also to avoid potential name collisions if the user runs the same
    // statement again within the same second (statement names must be unique per compute cluster).
    try {
      await this.deleteFlinkStatement(statement);
    } catch (error) {
      logger.error(`Error deleting completed Flink statement ${statement.id}`, { error });
      // Don't re-raise, as the statement did complete successfully and we do have results.
    }

    return resultRows;
  }

  /**
   * Returns a deduplicated list of provider/region pairs for all Flink compute pools
   * across all environments the user has access to.
   */
  public async getComputePoolProviderRegions(): Promise<IProviderRegion[]> {
    const envs: CCloudEnvironment[] = await this.getEnvironments();
    const providerRegionSet: ObjectSet<IProviderRegion> = new ObjectSet(
      (pr) => `${pr.provider}-${pr.region}`,
    );

    for (const env of envs) {
      (env.flinkComputePools || []).forEach((pool) => {
        providerRegionSet.add({
          provider: pool.provider,
          region: pool.region,
        });
      });
    }

    return providerRegionSet.items();
  }
}

/**
 * Load statements for a single provider/region and perhaps cluster-id
 * (Sub-unit of getFlinkStatements(), factored out for concurrency
 *  via executeInWorkerPool())
 */

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
      const statement = restFlinkStatementToModel(restStatement, queryable);
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
/**
 * Load artifacts for a single provider/region
 * (Sub-unit of getFlinkArtifacts(), factored out for concurrency
 *  via executeInWorkerPool())
 */
export async function loadArtifactsForProviderRegion(
  handle: SidecarHandle,
  queryable: IFlinkQueryable,
): Promise<FlinkArtifact[]> {
  const artifactsClient = handle.getFlinkArtifactsApi(queryable);

  logger.debug(
    `getFlinkArtifacts() requesting from ${queryable.provider}-${queryable.region} for environment ${queryable.environmentId}`,
  );

  const flinkArtifacts: FlinkArtifact[] = [];

  const request = {
    cloud: queryable.provider,
    region: queryable.region,
    environment: queryable.environmentId,
    page_size: 100, // max page size
    page_token: "", // start with the first page
  };

  let needMore: boolean = true;

  while (needMore) {
    try {
      const restResult = await artifactsClient.listArtifactV1FlinkArtifacts(request);
      const responseData = restResult.data ?? [];
      // Convert each Flink artifact from the REST API representation to our codebase model.
      for (const restArtifact of responseData) {
        const artifact = restFlinkArtifactToModel(restArtifact, queryable);
        flinkArtifacts.push(artifact);
      }

      // If this wasn't the last page, update the request to get the next page.
      if (restResult.metadata.next) {
        // `restResult.metadata.next` will be a full URL like "https://.../artifacts?page_token=UvmDWOB1iwfAIBPj6EYb"
        // Must extract the page token from the URL.
        const nextUrl = new URL(restResult.metadata.next);
        const pageToken = nextUrl.searchParams.get("page_token");
        if (!pageToken) {
          // Should never happen, but just in case.
          logger.error("No page token found in next URL.");
          needMore = false;
        } else {
          request.page_token = pageToken;
        }
      } else {
        // No more pages to fetch.
        needMore = false;
      }
    } catch (error) {
      logger.error(`Error loading Flink artifacts from ${queryable.provider}-${queryable.region}`, {
        error,
      });
      // Re-throw to be handled by executeInWorkerPool
      throw error;
    }
  }

  return flinkArtifacts;
}

/** Load all available cloud provider/region combinations from the FCPM API.) */
export async function loadProviderRegions(): Promise<FcpmV2RegionListDataInner[]> {
  const sidecarHandle = await getSidecar();
  const regionsClient = sidecarHandle.getRegionsFcpmV2Api();

  const regionData: FcpmV2RegionListDataInner[] = [];

  let request: ListFcpmV2RegionsRequest = {
    page_size: 100,
  };

  let needMore: boolean = true;

  while (needMore) {
    try {
      const restResult = await regionsClient.listFcpmV2Regions(request);

      regionData.push(...Array.from(restResult.data));
      // If this wasn't the last page, update the request to get the next page.
      if (restResult.metadata.next) {
        // `restResult.metadata.next` will be a full URL like "https://.../regions?page_token=UvmDWOB1iwfAIBPj6EYb"
        // Must extract the page token from the URL.
        const nextUrl = new URL(restResult.metadata.next);
        const pageToken = nextUrl.searchParams.get("page_token");
        if (!pageToken) {
          // Should never happen, but just in case.
          logger.error("No page token found in next URL.");
          needMore = false;
        } else {
          request = { ...request, page_token: pageToken };
        }
      } else {
        // No more pages to fetch.
        needMore = false;
      }
    } catch (error) {
      logger.error("Error loading Flink regions", {
        error,
      });
      // Re-throw to be handled by executeInWorkerPool
      throw error;
    }
  }
  return regionData;
}

/**
 * Convert a REST API Flink artifact representation to our codebase model.
 * @param restArtifact The REST API artifact representation
 * @param queryable The queryable context containing connection and environment info
 * @returns FlinkArtifact model instance
 */
function restFlinkArtifactToModel(
  restArtifact: ArtifactV1FlinkArtifactListDataInner,
  queryable: IFlinkQueryable,
): FlinkArtifact {
  return new FlinkArtifact({
    connectionId: CCLOUD_CONNECTION_ID,
    connectionType: ConnectionType.Ccloud,
    environmentId: queryable.environmentId,
    id: restArtifact.id,
    name: restArtifact.display_name || restArtifact.id,
    description: restArtifact.description || "",
    provider: restArtifact.cloud,
    region: restArtifact.region,
    metadata: restArtifact.metadata,
    documentationLink: restArtifact.documentation_link || "",
  });
}
