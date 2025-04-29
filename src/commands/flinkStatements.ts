import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { FlinkStatementDocumentProvider } from "../documentProviders/flinkStatement";
import {
  extractResponseBody,
  isResponseError,
  logError,
  showErrorNotificationWithButtons,
} from "../errors";
import { Logger } from "../logging";
import {
  FAILED_PHASE,
  FlinkStatement,
  RUNNING_PHASE,
  restFlinkStatementToModel,
} from "../models/flinkStatement";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { flinkComputePoolQuickPick } from "../quickpicks/flinkComputePools";
import { kafkaClusterQuickPick } from "../quickpicks/kafkaClusters";
import { uriQuickpick } from "../quickpicks/uris";
import { logUsage, UserEvent } from "../telemetry/events";
import { getEditorOrFileContents } from "../utils/file";
import { selectPoolForStatementsViewCommand } from "./flinkComputePools";
import {
  determineFlinkStatementName,
  FlinkSpecProperties,
  IFlinkStatementSubmitParameters,
  submitFlinkStatement,
} from "./utils/flinkStatements";
import { getSidecar } from "../sidecar";
import { FlinkStatementResultsViewerConfig } from "../flinkStatementResults";
import { currentFlinkStatementsResourceChanged } from "../emitters";

const logger = new Logger("commands.flinkStatements");

/** Poll period in millis to check whether statement has reached RUNNING state */
const DEFAULT_POLL_PERIOD_MS = 300;

/** Max time in millis to wait until statement reaches RUNNING state */
const MAX_WAIT_TIME_MS = 30_000;

/**
 * Wait for a Flink statement to enter the RUNNING phase by polling its status.
 *
 * @param statement The Flink statement to monitor
 * @param computePool The compute pool the statement is running on
 * @param progress Progress object to report status updates
 * @param pollPeriodMs Optional polling interval in milliseconds (defaults to 300ms)
 * @returns Promise that resolves when the statement enters RUNNING phase
 * @throws Error if statement doesn't reach RUNNING phase within MAX_WAIT_TIME_MS seconds
 */
async function waitForStatementRunning(
  statement: FlinkStatement,
  computePool: CCloudFlinkComputePool,
  progress: vscode.Progress<{ message?: string }>,
  pollPeriodMs: number = DEFAULT_POLL_PERIOD_MS,
): Promise<void> {
  const startTime = Date.now();
  const sidecar = await getSidecar();
  const statementsService = sidecar.getFlinkSqlStatementsApi({
    environmentId: computePool.environmentId,
    provider: computePool.provider,
    region: computePool.region,
  });

  while (true) {
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > MAX_WAIT_TIME_MS) {
      throw new Error(
        `Statement ${statement.name} did not reach RUNNING phase within ${MAX_WAIT_TIME_MS / 1000} seconds`,
      );
    }

    const response = await statementsService.getSqlv1Statement({
      environment_id: statement.environmentId,
      organization_id: statement.organizationId,
      statement_name: statement.name,
    });

    if (response.status?.phase === RUNNING_PHASE) {
      break;
    }

    progress.report({ message: response.status?.phase });
    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollPeriodMs));
  }
}

/**
 * Wait for a Flink statement to enter the RUNNING phase and then display the results in a new tab.
 *
 * @param statement The Flink statement to monitor and display results for
 * @param computePool The compute pool the statement is running on
 * @returns Promise that resolves when the results are displayed
 */
