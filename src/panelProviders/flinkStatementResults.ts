import { randomBytes } from "crypto";
import { ObservableScope, type Scope } from "inertial";
import {
  commands,
  type Disposable,
  type ExtensionContext,
  Uri,
  type WebviewView,
  type WebviewViewProvider,
  window,
} from "vscode";
import { getExtensionContext } from "../context/extension";
import { ContextValues, setContextValue } from "../context/values";
import { ExtensionContextNotSetError } from "../errors";
import { DEFAULT_RESULTS_LIMIT } from "../flinkSql/flinkStatementResults";
import { getFlinkSqlApiProvider } from "../flinkSql/flinkSqlApiProvider";
import { FlinkStatementResultsManager } from "../flinkSql/flinkStatementResultsManager";
import { Logger } from "../logging";
import { type FlinkStatement } from "../models/flinkStatement";
import { DisposableCollection } from "../utils/disposables";
import { handleWebviewLogs, handleWebviewMessage } from "../webview/comms/comms";
import flinkStatementResultsHtml from "../webview/flink-statement-results.html";

const logger = new Logger("panelProviders.flinkStatementResults");

/**
 * Provides webview content for Flink statement results displayed in the bottom panel area.
 * Unlike the editor-based WebviewPanel approach, this shows one active result at a time and does
 * not provide any statement list, tabs, history, etc.
 */
export class FlinkStatementResultsPanelProvider
  extends DisposableCollection
  implements WebviewViewProvider, Disposable
{
  currentStatement?: FlinkStatement;

  // for webview handling:
  private extensionUri: Uri;
  private view?: WebviewView;

  // for results management:
  private resultsManager?: FlinkStatementResultsManager;
  private resultsManagerScope?: Scope;

  constructor() {
    super();
    const context: ExtensionContext = getExtensionContext();
    if (!context) {
      // extension context required for looking up extension URI
      throw new ExtensionContextNotSetError("FlinkStatementResultsPanelProvider");
    }

    this.extensionUri = context.extensionUri;

    const viewProviderRegistration = window.registerWebviewViewProvider(
      "confluent-flink-statement-results-panel",
      this,
      {
        webviewOptions: {
          retainContextWhenHidden: true, // keep webview state when panel is collapsed/hidden
        },
      },
    );
    this.disposables.push(viewProviderRegistration);
  }

  private static instance: FlinkStatementResultsPanelProvider | null = null;
  static getInstance(): FlinkStatementResultsPanelProvider {
    if (!FlinkStatementResultsPanelProvider.instance) {
      FlinkStatementResultsPanelProvider.instance = new FlinkStatementResultsPanelProvider();
    }
    return FlinkStatementResultsPanelProvider.instance;
  }

  /**
   * Called by VS Code when the webview view becomes visible for the first time.
   * This method initializes the webview and restores any previous state.
   */
  async resolveWebviewView(view: WebviewView): Promise<void> {
    this.view = view;

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        Uri.joinPath(this.extensionUri, "webview"),
        ...(view.webview.options.localResourceRoots ?? []),
      ],
    };

    if (!this.currentStatement) {
      // this should never happen because we'll only open the panel when we have a statement to show
      logger.warn("No current statement to show in panel");
      return;
    }

    await this.showStatementResults(this.currentStatement);

    const webviewDismissedSub = view.onDidDispose(() => {
      this.cleanup();
      this.view = undefined;
    });
    this.disposables.push(webviewDismissedSub);
  }

  /** Show results for a specific statement in the panel, replacing any existing results. */
  async showStatementResults(statement: FlinkStatement): Promise<void> {
    logger.debug(`Showing statement results for: ${statement.name}`);

    // dispose any preexisting webview and/or results manager
    this.cleanup();

    this.currentStatement = statement;

    // if we don't have a view yet, set the context value to enable the panel
    // and then focus the panel to trigger resolveWebviewView
    if (!this.view) {
      await setContextValue(ContextValues.flinkStatementResultsPanelActive, true);
      await commands.executeCommand("confluent-flink-statement-results-panel.focus");
      // shouldn't happen, but guard against it
      if (!this.view) {
        logger.warn("Panel view could not be resolved after focus command");
        return;
      }
    }

    // Create a new results manager with the CCloud Flink SQL API provider
    const flinkApiProvider = getFlinkSqlApiProvider();
    this.resultsManagerScope = ObservableScope();
    this.resultsManager = new FlinkStatementResultsManager(
      this.resultsManagerScope,
      statement,
      flinkApiProvider,
      () => this.notifyUI(),
      DEFAULT_RESULTS_LIMIT,
    );

    // Set up webview HTML and message handling
    this.view.webview.html = this.getStatementResultsHtml();
    this.setupMessageHandler();
    this.view.show(true);
  }

  /** Notify the webview UI of state changes by updating the timestamp signal. */
  private notifyUI(): void {
    if (this.view) {
      // The webview listens for ["Timestamp"] messages to trigger reactive updates
      this.view.webview.postMessage(["Timestamp"]);
    }
  }

  /** Get the HTML content for the statement results webview. */
  private getStatementResultsHtml(): string {
    if (!this.view) {
      return "";
    }

    const webview = this.view.webview;
    const staticRoot = Uri.joinPath(this.extensionUri, "webview");

    // Use the HTML template with the same pattern as WebviewPanelCache
    return flinkStatementResultsHtml({
      cspSource: webview.cspSource,
      nonce: randomBytes(16).toString("base64"),
      path: (src: string) => webview.asWebviewUri(Uri.joinPath(staticRoot, src)),
    });
  }

  /** Set up message handler for webview communication using the standard protocol. */
  private setupMessageHandler(): void {
    if (!this.view) {
      return;
    }

    // Forward webview console logs to extension output channel
    const logHandler = handleWebviewLogs(this.view.webview, logger);
    this.disposables.push(logHandler);

    // Use handleWebviewMessage for proper [id, type, body] protocol compatibility
    const messageHandler = handleWebviewMessage(this.view.webview, (type, body) => {
      if (!this.resultsManager) {
        logger.warn("No results manager available to handle message", { type });
        return null;
      }
      return this.resultsManager.handleMessage(type, body);
    });
    this.disposables.push(messageHandler);
  }

  /** Cleanup the current results manager and dispose of related resources. */
  private cleanup(): void {
    if (this.resultsManager) {
      this.resultsManager.dispose();
      this.resultsManager = undefined;
    }
    if (this.resultsManagerScope) {
      this.resultsManagerScope.dispose();
      this.resultsManagerScope = undefined;
    }
  }
}
