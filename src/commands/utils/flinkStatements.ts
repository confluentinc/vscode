import * as vscode from "vscode";
import { getCCloudAuthSession } from "../../authn/utils";
import {
  CreateSqlv1StatementOperationRequest,
  CreateSqlv1StatementRequest,
  CreateSqlv1StatementRequestApiVersionEnum,
  CreateSqlv1StatementRequestKindEnum,
} from "../../clients/flinkSql";
import { CCloudResourceLoader } from "../../loaders";
import { Logger } from "../../logging";
import { CCloudFlinkComputePool } from "../../models/flinkComputePool";
import { FlinkStatement, Phase, restFlinkStatementToModel } from "../../models/flinkStatement";
import { CCloudOrganization } from "../../models/organization";
import { getSidecar } from "../../sidecar";
import { WebviewPanelCache } from "../../webview-cache";
import flinkStatementResults from "../../webview/flink-statement-results.html";

const logger = new Logger("commands.utils.flinkStatements");

export class FlinkSpecProperties {
  currentCatalog: string | undefined = undefined;
  currentDatabase: string | undefined = undefined;
  localTimezone: string | undefined = undefined;

  constructor(
    options: Pick<
      Partial<FlinkSpecProperties>,
      "currentCatalog" | "currentDatabase" | "localTimezone"
    >,
  ) {
    this.currentCatalog = options.currentCatalog;
    this.currentDatabase = options.currentDatabase;
    this.localTimezone = options.localTimezone;
  }

  static fromProperties(properties: Record<string, string>): FlinkSpecProperties {
    const currentCatalog = properties["sql.current-catalog"];
    const currentDatabase = properties["sql.current-database"];
    const localTimezone = properties["sql.local-time-zone"];
    return new FlinkSpecProperties({
      currentCatalog,
      currentDatabase,
      localTimezone,
    });
  }

  toProperties(): Record<string, string> {
    const properties: Record<string, string> = {};
    if (this.currentCatalog) {
      properties["sql.current-catalog"] = this.currentCatalog;
    }
    if (this.currentDatabase) {
      properties["sql.current-database"] = this.currentDatabase;
    }
    if (this.localTimezone) {
      properties["sql.local-time-zone"] = this.localTimezone;
    }
    return properties;
  }

  /**
   * Return new properties set based on union of this and provided other, preferring any value
   * set in other over this.
   */
  union(other: FlinkSpecProperties): FlinkSpecProperties {
    const merged = new FlinkSpecProperties({
      currentCatalog: other.currentCatalog || this.currentCatalog,
      currentDatabase: other.currentDatabase || this.currentDatabase,
      localTimezone: other.localTimezone || this.localTimezone,
    });
    return merged;
  }
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

export interface IFlinkStatementSubmitParameters {
  statement: string;
  statementName: string;
  computePool: CCloudFlinkComputePool;
  properties: FlinkSpecProperties;

  /**
   * False if user directly submitted this statement, true if it was created by the extension.
   */
  hidden: boolean;
}

export async function submitFlinkStatement(
  params: IFlinkStatementSubmitParameters,
): Promise<FlinkStatement> {
  const ccloudLoader = CCloudResourceLoader.getInstance();

  const handle = await getSidecar();

  const organization: CCloudOrganization | undefined = await ccloudLoader.getOrganization();
  if (!organization) {
    throw new Error("User must be signed in to Confluent Cloud to submit Flink statements.");
  }

  const requestInner: CreateSqlv1StatementRequest = {
    api_version: CreateSqlv1StatementRequestApiVersionEnum.SqlV1,
    kind: CreateSqlv1StatementRequestKindEnum.Statement,
    name: params.statementName,
    organization_id: organization.id,
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
    organization_id: organization.id,
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

/**
 * Get the user's local timezone offset.
 * @returns The local timezone offset in the format "GMT+/-HHMM", e.g. "GMT-0400" for EDT.
 */
export function localTimezoneOffset(): string {
  const nowStr = new Date().toString();
  return nowStr.match(/([A-Z]+[+-]\d+)/)![1]; //NOSONAR: This regex is safe for parsing the timezone offset from a date string.
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
 * @throws Error if statement doesn't fulfil `statement.areResultsViewable` within MAX_WAIT_TIME_MS seconds, or if it is not found.
 */
export async function waitForResultsFetchable(statement: FlinkStatement): Promise<void> {
  return waitForStatementState(statement, (s) => s.canRequestResults);
}

/**
 * Wait for a vscode-generated and just now-submitted 'hidden' Flink statement to complete.
 */
export async function waitForStatementCompletion(statement: FlinkStatement): Promise<void> {
  return waitForStatementState(statement, (s) => s.phase === Phase.COMPLETED);
}

/**
 * Wait for a Flink statement to enter any given state as determined by the provided predicate.
 *
 * @param statement The Flink statement to monitor
 * @param predicate A function that takes a Flink statement and returns true if the statement is in the desired state.
 * @returns Promise that resolves when the statement passes the predicate check.
 * @throws Error if statement doesn't fulfill the predicate within MAX_WAIT_TIME_MS seconds, or if the statement is not found, or
 * if the predicate itself throws an error.
 */
async function waitForStatementState(
  statement: FlinkStatement,
  predicate: (s: FlinkStatement) => boolean,
): Promise<void> {
  const startTime = Date.now();

  const ccloudLoader = CCloudResourceLoader.getInstance();

  while (Date.now() - startTime < MAX_WAIT_TIME_MS) {
    // Check if the statement is in a viewable state
    const refreshedStatement = await ccloudLoader.refreshFlinkStatement(statement);

    if (!refreshedStatement) {
      // if the statement is no longer found, break to raise error
      logger.warn(`waitForStatementRunning: statement "${statement.name}" not found`);
      throw new Error(`Statement ${statement.name} no longer exists.`);
    }

    if (predicate(refreshedStatement)) {
      return;
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_PERIOD_MS));
  }

  throw new Error(
    `Statement ${statement.name} did not reach desired state within ${MAX_WAIT_TIME_MS / 1000} seconds`,
  );
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
