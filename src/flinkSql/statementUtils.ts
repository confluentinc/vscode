import * as vscode from "vscode";
import { TokenManager } from "../authn/oauth2/tokenManager";
import type { GetSqlv1Statement200Response } from "../clients/flinkSql";
import { uriMetadataSet } from "../emitters";
import { FLINK_CONFIG_STATEMENT_PREFIX } from "../extensionSettings/constants";
import { Logger } from "../logging";
import type { CCloudEnvironment } from "../models/environment";
import type { CCloudFlinkComputePool } from "../models/flinkComputePool";
import type { FlinkSpecProperties, FlinkStatement } from "../models/flinkStatement";
import { restFlinkStatementToModel, TERMINAL_PHASES } from "../models/flinkStatement";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import {
  CCloudDataPlaneProxy,
  type FlinkStatementResult,
  type FlinkStatement as FlinkStatementApi,
} from "../proxy/ccloudDataPlaneProxy";
import { buildFlinkDataPlaneBaseUrl } from "../proxy/flinkDataPlaneUrlBuilder";
import { HttpError } from "../proxy/httpClient";
import { UriMetadataKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";
import type { UriMetadata } from "../storage/types";
import { WebviewPanelCache } from "../webview-cache";
import flinkStatementResults from "../webview/flink-statement-results.html";
import { extractPageToken } from "./utils";

const logger = new Logger("flinksql/statements");

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

export interface IFlinkStatementSubmitParameters {
  /** The SQL statement to submit */
  statement: string;

  /** Name for the statement */
  statementName: string;

  /** Where to get it evaluated */
  computePool: CCloudFlinkComputePool;

  /** What organization id to submit the statement as? */
  organizationId: string;

  /** Metadata hints for the statement execution */
  properties: FlinkSpecProperties;

  /**
   * False if user directly gestured / wrote this statement, true if it was created by the extension
   * (system catalog queries to support our view providers, ...).
   */
  hidden: boolean;

  /** Optional timeout override in milliseconds */
  timeout?: number;
}

export async function submitFlinkStatement(
  params: IFlinkStatementSubmitParameters,
): Promise<FlinkStatement> {
  const { computePool, organizationId, statementName, statement, properties, hidden } = params;

  // Get auth token
  const tokenManager = TokenManager.getInstance();
  const dataPlaneToken = await tokenManager.getDataPlaneToken();
  if (!dataPlaneToken) {
    throw new Error("Failed to get data plane token for Flink SQL API");
  }

  // Build the Flink Data Plane API base URL
  const baseUrl = buildFlinkDataPlaneBaseUrl(
    computePool.provider,
    computePool.region,
    computePool.environmentId,
  );

  // Create the proxy instance
  const proxy = new CCloudDataPlaneProxy({
    baseUrl,
    organizationId,
    environmentId: computePool.environmentId,
    auth: {
      type: "bearer",
      token: dataPlaneToken,
    },
  });

  logger.debug("Submitting Flink statement", {
    name: statementName,
    computePool: computePool.id,
    region: `${computePool.provider}-${computePool.region}`,
    hidden,
  });

  // Build statement properties, filtering out undefined values
  const rawProperties = properties.toProperties ? properties.toProperties() : properties;
  const statementProperties: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawProperties)) {
    if (value !== undefined) {
      statementProperties[key] = value;
    }
  }

  // Build labels if hidden (metadata, not SQL config options)
  const labels = hidden ? { "user.confluent.io/hidden": "true" } : undefined;

  // Create the statement
  const createdStatement = await proxy.createStatement({
    name: statementName,
    statement,
    computePoolId: computePool.id,
    properties: statementProperties,
    labels,
  });

  // Convert API response to our model
  return restFlinkStatementToModel(proxyStatementToClientFormat(createdStatement), {
    provider: computePool.provider,
    region: computePool.region,
  });
}

/** Poll period in millis to check whether statement has reached results-viewable state */
const DEFAULT_POLL_PERIOD_MS = 300;

/** Max time in millis to wait until statement reaches results-viewable state */
export const MAX_WAIT_TIME_MS = 60_000;

/**
 * Wait for a Flink statement to enter into a state where results can be fetched -- start running, completed, and is
 * within the age limit for results to be viewable.
 *
 * @param statement The Flink statement to monitor
 * @returns Promise that resolves when the statement enters a phase where results can (try to) be fetched w/o error.
 * @throws Error if statement doesn't fulfil `statement.canRequestResults` within MAX_WAIT_TIME_MS seconds, or if it is not found.
 */
