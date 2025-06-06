import * as vscode from "vscode";
import { getCCloudAuthSession } from "../../authn/utils";
import {
    CreateSqlv1Statement201Response,
    CreateSqlv1StatementOperationRequest,
    CreateSqlv1StatementRequest,
    CreateSqlv1StatementRequestApiVersionEnum,
    CreateSqlv1StatementRequestKindEnum,
} from "../../clients/flinkSql";
import { CCloudResourceLoader } from "../../loaders";
import { CCloudFlinkComputePool } from "../../models/flinkComputePool";
import { FlinkStatement } from "../../models/flinkStatement";
import { CCloudOrganization } from "../../models/organization";
import { getSidecar } from "../../sidecar";
import { Logger } from "../logging";

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

  // Can only be lowercase; probably to simplify the
  // uniqueness check on the backend.
  const proposed = parts.join("-").toLocaleLowerCase();

  // TODO: Show the user the proposed name and let them edit it.

  // Be sure to only submit lowercase after user edits.

  return proposed;
}

export interface IFlinkStatementSubmitParameters {
  statement: string;
  statementName: string;
  computePool: CCloudFlinkComputePool;
  properties: FlinkSpecProperties;
}

export async function submitFlinkStatement(
  params: IFlinkStatementSubmitParameters,
): Promise<CreateSqlv1Statement201Response> {
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

  const request: CreateSqlv1StatementOperationRequest = {
    organization_id: organization.id,
    environment_id: params.computePool.environmentId,
    CreateSqlv1StatementRequest: requestInner,
  };

  const statementsClient = handle.getFlinkSqlStatementsApi(params.computePool);
  const response = await statementsClient.createSqlv1Statement(request);

  return response;
}

/**
 * Get the user's local timezone offset.
 * @returns The local timezone offset in the format "GMT+/-HHMM", e.g. "GMT-0400" for EDT.
 */
export function localTimezoneOffset(): string {
  const nowStr = new Date().toString();
  return nowStr.match(/([A-Z]+[+-]\d+)/)![1]; //NOSONAR: This regex is safe for parsing the timezone offset from a date string.
}

const logger = new Logger("commands.flinkStatements");
const DEFAULT_POLL_PERIOD_MS = 300;
const MAX_WAIT_TIME_MS = 60_000;

/**
 * Wait for a Flink statement to enter results-viewable state by polling its status.
 *
 * @param statement The Flink statement to monitor
 * @param progress Progress object to report status updates
 * @param pollPeriodMs Optional polling interval in milliseconds (defaults to 300ms)
 * @returns Promise that resolves when the statement enters RUNNING phase
 * @throws Error if statement doesn't reach RUNNING phase within MAX_WAIT_TIME_MS seconds
 */
export async function waitForStatementRunning(
  statement: FlinkStatement,
  progress: vscode.Progress<{ message?: string }>,
  pollPeriodMs: number = DEFAULT_POLL_PERIOD_MS,
): Promise<void> {
  const startTime = Date.now();

  const ccloudLoader = CCloudResourceLoader.getInstance();

  while (Date.now() - startTime < MAX_WAIT_TIME_MS) {
    // Check if the statement is in a viewable state
    const refreshedStatement = await ccloudLoader.refreshFlinkStatement(statement);

    if (!refreshedStatement) {
      // if the statement is no longer found, break to raise error
      logger.warn(`waitForStatementRunning: statement "${statement.name}" not found`);
      break;
    } else if (refreshedStatement.areResultsViewable) {
      // Resolve if now in a viewable state
      return;
    }

    progress.report({ message: refreshedStatement.status?.phase });

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollPeriodMs));
  }

  throw new Error(
    `Statement ${statement.name} did not reach RUNNING phase within ${MAX_WAIT_TIME_MS / 1000} seconds`,
  );
}
