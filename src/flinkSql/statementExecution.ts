import { SqlV1StatementResultResults } from "../clients/flinkSql";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement, Phase } from "../models/flinkStatement";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import { getSidecar } from "../sidecar";
import { parseResults } from "../utils/flinkStatementResults";
import {
  determineFlinkStatementName,
  IFlinkStatementSubmitParameters,
  submitFlinkStatement,
  waitForStatementCompletion,
} from "./statementUtils";
import { extractPageToken } from "./utils";

const logger = new Logger("flinkSql.statementExecution");

/**
 * Execute a Flink SQL statement, returning the results as an array of objects of type RT.
 * Should be used for batch statements, such as system catalog queries, registering
 * UDFs, etc.
 *
 * @param sqlStatement The SQL statement (string) to execute.
 * @param database The database (CCloudKafkaCluster) to execute the statement against.
 * @param computePool The compute pool (CCloudFlinkComputePool) to use for execution
 * @returns Array of results, each of type RT (generic type parameter) corresponding to the result row structure from the query.
 *
 */
export async function executeFlinkStatement<RT>(
  sqlStatement: string,
  database: CCloudKafkaCluster,
  computePool: CCloudFlinkComputePool,
): Promise<Array<RT>> {
  const statementParams: IFlinkStatementSubmitParameters = {
    statement: sqlStatement,
    statementName: await determineFlinkStatementName(),
    computePool,
    hidden: true, // Hidden statement, user didn't author it.
    properties: database.toFlinkSpecProperties(),
  };

  // Submit statement
  let statement = await submitFlinkStatement(statementParams);

  // Refresh the statement until it is in a terminal phase.
  statement = await waitForStatementCompletion(statement);

  // If it didn't complete successfully, bail out.
  if (statement.phase !== Phase.COMPLETED) {
    logger.error(
      `Statement ${statement.id} did not complete successfully, phase ${statement.phase}`,
    );
    throw new Error(`Statement did not complete successfully, phase ${statement.phase}`);
  }

  // Parse and return all results.
  return await parseAllFlinkStatementResults<RT>(statement);
}

/* Internal support from here on out, exported only for test suite. */

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
