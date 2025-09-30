import { ObservableScope } from "inertial";
import { FlinkStatementResultsManager } from "../../flinkSql/flinkStatementResultsManager";
import { FlinkStatement } from "../../models/flinkStatement";
import { getSidecar } from "../../sidecar";
import { handleWebviewMessage } from "../../webview/comms/comms";
import { DEFAULT_RESULT_LIMIT, logger, statementResultsViewCache } from "../flinkStatements";

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
