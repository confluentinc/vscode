import * as vscode from "vscode";
import { getCCloudAuthSession } from "../authn/utils";
import {
  CreateSqlv1StatementOperationRequest,
  CreateSqlv1StatementRequest,
  CreateSqlv1StatementRequestApiVersionEnum,
  CreateSqlv1StatementRequestKindEnum,
  SqlV1StatementResultResults,
} from "../clients/flinkSql";
import { isResponseErrorWithStatus } from "../errors";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import {
  FlinkSpecProperties,
  FlinkStatement,
  restFlinkStatementToModel,
  TERMINAL_PHASES,
} from "../models/flinkStatement";
import { getSidecar } from "../sidecar";
import { raceWithTimeout } from "../utils/timing";
import { WebviewPanelCache } from "../webview-cache";
import flinkStatementResults from "../webview/flink-statement-results.html";
import { parseResults } from "./flinkStatementResults";
import { extractPageToken } from "./utils";

const logger = new Logger("flinksql/statements");

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
}

export async function submitFlinkStatement(
  params: IFlinkStatementSubmitParameters,
): Promise<FlinkStatement> {
  const handle = await getSidecar();

  const requestInner: CreateSqlv1StatementRequest = {
    api_version: CreateSqlv1StatementRequestApiVersionEnum.SqlV1,
    kind: CreateSqlv1StatementRequestKindEnum.Statement,
    name: params.statementName,
    organization_id: params.organizationId,
    environment_id: params.computePool.environmentId,
    spec: {
      statement: params.statement,
      compute_pool_id: params.computePool.id,
      properties: params.properties.toProperties(),
    },
  };

  if (params.hidden) {
    // If this is a hidden statement, we set the metadata to indicate that.
    requestInner.metadata = {
      self: null,
      labels: {
        "user.confluent.io/hidden": "true",
      },
    };
  }

  const request: CreateSqlv1StatementOperationRequest = {
    organization_id: params.organizationId,
    environment_id: params.computePool.environmentId,
    CreateSqlv1StatementRequest: requestInner,
  };

  // Get at the statements client for the compute pool.
  const statementsClient = handle.getFlinkSqlStatementsApi(params.computePool);
  // Make the request to create the statement.
  const response = await statementsClient.createSqlv1Statement(request);
  // Promote from REST response to model.
  const statementModel = restFlinkStatementToModel(response, params.computePool);

  return statementModel;
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
 * Wait for a vscode-generated and just now-submitted 'hidden' Flink statement to complete.
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
export async function determineFlinkStatementName(): Promise<string> {
  const parts: string[] = [];

  // If we're creating flink statements, then we're ccloud authed. Use their
  // ccloud account name as primary part of the statement name.
  const ccloudAccountName = (await getCCloudAuthSession())?.account.label;
  if (ccloudAccountName) {
    let userNamePart = ccloudAccountName.split("@")[0];
    // strip anything to the right of any '+' character if present, don't want their
    // email buckets involved.
    userNamePart = userNamePart.split("+")[0];

    parts.push(userNamePart);
  } else {
    // Wacky. Not ccloud authed?
    parts.push("unknownuser");
  }

  parts.push("vscode");

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
  const handle = await getSidecar();

  const statementsClient = handle.getFlinkSqlStatementsApi(statement);

  try {
    const routeResponse = await raceWithTimeout(
      statementsClient.getSqlv1Statement({
        environment_id: statement.environmentId,
        organization_id: statement.organizationId,
        statement_name: statement.name,
      }),
      REFRESH_STATEMENT_MAX_WAIT_MS,
    );
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
  const sidecar = await getSidecar();
  const flinkSqlStatementResultsApi = sidecar.getFlinkSqlStatementResultsApi(statement);

  const resultsMap: Map<string, Map<string, any>> = new Map();
  let pageToken: string | undefined = undefined;
  do {
    const response = await flinkSqlStatementResultsApi.getSqlv1StatementResult({
      environment_id: statement.environmentId,
      organization_id: statement.organizationId,
      name: statement.name,
      page_token: pageToken,
    });

    // Writes into resultsMap
    const payload: SqlV1StatementResultResults = response.results;
    parseResults({
      columns: statement.status?.traits?.schema?.columns ?? [],
      isAppendOnly: statement.status?.traits?.is_append_only ?? true,
      upsertColumns: statement.status?.traits?.upsert_columns,
      map: resultsMap,
      rows: payload.data ?? [],
    });

    pageToken = extractPageToken(response?.metadata?.next);
  } while (pageToken !== undefined);

  // convert the maps in the values to objects, hopefully conforming to RT.
  const results = Array.from(resultsMap.values()).map(Object.fromEntries);

  return results as Array<RT>;
}
