import { ObservableScope } from "inertial";
import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import {
  FLINKSTATEMENT_URI_SCHEME,
  FlinkStatementDocumentProvider,
} from "../documentProviders/flinkStatement";
import { extractResponseBody, isResponseError, logError } from "../errors";
import { FLINK_SQL_FILE_EXTENSIONS, FLINK_SQL_LANGUAGE_ID } from "../flinkSql/constants";
import { FlinkStatementResultsManager } from "../flinkStatementResultsManager";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FlinkStatement, Phase, restFlinkStatementToModel } from "../models/flinkStatement";
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
import { handleWebviewMessage } from "../webview/comms/comms";
import {
  FlinkSpecProperties,
  FlinkStatementWebviewPanelCache,
  IFlinkStatementSubmitParameters,
  determineFlinkStatementName,
  localTimezoneOffset,
  submitFlinkStatement,
  waitForStatementRunning,
} from "./utils/flinkStatements";

const logger = new Logger("commands.flinkStatements");

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
    const newStatement = restFlinkStatementToModel(restResponse, computePool);

    if (newStatement.status.phase === Phase.FAILED) {
      // Immediate failure of the statement. User gave us something
      // bad, like perhaps a bad table / column name, etc..

      logUsage(UserEvent.FlinkStatementAction, {
        action: "submit_failure",
        compute_pool_id: computePool.id,
        failure_reason: newStatement.status.detail,
      });

      // limit the error message content so the notification isn't hidden automatically
      await showErrorNotificationWithButtons(
        `Error submitting statement: ${newStatement.status.detail?.slice(0, 500)}`,
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

    // Focus the new statement in the view.
    const statementsView = FlinkStatementsViewProvider.getInstance();

    // Cause the view to refresh on the compute pool in question,
    // and then focus the new statement. Statement will probably be in 'Pending' state.
    await statementsView.setParentResource(computePool);
    // (Will wait for the refresh to complete.)
    await statementsView.focus(newStatement.id);

    // Wait for the statement to start running, then open the results view.
    // Show a progress indicator over the Flink Statements view while we wait.
    await statementsView.withProgress(`Submitting statement ${newStatement.name}`, async () => {
      await waitForStatementRunning(newStatement);
      await openFlinkStatementResultsView(newStatement);
    });

    // Refresh the statements view again to show the new state of the statement.
    // (This is a whole empty + reload of view data, so have to wait until it's done.
    //  before we can focus our new statement.)
    await statementsView.refresh();
    // Focus again, but don't need to wait for it.
    void statementsView.focus(newStatement.id);
  } catch (err) {
    if (isResponseError(err) && err.response.status === 400) {
      // Usually a bad SQL statement.
      // The error string should be JSON, have 'errors' as an array of objs with 'details' human readable messages.
      const objFromResponse = await extractResponseBody(err);
      let errorMessages: string;
      if (objFromResponse && typeof objFromResponse === "object" && "errors" in objFromResponse) {
        const responseErrors: { errors: [{ detail: string }] } = objFromResponse;
        logger.error(JSON.stringify(responseErrors, null, 2));
        errorMessages = responseErrors.errors.map((e: { detail: string }) => e.detail).join("\n");
      } else {
        // will be the raw error string. Wacky we couldn't parse it. Flink backend change?
        errorMessages = objFromResponse;

        // Log in Sentry and logger (we invite the user to open logs / file issue in
        // showErrorNotificationWithButtons(), so good for them to see this in the logs.)
        logError(err, `Unparseable 400 response submitting statement: ${errorMessages}`, {
          extra: {
            errorMessages,
            statementLength: statement.length,
            computePoolId: computePool.id,
            currentDatabase,
            statementName,
          },
        });
      }
      await showErrorNotificationWithButtons(`Error submitting statement: ${errorMessages}`);
    } else {
      // wasn't a 400 ResponseError. So who knows? We don't expect this to happen.
      logError(err, "Submit Flink statement unexpected error", {
        extra: {
          statementLength: statement.length,
          computePoolId: computePool.id,
          currentDatabase,
          statementName,
        },
      });
      await showErrorNotificationWithButtons(`Error submitting statement: ${err}`);
    }
  }
}

/** Max number of statement results rows to display. */
const DEFAULT_RESULT_LIMIT = 100_000;
/** Cache of statement result webviews by env/statement name. */
const statementResultsViewCache = new FlinkStatementWebviewPanelCache();

/**
 * Handles the display of Flink statement results in a webview panel.
 * Creates or finds an existing panel, sets up the results manager and message handler.
 *
 * @param statement - The Flink statement to display results for
 */
async function openFlinkStatementResultsView(statement: FlinkStatement | undefined) {
  if (!statement) return;

  if (!(statement instanceof FlinkStatement)) {
    logger.error("handleFlinkStatementResults", "statement is not an instance of FlinkStatement");
    return;
  }

  const [panel, cached] = statementResultsViewCache.getPanelForStatement(statement);
  if (cached) {
    // Existing panel for this statement found, just reveal it.
    panel.reveal();
    return;
  }

  const os = ObservableScope();

  /** Wrapper for `panel.visible` that gracefully switches to `false` when panel is disposed. */
  const panelActive = os.produce(true, (value, signal) => {
    const disposed = panel.onDidDispose(() => value(false));
    const changedState = panel.onDidChangeViewState(() => value(panel.visible));
    signal.onabort = () => {
      disposed.dispose();
      changedState.dispose();
    };
  });

  /** Notify an active webview only after flushing the rest of updates. */
  const notifyUI = () => {
    queueMicrotask(() => {
      if (panelActive()) panel.webview.postMessage(["Timestamp", "Success", Date.now()]);
    });
  };

  const sidecar = await getSidecar();
  const resultsManager = new FlinkStatementResultsManager(
    os,
    statement,
    sidecar,
    notifyUI,
    DEFAULT_RESULT_LIMIT,
  );

  // Handle messages from the webview and delegate to the results manager
  const handler = handleWebviewMessage(panel.webview, (...args) => {
    let result;
    // handleMessage() may end up reassigning many signals, so do
    // so in a batch.
    os.batch(() => (result = resultsManager.handleMessage(...args)));
    return result;
  });

  panel.onDidDispose(() => {
    resultsManager.dispose();
    handler.dispose();
    os.dispose();
  });
}

export function registerFlinkStatementCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.statements.viewstatementsql", viewStatementSqlCommand),
    registerCommandWithLogging("confluent.statements.create", submitFlinkStatementCommand),
    // Different naming scheme due to legacy telemetry reasons.
    registerCommandWithLogging("confluent.flinkStatementResults", openFlinkStatementResultsView),
  ];
}
