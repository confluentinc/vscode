import { ObservableScope } from "inertial";
import * as vscode from "vscode";
import { FlinkStatementResultsManager } from "../../flinkSql/flinkStatementResultsManager";
import { FlinkStatementWebviewPanelCache } from "../../flinkSql/statementUtils";
import { Logger } from "../../logging";
import { FlinkStatement } from "../../models/flinkStatement";
import { getSidecar } from "../../sidecar";
import { handleWebviewMessage } from "../../webview/comms/comms";

/** Max number of statement results rows to display. */
export const DEFAULT_RESULT_LIMIT = 100_000;
/** Cache of statement result webviews by env/statement name. */
export const statementResultsViewCache = new FlinkStatementWebviewPanelCache();

const logger = new Logger("commands.flinkStatements");
/**
 * Handles the display of Flink statement results in a webview panel.
 * Creates or finds an existing panel, sets up the results manager and message handler.
 *
 * @param statement - The Flink statement to display results for
 */

export async function openFlinkStatementResultsView(statement: FlinkStatement | undefined) {
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

/**
 * Show a user confirmation about doing this action to a statement.
 *
 * @param action - The action to confirm ("stop" or "delete").
 * @param statement - The Flink statement the action will be performed on.
 * @returns Promise resolving to true if user confirmed, false if cancelled.
 */
export async function confirmActionOnStatement(
  action: "stop" | "delete",
  statement: FlinkStatement,
): Promise<boolean> {
  let message: string;
  let confirmationOption: string;

  if (action === "stop") {
    message = `Are you sure you want to stop Flink statement ${statement.name}? This will halt its processing but retain its definition.`;
    confirmationOption = "Stop Statement";
  } else {
    message = `Are you sure you want to delete Flink statement ${statement.name}? This action is irreversible and will remove the statement permanently.`;
    confirmationOption = "Delete Statement";
  }

  const answer = await vscode.window.showWarningMessage(
    message,
    { modal: false },
    confirmationOption,
  );
  if (answer !== confirmationOption) {
    // User cancelled.
    return false;
  }

  return true;
}
