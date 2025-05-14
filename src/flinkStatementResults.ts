import { ObservableScope } from "inertial";
import { ExtensionContext, ViewColumn, WebviewPanel } from "vscode";
import { registerCommandWithLogging } from "./commands";
import { FlinkStatementResultsManager } from "./flinkStatementResultsManager";
import { FlinkStatement } from "./models/flinkStatement";
import { getSidecar } from "./sidecar";
import { WebviewPanelCache } from "./webview-cache";
import { handleWebviewMessage } from "./webview/comms/comms";
import flinkStatementResults from "./webview/flink-statement-results.html";

const DEFAULT_RESULT_LIMIT = 100_000;

/**
 * Activates the Flink statement results viewer by registering the command handler.
 * Sets up the scheduler and panel cache for managing results display.
 */
export function activateFlinkStatementResultsViewer(context: ExtensionContext) {
  const cache = new WebviewPanelCache();

  context.subscriptions.push(
    registerCommandWithLogging("confluent.flinkStatementResults", (statement?: FlinkStatement) =>
      handleFlinkStatementResults(statement, cache),
    ),
  );
}

/**
 * Handles the display of Flink statement results in a webview panel.
 * Creates or finds an existing panel, sets up the results manager and message handler.
 *
 * @param statement - The Flink statement to display results for
 * @param schedule - Scheduler function for rate limiting API calls
 * @param cache - Cache for managing webview panels
 */
async function handleFlinkStatementResults(
  statement: FlinkStatement | undefined,
  cache: WebviewPanelCache,
) {
  if (!statement) return;

  const [panel, cached] = await findOrCreatePanel(statement, cache);
  if (cached) {
    panel.reveal();
    return;
  }

  const os = ObservableScope();

  /** Wrapper for `panel.visible` that gracefully switches to `false` when panel is disposed. */
  const panelActive = os.produce(true, (value, signal) => {
    const disposed = panel.onDidDispose(() => value(false));
    const changedState = panel.onDidChangeViewState(() => value(panel.visible));
    signal.onabort = () => (disposed.dispose(), changedState.dispose());
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
 * Finds an existing panel in the cache or creates a new one if not found.
 * Returns a tuple of [panel, cached] where cached indicates if the panel was found in cache.
 */
function findOrCreatePanel(
  statement: FlinkStatement,
  cache: WebviewPanelCache,
): [WebviewPanel, boolean] {
  return cache.findOrCreate(
    {
      id: `${statement.environmentId}/${statement.name}`,
      template: flinkStatementResults,
    },
    "flink-statement-results",
    `Statement: ${statement.name}`,
    ViewColumn.One,
    { enableScripts: true },
  );
}