export async function waitForResultsFetchable(statement: FlinkStatement): Promise<FlinkStatement> {
  return waitForStatementState(statement, (s) => s.canRequestResults);
}

/**
 * Wait for a submitted Flink statement to change to a terminal phase (completed, stopped, or failed).
 * @returns Promise that resolves to the statement when it has entered a terminal phase.
 */
export async function waitForStatementCompletion(
  statement: FlinkStatement,
  maxWaitTimeMs: number = MAX_WAIT_TIME_MS,
  pollingIntervalMs: number = DEFAULT_POLL_PERIOD_MS,
): Promise<FlinkStatement> {
  return waitForStatementState(
    statement,
    (s) => TERMINAL_PHASES.includes(s.phase),
    maxWaitTimeMs,
    pollingIntervalMs,
  );
}

/**
 * Wait for a Flink statement to enter any given state as determined by the provided predicate.
 *
 * @param statement The Flink statement to monitor
 * @param predicate A function that takes a Flink statement and returns true if the statement is in the desired state.
 * @param maxWaitTimeMs Maximum time to wait in milliseconds. Defaults to MAX_WAIT_TIME_MS.
 * @param pollingIntervalMs Time between polls in milliseconds. Defaults to DEFAULT_POLL_PERIOD_MS.
 * @returns Promise that resolves when the statement passes the predicate check, returning the updated statement.
 * @throws Error if statement doesn't fulfill the predicate within maxWaitTimeMs seconds, or if the statement is not found, or
 * if the predicate itself throws an error.
 */
async function waitForStatementState(
  statement: FlinkStatement,
  predicate: (s: FlinkStatement) => boolean,
  maxWaitTimeMs: number = MAX_WAIT_TIME_MS,
  pollingIntervalMs: number = DEFAULT_POLL_PERIOD_MS,
): Promise<FlinkStatement> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTimeMs) {
    // Check if the statement is in a viewable state
    const refreshedStatement = await refreshFlinkStatement(statement);

    if (!refreshedStatement) {
      // if the statement is no longer found, break to raise error
      logger.warn(`waitForStatementRunning: statement "${statement.name}" not found`);
      throw new Error(`Statement ${statement.name} no longer exists.`);
    }

    if (predicate(refreshedStatement)) {
      return refreshedStatement;
    }

    // Wait pollingIntervalMs before polling again
    await new Promise((resolve) => setTimeout(resolve, pollingIntervalMs));
  }

  throw new Error(
    `Statement ${statement.name} did not reach desired state within ${maxWaitTimeMs / 1000} seconds`,
  );
}

/**
 * Return a suitable (and unique) name for a Flink statement to submit.
 *
 * @param statement
 * @returns string akin to "username-vscode-2023-10-01t12-00-00"
 */
export async function determineFlinkStatementName(spice?: string): Promise<string> {
  const parts: string[] = [];

  // Fetch the user-configured prefix for statements, if any.
  const statementPrefix = FLINK_CONFIG_STATEMENT_PREFIX.value;
  if (statementPrefix) {
    parts.push(statementPrefix);
  }

  parts.push("vscode");
  if (spice) {
    parts.push(spice);
  }
  const dateString = new Date().toISOString().replace(/:/g, "-").replace(/\..*$/, "");
  parts.push(dateString);

  const proposed = parts
    .join("-")
    // Can only be lowercase; probably to simplify the uniqueness check on the backend.
    .toLocaleLowerCase()
    // Strip any non-alphanumeric characters, except for hyphens.
    .replace(/[^a-z0-9-]/g, "")
    // Strip leading numeric characters and hyphens.
    .replace(/^[0-9-]+/, "");

  return proposed;
}

/** Subclass of WebviewPanelCache for managing Flink statement results panels */
export class FlinkStatementWebviewPanelCache extends WebviewPanelCache {
  /** Convienence driver of WebviewPanelCache.findOrCreate() tailored for Flink Statement results viewers */
  getPanelForStatement(statement: FlinkStatement): [vscode.WebviewPanel, boolean] {
    return this.findOrCreate(
      {
        id: `${statement.environmentId}/${statement.name}`,
        template: flinkStatementResults,
      },
      "flink-statement-results",
      `Statement: ${statement.name}`,
      vscode.ViewColumn.One,
      { enableScripts: true },
    );
  }
}

