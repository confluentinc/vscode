import { Disposable } from "vscode";

import { ArtifactV1FlinkArtifactListDataInner } from "../clients/flinkArtifacts";
import { FcpmV2RegionListDataInner, ListFcpmV2RegionsRequest } from "../clients/flinkComputePool";
import { ListSqlv1StatementsRequest } from "../clients/flinkSql";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ccloudConnected } from "../emitters";
import { isResponseErrorWithStatus } from "../errors";
import { getCCloudResources } from "../graphql/ccloud";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { FlinkArtifact } from "../models/flinkArtifact";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement, restFlinkStatementToModel } from "../models/flinkStatement";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import { CCloudOrganization } from "../models/organization";
import { IFlinkQueryable } from "../models/resource";
import { CCloudSchemaRegistry } from "../models/schemaRegistry";
import { getSidecar, SidecarHandle } from "../sidecar";
import { ObjectSet } from "../utils/objectset";
import { executeInWorkerPool, ExecutionResult, extract } from "../utils/workerPool";
import { CachingResourceLoader } from "./cachingResourceLoader";

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

    this.registerEventListeners();
  }

  private registerEventListeners(): void {
    // When the ccloud connection state changes, reset the loader's state.
    const ccloudConnectedSub: Disposable = ccloudConnected.event(async (connected: boolean) => {
      await this.reset();

      if (connected) {
        // Start the coarse preloading process if we think we have a ccloud connection.
        await this.ensureCoarseResourcesLoaded();
      }
    });

    this.disposables.push(ccloudConnectedSub);
  }

  /** Fulfill ResourceLoader::getEnvironmentsFromGraphQL */
  protected async getEnvironmentsFromGraphQL(): Promise<CCloudEnvironment[]> {
    // Drive the GQL query.
    return await getCCloudResources();
  }

  /** Fulfill ResourceLoader::reset(), taking care of clearing in-memory cached organization. */
  public async reset(): Promise<void> {
    // Upcall, then also forget the organization (in memory only).
    await super.reset();
    // cached in memory only.
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
   * @returns The {@link CCloudOrganization} for the current CCloud connection, either from cached
   * value or deep fetch.
   */
  public async getOrganization(): Promise<CCloudOrganization | undefined> {
    if (this.organization) {
      return this.organization;
    }

    const organization = await getCurrentOrganization();
    if (organization) {
      this.organization = organization;
      return this.organization;
    }
    logger.withCallpoint("getOrganization()").error("No current organization found.");
  }

  /**
   * Convert the given CCloudEnvironment or CCloudFlinkComputePool
   * into a list of distinct IFlinkQueryable objects. Each object
   * will be for a separate provider-region pair within the environment.
   */
  public async determineFlinkQueryables(
    resource: CCloudEnvironment | CCloudFlinkComputePool,
  ): Promise<IFlinkQueryable[]> {
    const org: CCloudOrganization | undefined = await this.getOrganization();
    if (!org) {
      return [];
    }

    if (resource instanceof CCloudFlinkComputePool) {
      // If we have a single compute pool, just reexpress it.
      return [
        {
          organizationId: org.id,
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
          organizationId: org.id,
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

  /**
   * Reload the given Flink statement from the sidecar API.
   * @param statement The Flink statement to refresh.
   * @returns Updated Flink statement or null if it was not found.
   * @throws Error if there was an error while refreshing the Flink statement.
   */
  public async refreshFlinkStatement(statement: FlinkStatement): Promise<FlinkStatement | null> {
    const handle = await getSidecar();

    const statementsClient = handle.getFlinkSqlStatementsApi(statement);

    try {
      const routeResponse = await statementsClient.getSqlv1Statement({
        environment_id: statement.environmentId,
        organization_id: statement.organizationId,
        statement_name: statement.name,
      });
      return restFlinkStatementToModel(routeResponse, statement);
    } catch (error) {
      if (isResponseErrorWithStatus(error, 404)) {
        logger.info(`Flink statement ${statement.name} no longer exists`);
        return null;
      } else {
        logger.error(`Error while refreshing Flink statement ${statement.name} (${statement.id})`, {
          error,
        });
        throw error;
      }
    }
  }

  /**
   * Query the Flink artifacts for the given CCloud environment + provider-region.
   * @returns The Flink artifacts for the given environment + provider-region.
   * @param resource The CCloud compute pool or environment to get the Flink artifacts for.
   */
  public async getFlinkArtifacts(
    resource: CCloudEnvironment | CCloudFlinkComputePool,
  ): Promise<FlinkArtifact[]> {
    const queryables: IFlinkQueryable[] = await this.determineFlinkQueryables(resource);
    const handle = await getSidecar();

    // For each provider-region pair, get the Flink artifacts with reasonable concurrency.
    const concurrentResults: ExecutionResult<FlinkArtifact[]>[] = await executeInWorkerPool(
      (queryable: IFlinkQueryable) => loadArtifactsForProviderRegion(handle, queryable),
      queryables,
      { maxWorkers: 5 },
    );

    logger.debug(`getFlinkArtifacts() loaded ${concurrentResults.length} provider-region pairs`);

    // Assemble the results into a single array of Flink artifacts.
    const flinkArtifacts: FlinkArtifact[] = [];

    // extract will raise first error if any error was encountered.
    const blocks: FlinkArtifact[][] = extract(concurrentResults);
    for (const block of blocks) {
      flinkArtifacts.push(...block);
    }

    return flinkArtifacts;
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
async function loadArtifactsForProviderRegion(
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

      // Convert each Flink artifact from the REST API representation to our codebase model.
      for (const restArtifact of restResult.data) {
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
  });
}
