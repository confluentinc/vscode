import type { Disposable } from "vscode";

import { TokenManager } from "../authn/oauth2/tokenManager";
import { ContextValues, getContextValue } from "../context/values";
// ArtifactV1FlinkArtifactListDataInner import removed - sidecar migration (phase-6)
import type { FcpmV2RegionListDataInner } from "../clients/flinkComputePool";
import type { GetSqlv1Statement200Response } from "../clients/flinkSql";
// ListSqlv1StatementsRequest import removed - sidecar migration (phase-6)
import type { GetWsV1Workspace200Response } from "../clients/flinkWorkspaces";
import { ConnectionType } from "../connections";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ccloudConnected } from "../emitters";
import { createCCloudResourceFetcher } from "../fetchers";
import { getCurrentOrganization } from "../fetchers/organizationFetcher";
import type { FlinkWorkspaceParams } from "../flinkSql/flinkWorkspace";
import type { IFlinkStatementSubmitParameters } from "../flinkSql/statementUtils";
import {
  determineFlinkStatementName,
  parseAllFlinkStatementResults,
  refreshFlinkStatement,
  submitFlinkStatement,
  waitForStatementCompletion,
} from "../flinkSql/statementUtils";
import { Logger } from "../logging";
import type { CCloudEnvironment } from "../models/environment";
import type { FlinkAIAgent } from "../models/flinkAiAgent";
import type { FlinkAIConnection } from "../models/flinkAiConnection";
import type { FlinkAIModel } from "../models/flinkAiModel";
import type { FlinkAITool } from "../models/flinkAiTool";
import { FlinkArtifact } from "../models/flinkArtifact";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import type { FlinkDatabaseResource } from "../models/flinkDatabaseResource";
import type { FlinkRelation } from "../models/flinkRelation";
import type { FlinkStatement } from "../models/flinkStatement";
import { Phase, restFlinkStatementToModel } from "../models/flinkStatement";
import type { FlinkUdf } from "../models/flinkUDF";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import type { CCloudOrganization } from "../models/organization";
import type {
  EnvironmentId,
  IEnvProviderRegion,
  IFlinkQueryable,
  IProviderRegion,
} from "../models/resource";
import type { CCloudSchemaRegistry } from "../models/schemaRegistry";
import { createCCloudArtifactsProxy } from "../proxy/ccloudArtifactsProxy";
import { CCloudControlPlaneProxy } from "../proxy/ccloudControlPlaneProxy";
import {
  CCloudDataPlaneProxy,
  type FlinkStatement as FlinkStatementApi,
  type FlinkWorkspace,
} from "../proxy/ccloudDataPlaneProxy";
import { buildFlinkDataPlaneBaseUrl } from "../proxy/flinkDataPlaneUrlBuilder";
import { WorkspaceStorageKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";
import { ObjectSet } from "../utils/objectset";
import { CachingResourceLoader } from "./cachingResourceLoader";
import type { RawFlinkAIAgentRow } from "./utils/flinkAiAgentsQuery";
import { getFlinkAIAgentsQuery, transformRawFlinkAIAgentRows } from "./utils/flinkAiAgentsQuery";
import type { RawFlinkAIConnectionRow } from "./utils/flinkAiConnectionsQuery";
import {
  getFlinkAIConnectionsQuery,
  transformRawFlinkAIConnectionRows,
} from "./utils/flinkAiConnectionsQuery";
import type { RawFlinkAIModelRow } from "./utils/flinkAiModelsQuery";
import { getFlinkAIModelsQuery, transformRawFlinkAIModelRows } from "./utils/flinkAiModelsQuery";
import type { RawFlinkAIToolRow } from "./utils/flinkAiToolsQuery";
import { getFlinkAIToolsQuery, transformRawFlinkAIToolRows } from "./utils/flinkAiToolsQuery";
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
 * Converts a FlinkStatement from the proxy to the client type format.
 * This ensures type compatibility with restFlinkStatementToModel.
 *
 * Note: We use type assertions here because the proxy types have optional
 * values where the client types expect required values. The actual data
 * from the API is structurally compatible.
 */
function proxyStatementToClientFormat(stmt: FlinkStatementApi): GetSqlv1Statement200Response {
  // Convert metadata with proper date handling
  const metadata: GetSqlv1Statement200Response["metadata"] = stmt.metadata
    ? {
        self: stmt.metadata.self ?? "",
        created_at: stmt.metadata.created_at ? new Date(stmt.metadata.created_at) : undefined,
        updated_at: stmt.metadata.updated_at ? new Date(stmt.metadata.updated_at) : undefined,
        resource_version: stmt.metadata.resource_version,
      }
    : { self: "" };

  // Convert status with proper date handling for scaling_status
  const status: GetSqlv1Statement200Response["status"] = stmt.status
    ? {
        phase: stmt.status.phase ?? "PENDING",
        detail: stmt.status.detail,
        // Use type assertion for traits since the structure is compatible
        traits: stmt.status.traits as GetSqlv1Statement200Response["status"]["traits"],
        network_kind: stmt.status.network_kind,
        latest_offsets: stmt.status.latest_offsets,
        latest_offsets_timestamp: stmt.status.latest_offsets_timestamp
          ? new Date(stmt.status.latest_offsets_timestamp)
          : undefined,
        scaling_status: stmt.status.scaling_status
          ? {
              scaling_state: stmt.status.scaling_status.scaling_state,
              last_updated: stmt.status.scaling_status.last_updated
                ? new Date(stmt.status.scaling_status.last_updated)
                : undefined,
            }
          : undefined,
      }
    : { phase: "PENDING" };

  // Use type assertion to bypass readonly properties that can't be set
  return {
    api_version: "sql/v1",
    kind: "Statement",
    name: stmt.name,
    organization_id: stmt.organization_id,
    environment_id: stmt.environment_id,
    metadata,
    spec: stmt.spec ?? {},
    status,
  } as GetSqlv1Statement200Response;
}

/** Flink SQL statement kinds for which we skip fetching results */
export const SKIP_RESULTS_SQL_KINDS: string[] = ["CREATE_FUNCTION"];

/** Options for executing a background Flink statement. */
export interface ExecuteBackgroundStatementOptions {
  computePool?: CCloudFlinkComputePool;
  timeout?: number;
  nameSpice?: string;
}

/**
 * Dependencies for statement execution, allowing injection for testing.
 */
export interface StatementExecutionDeps {
  submitFlinkStatement: typeof submitFlinkStatement;
  waitForStatementCompletion: typeof waitForStatementCompletion;
  parseAllFlinkStatementResults: typeof parseAllFlinkStatementResults;
}

/** Default production dependencies for statement execution. */
const defaultStatementDeps: StatementExecutionDeps = {
  submitFlinkStatement,
  waitForStatementCompletion,
  parseAllFlinkStatementResults,
};

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

    // Only preload if we think we're connected AND actually have a valid session.
    // This guards against race conditions during sign-out where the event fires
    // before the context value is fully updated.
    // Note: We check the context value directly here instead of importing hasCCloudAuthSession()
    // to avoid a circular dependency (ccloudSession.ts imports CCloudResourceLoader).
    const hasAuthSession = !!getContextValue(ContextValues.ccloudConnectionAvailable);
    if (connected && hasAuthSession) {
      await this.ensureCoarseResourcesLoaded();
    }
  }

  /** Fulfill ResourceLoader::getEnvironmentsFromGraphQL */
  protected async getEnvironmentsFromGraphQL(): Promise<CCloudEnvironment[]> {
    logger.debug("Using internal fetcher for CCloud resources");
    const fetcher = createCCloudResourceFetcher({
      getAccessToken: async () => {
        // Get the control plane token from TokenManager, not the session
        // The session.accessToken is just a placeholder connection ID
        const tokenManager = TokenManager.getInstance();
        return (await tokenManager.getControlPlaneToken()) ?? undefined;
      },
    });
    return await fetcher.fetchEnvironments();
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
   * @param resource The CCloud environment or compute pool to get the Flink statements for.
   */
  public async getFlinkStatements(
    resource: CCloudEnvironment | CCloudFlinkComputePool,
  ): Promise<FlinkStatement[]> {
    const org = await this.getOrganization();
    if (!org) {
      logger.warn("getFlinkStatements: Not connected to CCloud");
      return [];
    }

    // Get auth token
    const tokenManager = TokenManager.getInstance();
    const dataPlaneToken = await tokenManager.getDataPlaneToken();
    if (!dataPlaneToken) {
      logger.warn("getFlinkStatements: Failed to get data plane token");
      return [];
    }

    // Determine queryable regions based on resource type
    const queryables = await this.determineFlinkQueryables(resource);
    if (queryables.length === 0) {
      logger.debug("getFlinkStatements: No queryable regions found for resource");
      return [];
    }

    const allStatements: FlinkStatement[] = [];

    // Fetch statements from each provider-region
    for (const queryable of queryables) {
      try {
        const baseUrl = buildFlinkDataPlaneBaseUrl(
          queryable.provider,
          queryable.region,
          queryable.environmentId,
        );

        const proxy = new CCloudDataPlaneProxy({
          baseUrl,
          organizationId: queryable.organizationId,
          environmentId: queryable.environmentId,
          auth: {
            type: "bearer",
            token: dataPlaneToken,
          },
        });

        // Fetch statements, optionally filtering by compute pool
        const statements = await proxy.fetchAllStatements({
          computePoolId: queryable.computePoolId,
          // Exclude hidden statements (system queries)
          labelSelector: "user.confluent.io/hidden!=true",
        });

        // Convert to our model format
        for (const apiStatement of statements) {
          const statement = restFlinkStatementToModel(proxyStatementToClientFormat(apiStatement), {
            provider: queryable.provider,
            region: queryable.region,
          });
          allStatements.push(statement);
        }
      } catch (error) {
        // Extract error details since Error objects don't serialize well to JSON
        const errorDetails =
          error instanceof Error
            ? { name: error.name, message: error.message, cause: error.cause }
            : { value: String(error) };
        logger.error(
          `Failed to fetch Flink statements for ${queryable.provider}-${queryable.region}`,
          errorDetails,
        );
        // Continue with other regions even if one fails
      }
    }

    logger.debug(`Fetched ${allStatements.length} Flink statements`);
    return allStatements;
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
   * Delete the given Flink statement via the Flink SQL API.
   * @param statement The Flink statement to delete.
   */
  public async deleteFlinkStatement(statement: FlinkStatement): Promise<void> {
    // Get auth token
    const tokenManager = TokenManager.getInstance();
    const dataPlaneToken = await tokenManager.getDataPlaneToken();
    if (!dataPlaneToken) {
      throw new Error("Failed to get data plane token for Flink SQL API");
    }

    // Build the Flink Data Plane API base URL
    const baseUrl = buildFlinkDataPlaneBaseUrl(
      statement.provider,
      statement.region,
      statement.environmentId,
    );

    // Create the proxy instance
    const proxy = new CCloudDataPlaneProxy({
      baseUrl,
      organizationId: statement.organizationId,
      environmentId: statement.environmentId,
      auth: {
        type: "bearer",
        token: dataPlaneToken,
      },
    });

    logger.debug(`Deleting Flink statement "${statement.name}"`);
    await proxy.deleteStatement(statement.name);
  }

  /**
   * Stop a currently running Flink statement.
   * @param statement The Flink statement to stop.
   */
  public async stopFlinkStatement(statement: FlinkStatement): Promise<void> {
    // Get auth token
    const tokenManager = TokenManager.getInstance();
    const dataPlaneToken = await tokenManager.getDataPlaneToken();
    if (!dataPlaneToken) {
      throw new Error("Failed to get data plane token for Flink SQL API");
    }

    // Build the Flink Data Plane API base URL
    const baseUrl = buildFlinkDataPlaneBaseUrl(
      statement.provider,
      statement.region,
      statement.environmentId,
    );

    // Create the proxy instance
    const proxy = new CCloudDataPlaneProxy({
      baseUrl,
      organizationId: statement.organizationId,
      environmentId: statement.environmentId,
      auth: {
        type: "bearer",
        token: dataPlaneToken,
      },
    });

    logger.debug(`Stopping Flink statement "${statement.name}"`);
    await proxy.stopStatement(statement.name);
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
    const rm = getResourceManager();
    const cacheKey: IEnvProviderRegion = {
      environmentId: resource.environmentId,
      provider: resource.provider,
      region: resource.region,
    };

    // Check cache first
    if (!forceDeepRefresh) {
      const cachedArtifacts = await rm.getFlinkArtifacts(cacheKey);
      if (cachedArtifacts !== undefined) {
        return cachedArtifacts;
      }
    }

    // Deep fetch from the API
    const token = await TokenManager.getInstance().getDataPlaneToken();
    if (!token) {
      logger.warn("getFlinkArtifacts: Not authenticated to Confluent Cloud");
      return [];
    }

    const proxy = createCCloudArtifactsProxy({
      baseUrl: "https://api.confluent.cloud",
      auth: {
        type: "bearer",
        token,
      },
    });

    try {
      const apiArtifacts = await proxy.fetchAllArtifacts({
        cloud: resource.provider,
        region: resource.region,
        environment: resource.environmentId,
      });

      // Convert API data to FlinkArtifact model instances
      const artifacts: FlinkArtifact[] = apiArtifacts.map(
        (data) =>
          new FlinkArtifact({
            connectionId: this.connectionId,
            connectionType: this.connectionType,
            environmentId: data.environment as EnvironmentId,
            id: data.id,
            name: data.display_name,
            description: data.description ?? "",
            provider: data.cloud,
            region: data.region,
            documentationLink: data.documentation_link ?? "",
            metadata: {
              self: data.metadata?.self,
              resource_name: data.metadata?.resource_name,
              created_at: data.metadata?.created_at
                ? new Date(data.metadata.created_at)
                : undefined,
              updated_at: data.metadata?.updated_at
                ? new Date(data.metadata.updated_at)
                : undefined,
              deleted_at: data.metadata?.deleted_at
                ? new Date(data.metadata.deleted_at)
                : undefined,
            },
          }),
      );

      // Cache the results
      await rm.setFlinkArtifacts(cacheKey, artifacts);

      return artifacts;
    } catch (error) {
      logger.error("getFlinkArtifacts: Failed to fetch artifacts from CCloud API", { error });
      return [];
    }
  }

  /**
   * Generic method to get Flink database resources (UDFs, AI models, etc.) for a given Flink database,
   * with caching via the ResourceManager.
   *
   * @param database The Flink database to get the resources for.
   * @param storageKey The workspace storage key to use for caching the resources.
   * @param statementQuery The SQL statement to execute to list the resources.
   * @param transformer Function to transform raw result rows into resource model instances.
   * @param forceDeepRefresh Whether to bypass the ResourceManager cache and fetch fresh data.
   * @param statementOptions Optional parameters for statement execution
   * @returns Array of {@link FlinkDatabaseResource} objects representing the resources in the database.
   */
  private async getFlinkDatabaseResources<R, T extends FlinkDatabaseResource>(
    database: CCloudFlinkDbKafkaCluster,
    storageKey: WorkspaceStorageKeys,
    statementQuery: string,
    transformer: (database: CCloudFlinkDbKafkaCluster, raw: R[]) => T[],
    forceDeepRefresh: boolean,
    statementOptions?: ExecuteBackgroundStatementOptions,
  ): Promise<T[]> {
    const rm = getResourceManager();

    let resources: T[] | undefined = await rm.getFlinkDatabaseResources<T>(database, storageKey);
    if (resources === undefined || forceDeepRefresh) {
      // nothing cached yet (or asked to forced refresh), so run the statement to list resources
      const rawResults: R[] = await this.executeBackgroundFlinkStatement<R>(
        statementQuery,
        database,
        statementOptions,
      );
      // convert to resource model instances and cache for later
      resources = transformer(database, rawResults);
      await rm.setFlinkDatabaseResources<T>(database, storageKey, resources);
    }
    return resources;
  }

  /**
   * Get the tables / views / columns of a given Flink database via system catalog queries.
   *
   * @param database The Flink database to get the relations and columns for.
   * @param forceDeepRefresh Whether to bypass the ResourceManager cache and fetch fresh data.
   * @returns Array of {@link FlinkRelation} objects representing the relations in the cluster.
   */
  public async getFlinkRelations(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkRelation[]> {
    const query: string = getRelationsAndColumnsSystemCatalogQuery(database);

    const results: FlinkRelation[] = await this.getFlinkDatabaseResources<
      RawRelationsAndColumnsRow,
      FlinkRelation
    >(
      database,
      WorkspaceStorageKeys.FLINK_RELATIONS,
      query,
      parseRelationsAndColumnsSystemCatalogQueryResponse,
      forceDeepRefresh,
    );
    return results;
  }

  /**
   * Get the Flink UDFs for the given Flinkable database.
   *
   * @param database The Flink database to get the UDFs for.
   * @param forceDeepRefresh Whether to bypass the ResourceManager cache and fetch fresh data.
   * @returns Array of {@link FlinkUdf} objects representing the UDFs in the cluster.
   */
  public async getFlinkUDFs(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkUdf[]> {
    const query: string = getUdfSystemCatalogQuery(database);

    const results: FlinkUdf[] = await this.getFlinkDatabaseResources<
      RawUdfSystemCatalogRow,
      FlinkUdf
    >(
      database,
      WorkspaceStorageKeys.FLINK_UDFS,
      query,
      transformUdfSystemCatalogRows,
      forceDeepRefresh,
      { nameSpice: "list-udfs" },
    );
    return results;
  }

  /**
   * Get the Flink AI models for a CCloud Flink database.
   *
   * @param database The Flink database to get the models for.
   * @param forceDeepRefresh Whether to bypass the ResourceManager cache and fetch fresh data.
   * @returns Array of {@link FlinkAIModel} objects representing the AI models in the cluster.
   */
  public async getFlinkAIModels(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkAIModel[]> {
    const query: string = getFlinkAIModelsQuery(database);

    const results: FlinkAIModel[] = await this.getFlinkDatabaseResources<
      RawFlinkAIModelRow,
      FlinkAIModel
    >(
      database,
      WorkspaceStorageKeys.FLINK_AI_MODELS,
      query,
      transformRawFlinkAIModelRows,
      forceDeepRefresh,
      { nameSpice: "list-models" },
    );
    return results;
  }

  /**
   * Get the Flink AI tools for a CCloud Flink database.
   *
   * @param database The Flink database to get the tools for.
   * @param forceDeepRefresh Whether to bypass the ResourceManager cache and fetch fresh data.
   * @returns Array of {@link FlinkAITool} objects representing the AI tools in the cluster.
   */
  public async getFlinkAITools(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkAITool[]> {
    const query: string = getFlinkAIToolsQuery(database);

    const results: FlinkAITool[] = await this.getFlinkDatabaseResources<
      RawFlinkAIToolRow,
      FlinkAITool
    >(
      database,
      WorkspaceStorageKeys.FLINK_AI_TOOLS,
      query,
      transformRawFlinkAIToolRows,
      forceDeepRefresh,
      { nameSpice: "list-tools" },
    );
    return results;
  }

  /**
   * Get the Flink AI connections for a CCloud Flink database.
   *
   * @param database The Flink database to get the connections for.
   * @param forceDeepRefresh Whether to bypass the ResourceManager cache and fetch fresh data.
   * @returns Array of {@link FlinkAIConnection} objects representing the AI connections in the cluster.
   */
  public async getFlinkAIConnections(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkAIConnection[]> {
    const query: string = getFlinkAIConnectionsQuery(database);

    const results: FlinkAIConnection[] = await this.getFlinkDatabaseResources<
      RawFlinkAIConnectionRow,
      FlinkAIConnection
    >(
      database,
      WorkspaceStorageKeys.FLINK_AI_CONNECTIONS,
      query,
      transformRawFlinkAIConnectionRows,
      forceDeepRefresh,
      { nameSpice: "list-connections" },
    );
    return results;
  }

  /**
   * Get the Flink AI agents for a CCloud Flink database.
   *
   * @param database The Flink database to get the agents for.
   * @param forceDeepRefresh Whether to bypass the ResourceManager cache and fetch fresh data.
   * @returns Array of {@link FlinkAIAgent} objects representing the AI agents in the cluster.
   */
  public async getFlinkAIAgents(
    database: CCloudFlinkDbKafkaCluster,
    forceDeepRefresh: boolean,
  ): Promise<FlinkAIAgent[]> {
    const query: string = getFlinkAIAgentsQuery(database);

    const results: FlinkAIAgent[] = await this.getFlinkDatabaseResources<
      RawFlinkAIAgentRow,
      FlinkAIAgent
    >(
      database,
      WorkspaceStorageKeys.FLINK_AI_AGENTS,
      query,
      transformRawFlinkAIAgentRows,
      forceDeepRefresh,
      { nameSpice: "list-agents" },
    );
    return results;
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
   * @param deps Optional dependencies for testing (defaults to production implementations).
   * @returns Array of results, each of type RT (generic type parameter) corresponding to the result row structure from the query.
   *
   */
  async executeBackgroundFlinkStatement<RT>(
    sqlStatement: string,
    database: CCloudFlinkDbKafkaCluster,
    options: ExecuteBackgroundStatementOptions = {},
    deps: StatementExecutionDeps = defaultStatementDeps,
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
    const statementPromise = this.doExecuteBackgroundFlinkStatement<RT>(
      statementParams,
      deps,
    ).finally(() => {
      // When the promise settles (either resolves or rejects), remove it from the map of pending promises.
      this.backgroundStatementPromises.delete(promiseKey);
    });

    this.backgroundStatementPromises.set(promiseKey, statementPromise);

    return statementPromise;
  }

  /** Actual implementation of executeBackgroundFlinkStatement(), without deduplication logic. */
  private async doExecuteBackgroundFlinkStatement<RT>(
    statementParams: IFlinkStatementSubmitParameters,
    deps: StatementExecutionDeps,
  ): Promise<Array<RT>> {
    const computePool = statementParams.computePool;
    logger.info(
      `Executing Flink statement on ${computePool?.provider}-${computePool?.region} in environment ${computePool?.environmentId} : ${statementParams.statement}`,
    );

    let statement = await deps.submitFlinkStatement(statementParams);

    // Refresh the statement at 150ms intervals for at most 10s until it is in a terminal phase.
    const timeout = statementParams.timeout ?? 10_000;
    statement = await deps.waitForStatementCompletion(statement, timeout, 150);

    if (statement.phase !== Phase.COMPLETED) {
      logger.error(
        `Statement ${statement.id} did not complete successfully, phase ${statement.phase}`,
      );
      throw new Error(
        `Statement did not complete successfully, phase ${statement.phase}. Error detail: ${statement.status.detail}`,
      );
    }

    let resultRows: Array<RT> = [];
    if (statement.sqlKind && SKIP_RESULTS_SQL_KINDS.includes(statement.sqlKind)) {
      logger.debug(
        `Skipping fetching results for statement ${statement.id} of kind ${statement.sqlKind}`,
      );
    } else {
      resultRows = await deps.parseAllFlinkStatementResults<RT>(statement);
    }

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

  /**
   * Fetch a Flink workspace from the API.
   * Uses the provider/region from the params to query the region-scoped Workspaces API directly.
   *
   * @param params Workspace parameters containing environmentId, organizationId, workspaceName, provider, and region
   * @returns The workspace response if found, null otherwise
   */
  public async getFlinkWorkspace(
    params: FlinkWorkspaceParams,
  ): Promise<GetWsV1Workspace200Response | null> {
    const token = await TokenManager.getInstance().getDataPlaneToken();
    if (!token) {
      logger.warn("getFlinkWorkspace: Not authenticated to Confluent Cloud");
      return null;
    }

    // Build the regional Flink Data Plane API base URL
    const baseUrl = buildFlinkDataPlaneBaseUrl(
      params.provider,
      params.region,
      params.environmentId,
    );

    // Create the proxy instance
    const proxy = new CCloudDataPlaneProxy({
      baseUrl,
      organizationId: params.organizationId,
      environmentId: params.environmentId,
      auth: {
        type: "bearer",
        token,
      },
    });

    try {
      const workspace = await proxy.getWorkspace(params.workspaceName);
      // Convert the FlinkWorkspace to GetWsV1Workspace200Response format
      return this.convertWorkspaceToResponse(workspace, params);
    } catch (error) {
      logger.error("getFlinkWorkspace: Failed to fetch workspace", {
        workspaceName: params.workspaceName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Convert a FlinkWorkspace from the proxy to the GetWsV1Workspace200Response format.
   */
  private convertWorkspaceToResponse(
    workspace: FlinkWorkspace,
    params: FlinkWorkspaceParams,
  ): GetWsV1Workspace200Response {
    return {
      api_version: "ws/v1" as any,
      kind: "Workspace" as any,
      name: workspace.name ?? params.workspaceName,
      organization_id: workspace.organization_id ?? params.organizationId,
      environment_id: workspace.environment_id ?? params.environmentId,
      metadata: workspace.metadata ?? {},
      spec: {
        display_name: workspace.spec?.name,
        compute_pool: workspace.spec?.compute_pool,
        statements:
          workspace.spec?.blocks?.map((block) => ({
            sql: block.content,
          })) ?? [],
      },
      status: workspace.status
        ? {
            phase: workspace.status.phase,
          }
        : undefined,
    } as GetWsV1Workspace200Response;
  }
}

// TODO: loadStatementsForProviderRegion removed during sidecar migration (phase-6)
// Previously used SidecarHandle to load Flink statements. Will be reimplemented
// with direct HTTP client to CCloud Flink SQL API.

/**
 * Load artifacts for a single provider/region.
 * Fetches Flink artifacts from the CCloud Artifacts API.
 * @param _handle Unused, kept for backward compatibility
 * @param queryable The Flink queryable context (environment, provider, region)
 * @returns Array of FlinkArtifact models
 */
export async function loadArtifactsForProviderRegion(
  _handle: unknown,
  queryable: IFlinkQueryable,
): Promise<FlinkArtifact[]> {
  const token = await TokenManager.getInstance().getDataPlaneToken();
  if (!token) {
    logger.warn("loadArtifactsForProviderRegion: Not authenticated to Confluent Cloud");
    return [];
  }

  const proxy = createCCloudArtifactsProxy({
    baseUrl: "https://api.confluent.cloud",
    auth: {
      type: "bearer",
      token,
    },
  });

  try {
    const apiArtifacts = await proxy.fetchAllArtifacts({
      cloud: queryable.provider,
      region: queryable.region,
      environment: queryable.environmentId,
    });

    // Convert API data to FlinkArtifact model instances
    return apiArtifacts.map(
      (data) =>
        new FlinkArtifact({
          connectionId: CCLOUD_CONNECTION_ID,
          connectionType: ConnectionType.Ccloud,
          environmentId: data.environment as EnvironmentId,
          id: data.id,
          name: data.display_name,
          description: data.description ?? "",
          provider: data.cloud,
          region: data.region,
          documentationLink: data.documentation_link ?? "",
          metadata: {
            self: data.metadata?.self,
            resource_name: data.metadata?.resource_name,
            created_at: data.metadata?.created_at ? new Date(data.metadata.created_at) : undefined,
            updated_at: data.metadata?.updated_at ? new Date(data.metadata.updated_at) : undefined,
            deleted_at: data.metadata?.deleted_at ? new Date(data.metadata.deleted_at) : undefined,
          },
        }),
    );
  } catch (error) {
    logger.error("loadArtifactsForProviderRegion: Failed to fetch artifacts from CCloud API", {
      error,
    });
    return [];
  }
}

/**
 * Load all available cloud provider/region combinations from the FCPM API.
 * @param cloud Optional cloud provider filter (aws, azure, gcp).
 * @returns Array of Flink region data from the API.
 */
export async function loadProviderRegions(cloud?: string): Promise<FcpmV2RegionListDataInner[]> {
  const token = await TokenManager.getInstance().getControlPlaneToken();
  if (!token) {
    logger.warn("loadProviderRegions: Not authenticated to Confluent Cloud");
    return [];
  }

  const proxy = new CCloudControlPlaneProxy({
    baseUrl: "https://api.confluent.cloud",
    auth: {
      type: "bearer",
      token,
    },
  });

  try {
    const regions = await proxy.fetchAllFlinkRegions(cloud);
    // Convert CCloudFlinkRegionData to FcpmV2RegionListDataInner for compatibility
    return regions.map(
      (region): FcpmV2RegionListDataInner => ({
        id: region.id,
        api_version: region.api_version as any,
        kind: region.kind as any,
        metadata: {
          self: region.metadata?.self ?? "",
        },
        display_name: region.display_name ?? "",
        cloud: region.cloud ?? "",
        region_name: region.region_name ?? "",
        http_endpoint: region.http_endpoint ?? "",
        private_http_endpoint: region.private_http_endpoint,
      }),
    );
  } catch (error) {
    logger.error("loadProviderRegions: Failed to fetch regions from CCloud API", { error });
    return [];
  }
}

// TODO: restFlinkArtifactToModel removed during sidecar migration (phase-6)
// Will be reimplemented when direct Flink Artifacts API integration is added.