async function waitAndShowResults(
  statement: FlinkStatement,
  computePool: CCloudFlinkComputePool,
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Submitting statement ${statement.name}`,
      cancellable: false,
    },
    async (progress) => {
      await waitForStatementRunning(statement, computePool, progress);
      progress.report({ message: "Opening statement results in a new tab..." });
      await vscode.commands.executeCommand(
        "confluent.flinkStatementResults",
        statement,
        false,
        FlinkStatementResultsViewerConfig.create(),
      );
    },
  );
}

/** View the SQL statement portion of a FlinkStatement in a read-only document. */
export async function viewStatementSqlCommand(statement: FlinkStatement): Promise<void> {
  if (!statement) {
    logger.error("viewStatementSqlCommand", "statement is undefined");
    return;
  }

  if (!(statement instanceof FlinkStatement)) {
    logger.error("viewStatementSqlCommand", "statement is not an instance of FlinkStatement");
    return;
  }

  const uri = FlinkStatementDocumentProvider.getStatementDocumentUri(statement);
  const doc = await vscode.workspace.openTextDocument(uri);
  vscode.languages.setTextDocumentLanguage(doc, "flinksql");
  await vscode.window.showTextDocument(doc, { preview: false });
}

/**
  * Submit a Flink statement to a Flink cluster. Flow:
  * Quickpick flow:
	*  1) Chose flinksql, sql, or text document, preferring the current foreground editor.
  *  2) Statement name (auto-generated from template pattern, but user can override)
	  2) the Flink cluster to send to
    3) also need to know at least the 'current database' (cluster name) to submit along with the catalog name (the env, infer-able from the chosen Flink cluster).
  5) Submit!
  6) Raise error box if any immediate submission errors.
  7) Refresh the statements view if the view is set to include the cluster
*/
export async function submitFlinkStatementCommand(): Promise<void> {
  // 1. Choose the document with the SQL to submit
  const uriSchemes = ["file", "untitled"];
  const languageIds = ["plaintext", "flinksql", "sql"];
  const fileFilters = {
    "FlinkSQL files": [".flinksql", ".sql"],
  };
  const statementBodyUri: vscode.Uri | undefined = await uriQuickpick(
    uriSchemes,
    languageIds,
    fileFilters,
  );
  if (!statementBodyUri) {
    logger.info(
      "sumbitFlinkStatementCommand",
      "Short circuiting return, no statement file chosen.",
    );
    return;
  }

  const document = await getEditorOrFileContents(statementBodyUri);
  const statement = document.content;

  // 2. Choose the statement name
  const statementName = await determineFlinkStatementName();

  // 3. Choose the Flink cluster to send to
  const computePool = await flinkComputePoolQuickPick();
  if (!computePool) {
    logger.error("sumbitFlinkStatementCommand", "computePool is undefined");
    return;
  }

  // 4. Choose the current / default database / aka kafka cluster
  // within the environment.
  const currentDatabaseKafkaCluster: KafkaCluster | undefined = await kafkaClusterQuickPick({
    placeHolder: "Select the Kafka cluster to use as the default database for the statement",
    filter: (cluster: KafkaCluster) => {
      if (cluster.environmentId !== computePool.environmentId) {
        return false;
      }
      // Any survivors matching environmentId check should be CCloudKafkaClusters,
      // since the compute pool is ccloud.
      const ccloudCluster = cluster as CCloudKafkaCluster;
      return (
        ccloudCluster.provider === computePool.provider &&
        ccloudCluster.region === computePool.region
      );
    },
  });
  if (!currentDatabaseKafkaCluster) {
    logger.error("sumbitFlinkStatementCommand", "currentDatabaseKafkaCluster is undefined");
    return;
  }
  const currentDatabase = currentDatabaseKafkaCluster.name;

  // 5. Prep to submit, submit.
  const submission: IFlinkStatementSubmitParameters = {
    statement,
    statementName,
    computePool,
    properties: new FlinkSpecProperties({
      currentDatabase,
      currentCatalog: computePool.environmentId,
      // TODO get at the user's local timezone
      // localTimezone: "GMT-04:00",
    }),
  };

  try {
    const restResponse = await submitFlinkStatement(submission);
    const newStatement = restFlinkStatementToModel(restResponse);

    if (newStatement.status.phase === FAILED_PHASE) {
      // Immediate failure of the statement. User gave us something
      // bad, like perhaps a bad table / column name, etc..

      logUsage(UserEvent.FlinkStatementAction, {
        action: "submit_failure",
        compute_pool_id: computePool.id,
        failure_reason: newStatement.status.detail,
      });

      await showErrorNotificationWithButtons(
        `Error submitting statement: ${newStatement.status.detail}`,
      );
      return;
    }

    logUsage(UserEvent.FlinkStatementAction, {
      action: "submit_success",
      sql_kind: newStatement.sqlKind,
      compute_pool_id: computePool.id,
    });

    // Refresh the statements view onto the compute pool in question,
    // which will then show the new statement.
    await selectPoolForStatementsViewCommand(computePool);

    // Wait for statement to be running and show results
    if (newStatement.isResultsViewable) {
      await waitAndShowResults(newStatement, computePool);

      // Refresh the statements view again
      currentFlinkStatementsResourceChanged.fire(computePool);
    }
  } catch (err) {
    logError(err, "Submit Flink statement unexpected error");

    if (isResponseError(err) && err.response.status === 400) {
      // will be array of objs with 'details' human readable messages.
      const responseErrors: { errors: [{ detail: string }] } = await extractResponseBody(err);
      logger.error(JSON.stringify(responseErrors, null, 2));

      const errorMessages = responseErrors.errors
        .map((e: { detail: string }) => e.detail)
        .join("\n");
      await showErrorNotificationWithButtons(`Error submitting statement: ${errorMessages}`);
    } else {
      await showErrorNotificationWithButtons(`Error submitting statement: ${err}`);
    }
  }
}

export function registerFlinkStatementCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.statements.viewstatementsql", viewStatementSqlCommand),
    registerCommandWithLogging("confluent.statements.create", submitFlinkStatementCommand),
  ];
}
