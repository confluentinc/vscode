import { ObservableScope, type Scope } from "inertial";
import * as vscode from "vscode";
import { logError } from "../../errors";
import { STATEMENT_RESULTS_LOCATION } from "../../extensionSettings/constants";
import { DEFAULT_RESULTS_LIMIT } from "../../flinkSql/flinkStatementResults";
import { getFlinkSqlApiProvider } from "../../flinkSql/flinkSqlApiProvider";
import {
  FlinkStatementResultsManager,
  type MessageType,
} from "../../flinkSql/flinkStatementResultsManager";
import { FlinkStatementWebviewPanelCache } from "../../flinkSql/statementUtils";
import { Logger } from "../../logging";
import { FlinkStatement } from "../../models/flinkStatement";
import { FlinkStatementResultsPanelProvider } from "../../panelProviders/flinkStatementResults";

/** Cache of statement result webviews by env/statement name. */
export const statementResultsViewCache = new FlinkStatementWebviewPanelCache();

/** Tracks active results managers for editor-based panels. */
const editorResultsManagers = new Map<
  string,
  { manager: FlinkStatementResultsManager; scope: Scope }
>();

const logger = new Logger("commands.utils.statements");

/**
 * Handles the display of Flink statement results in either the editor area or the panel area.
 * Creates or finds an existing panel/view, sets up the results manager and message handler.
 *
 * @param statement - The Flink statement to display results for
 */
export async function openFlinkStatementResultsView(statement: FlinkStatement | undefined) {
  if (!(statement instanceof FlinkStatement)) {
    logger.error("statement is not an instance of FlinkStatement");
    return;
  }

  if (STATEMENT_RESULTS_LOCATION.value === "panel") {
    return openFlinkStatementResultsInPanel(statement);
  } else {
    return openFlinkStatementResultsInEditor(statement);
  }
}

/**
 * Open Flink statement results in the editor area as a webview panel document.
 * This is the original/default behavior that allows multiple results to be open simultaneously.
 *
 * @param statement - The Flink statement to display results for
 */
async function openFlinkStatementResultsInEditor(statement: FlinkStatement) {
  const [panel, isNew] = statementResultsViewCache.getPanelForStatement(statement);
  const panelKey = `${statement.environmentId}/${statement.name}`;

  // Clean up any existing manager for this panel
  const existing = editorResultsManagers.get(panelKey);
  if (existing) {
    existing.manager.dispose();
    existing.scope.dispose();
    editorResultsManagers.delete(panelKey);
  }

  // Create a new results manager with the CCloud Flink SQL API provider
  const flinkApiProvider = getFlinkSqlApiProvider();
  const scope = ObservableScope();
  const resultsManager = new FlinkStatementResultsManager(
    scope,
    statement,
    flinkApiProvider,
    () => {
      // Notify the webview of state changes
      panel.webview.postMessage({ type: "StateChanged" });
    },
    DEFAULT_RESULTS_LIMIT,
  );

  // Store the manager for cleanup
  editorResultsManagers.set(panelKey, { manager: resultsManager, scope });

  // Set up message handling
  const messageHandler = panel.webview.onDidReceiveMessage(
    async (message: { type: MessageType; body: Record<string, unknown> }) => {
      try {
        const result = await resultsManager.handleMessage(message.type, message.body);
        panel.webview.postMessage({
          type: `${message.type}Response`,
          body: result,
          timestamp: message.body?.timestamp,
        });
      } catch (error) {
        logError(error, "Error handling editor webview message", { extra: { type: message.type } });
      }
    },
  );

  // Clean up when panel is disposed
  panel.onDidDispose(() => {
    messageHandler.dispose();
    const entry = editorResultsManagers.get(panelKey);
    if (entry) {
      entry.manager.dispose();
      entry.scope.dispose();
      editorResultsManagers.delete(panelKey);
    }
  });

  if (isNew) {
    panel.reveal(vscode.ViewColumn.One);
  }
}

/**
 * Open Flink statement results in the bottom panel area as a webview view, replacing any existing
 * results currently visible in the panel.
 */
async function openFlinkStatementResultsInPanel(statement: FlinkStatement) {
  const provider = FlinkStatementResultsPanelProvider.getInstance();
  await provider.showStatementResults(statement);
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
  let detail: string;
  let confirmationOption: string;

  if (action === "stop") {
    message = `Are you sure you want to stop Flink statement ${statement.name}?`;
    detail = "This will halt its processing but retain its definition.";
    confirmationOption = "Stop Statement";
  } else {
    message = `Are you sure you want to delete Flink statement ${statement.name}?`;
    detail = "This action is irreversible and will remove the statement permanently.";
    confirmationOption = "Delete Statement";
  }

  const answer = await vscode.window.showWarningMessage(
    message,
    {
      modal: true,
      detail,
    },
    confirmationOption,
  );
  if (answer !== confirmationOption) {
    // User cancelled.
    return false;
  }

  return true;
}
