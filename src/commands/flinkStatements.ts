import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import {
  FLINKSTATEMENT_URI_SCHEME,
  FlinkStatementDocumentProvider,
} from "../documentProviders/flinkStatement";
import { extractResponseBody, isResponseError, logError } from "../errors";
import { FLINK_SQL_FILE_EXTENSIONS, FLINK_SQL_LANGUAGE_ID } from "../flinkSql/constants";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FAILED_PHASE, FlinkStatement, restFlinkStatementToModel } from "../models/flinkStatement";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { showErrorNotificationWithButtons } from "../notifications";
import { flinkComputePoolQuickPick } from "../quickpicks/flinkComputePools";
import { flinkDatabaseQuickpick } from "../quickpicks/kafkaClusters";
import { uriQuickpick } from "../quickpicks/uris";
import { getSidecar } from "../sidecar";
import { UriMetadataKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import { UserEvent, logUsage } from "../telemetry/events";
import { getEditorOrFileContents } from "../utils/file";
import { FlinkStatementsViewProvider } from "../viewProviders/flinkStatements";
import {
  FlinkSpecProperties,
  IFlinkStatementSubmitParameters,
  determineFlinkStatementName,
  localTimezoneOffset,
  submitFlinkStatement,
} from "./utils/flinkStatements";

const logger = new Logger("commands.flinkStatements");

/** Poll period in millis to check whether statement has reached results-viewable state */
const DEFAULT_POLL_PERIOD_MS = 300;

/** Max time in millis to wait until statement reaches results-viewable state */
const MAX_WAIT_TIME_MS = 60_000;

/**
 * Wait for a Flink statement to enter results-viewable state by polling its status.
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

  let response;
  while (true) {
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime > MAX_WAIT_TIME_MS) {
      throw new Error(
        `Statement ${statement.name} did not reach RUNNING phase within ${MAX_WAIT_TIME_MS / 1000} seconds`,
      );
    }

    response = restFlinkStatementToModel(
      await statementsService.getSqlv1Statement({
        environment_id: statement.environmentId,
        organization_id: statement.organizationId,
        statement_name: statement.name,
      }),
    );

    if (response.isResultsViewable) {
      break;
    }

    progress.report({ message: response.status?.phase });
    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollPeriodMs));
  }
}

/**
 * Wait for a Flink statement to enter the  phase and then display the results in a new tab.
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
      await vscode.commands.executeCommand("confluent.flinkStatementResults", statement);
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

  // make sure any relevant metadata for the Uri is set
  const rm = ResourceManager.getInstance();
  await rm.setUriMetadata(uri, {
    [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: statement.computePoolId,
    [UriMetadataKeys.FLINK_DATABASE_ID]: statement.database,
  });

  const doc = await vscode.workspace.openTextDocument(uri);
  vscode.languages.setTextDocumentLanguage(doc, "flinksql");
  await vscode.window.showTextDocument(doc, { preview: false });
}

/**
 * Submit a Flink statement to a Flink cluster.
 *
 * The flow of the command is as follows:
 *  1) (If no `uri` is passed): show a quickpick to **choose a Flink SQL document**,
 *     preferring the current foreground editor
 *  2) Create **statement name** (auto-generated from template pattern, but user can override)
 *  3) (If no `pool` is passed): show a quickpick to **choose a Flink compute pool** to send the statement
 *  4) (if no `database` is passed): show a quickpick to **choose a database** (Kafka cluster) to
 *     submit along with the **catalog name** (the environment, inferable from the chosen database).
 *  5) Submit!
 *  6) Show error notification for any submission errors.
 *  7) Refresh the statements view if the view is focused on the chosen compute pool.
 *  8) If the statement is viewable, wait for it to be in the RUNNING phase and show results.
 */
export async function submitFlinkStatementCommand(
  uri?: vscode.Uri,
  pool?: CCloudFlinkComputePool,
  database?: CCloudKafkaCluster,
): Promise<void> {
  const funcLogger = logger.withCallpoint("submitFlinkStatementCommand");

  // 1. Choose the document with the SQL to submit
  const uriSchemes = ["file", "untitled", FLINKSTATEMENT_URI_SCHEME];
  const languageIds = ["plaintext", FLINK_SQL_LANGUAGE_ID, "sql"];
  const fileFilters = {
    "FlinkSQL files": [...FLINK_SQL_FILE_EXTENSIONS, ".sql"],
  };
  const validUriProvided: boolean = uri instanceof vscode.Uri && uriSchemes.includes(uri.scheme);
  const statementBodyUri: vscode.Uri | undefined = validUriProvided
    ? uri
    : await uriQuickpick(uriSchemes, languageIds, fileFilters);
  if (!statementBodyUri) {
    funcLogger.debug("User canceled the URI quickpick");
    return;
  }

  const document = await getEditorOrFileContents(statementBodyUri);
  const statement = document.content;

  // 2. Choose the statement name
  const statementName = await determineFlinkStatementName();

  // 3. Choose the Flink cluster to send to
  const computePool: CCloudFlinkComputePool | undefined =
    pool instanceof CCloudFlinkComputePool ? pool : await flinkComputePoolQuickPick();
  if (!computePool) {
    funcLogger.debug("User canceled the compute pool quickpick");
    return;
  }

  // 4. Choose the current / default database for the expression to be evaluated against.
  // (a kafka cluster in the same provider/region as the compute pool)
  const validDatabaseProvided: boolean =
    database instanceof CCloudKafkaCluster &&
    database.provider === computePool.provider &&
    database.region === computePool.region;
  const currentDatabaseKafkaCluster: KafkaCluster | undefined = validDatabaseProvided
    ? database
    : await flinkDatabaseQuickpick(computePool);
  if (!currentDatabaseKafkaCluster) {
    funcLogger.debug("User canceled the default database quickpick");
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
      currentCatalog: currentDatabaseKafkaCluster.environmentId,
      localTimezone: localTimezoneOffset(),
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
    // (Will wait for the refresh to complete.)

    // Focus the new statement in the view.
    const statementsView = FlinkStatementsViewProvider.getInstance();

    // Cause the view to refresh on the compute pool in question,
    // and then focus the new statement. Statement will probably be in 'Pending' state.
    await statementsView.setParentResource(computePool);
    await statementsView.focus(newStatement.id);

    // Wait for statement to be running and show results
    if (newStatement.canHaveResults) {
      // Will resolve when the statement is in a viewable state and
      // the results viewer is open.
      await waitAndShowResults(newStatement, computePool);

      // Refresh the statements view again to show the new state of the statement.
      // (This is a whole empty + reload of view data, so have to wait until it's done.
      //  before we can focus our new statement.)
      await statementsView.refresh();
      // Focus again, but don't need to wait for it.
      void statementsView.focus(newStatement.id);
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