/**
 * The max amount of time to wait for the route call used when
 * refreshing a Flink statement to complete, in milliseconds.
 *
 * Two seconds.
 */
export const REFRESH_STATEMENT_MAX_WAIT_MS = 2_000;

/**
 * Re-fetch the provided FlinkStatement, returning an updated version if possible.
 *
 * @param statement The Flink statement to refresh.
 * @returns Updated Flink statement or null if it was not found.
 * @throws Error if there was an error while refreshing the Flink statement.
 */
export async function refreshFlinkStatement(
  statement: FlinkStatement,
): Promise<FlinkStatement | null> {
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
    timeout: REFRESH_STATEMENT_MAX_WAIT_MS,
  });

  try {
    const apiStatement = await proxy.getStatement(statement.name);

    // Convert API response to our model
    return restFlinkStatementToModel(proxyStatementToClientFormat(apiStatement), {
      provider: statement.provider,
      region: statement.region,
    });
  } catch (error) {
    // Return null if statement not found (404)
    if (error instanceof HttpError && error.status === 404) {
      logger.debug(`Statement "${statement.name}" not found (404)`);
      return null;
    }
    throw error;
  }
}

/**
 * Consume all of the results from a Flink statement, handling pagination as needed.
 * Drives the underlying parseResults() function to accumulate results, then
 * extracts and returns them as an array of objects of type RT.
 *
 * @param statement - The Flink statement whose results are to be parsed.
 * @returns Array of results, each of type RT (generic type parameter) corresponding to the result row structure of the query.
 */
export async function parseAllFlinkStatementResults<RT>(
  statement: FlinkStatement,
): Promise<Array<RT>> {
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

  // Get the schema columns for parsing results
  const columns = statement.status?.traits?.schema?.columns ?? [];

  // Fetch all result pages
  const allResults: RT[] = [];
  let pageToken: string | undefined;

  do {
    const response: FlinkStatementResult = await proxy.getStatementResults(
      statement.name,
      pageToken,
    );

    // Parse the results from this page
    const rows = response.results?.data ?? [];
    for (const row of rows) {
      if (row.row) {
        // Convert row array to object using column names
        const resultObj: Record<string, unknown> = {};
        for (let i = 0; i < columns.length && i < row.row.length; i++) {
          const columnName = columns[i]?.name;
          if (columnName) {
            resultObj[columnName] = row.row[i];
          }
        }
        allResults.push(resultObj as RT);
      }
    }

    // Get next page token
    pageToken = extractPageToken(response.metadata?.next);
  } while (pageToken);

  logger.debug(`Parsed ${allResults.length} results from statement "${statement.name}"`);
  return allResults;
}

/**
 * Set or reset the Flink-related metadata on a document to refer to
 * the given environment, database, and/or compute pool. Handles setting
 * the metadata, then fires uriMetadataSet to notify listeners of the change.
 *
 * @param documentUri: The URI of the document to update.
 * @param opts: Object holding optional environment to use as the default catalog (if any), database, and/or compute pool to
 *              associate with the document.
 */
export async function setFlinkDocumentMetadata(
  documentUri: vscode.Uri,
  opts: {
    catalog?: CCloudEnvironment;
    database?: CCloudFlinkDbKafkaCluster;
    computePool?: CCloudFlinkComputePool;
  },
): Promise<void> {
  const metadata: UriMetadata = {};

  const { catalog: environment, database, computePool } = opts;

  if (environment) {
    metadata[UriMetadataKeys.FLINK_CATALOG_ID] = environment.id;
    metadata[UriMetadataKeys.FLINK_CATALOG_NAME] = environment.name;
  }

  if (database) {
    metadata[UriMetadataKeys.FLINK_DATABASE_ID] = database.id;
    metadata[UriMetadataKeys.FLINK_DATABASE_NAME] = database.name;
  }

  if (computePool) {
    metadata[UriMetadataKeys.FLINK_COMPUTE_POOL_ID] = computePool.id;
  }

  logger.debug(`setting Flink catalog / database / compute pool metadata for URI`, {
    uri: documentUri.toString(),
    metadata,
  });

  await getResourceManager().setUriMetadata(documentUri, metadata);

  // Notify listeners that the metadata for this URI has been set/updated.
  uriMetadataSet.fire(documentUri);
}
