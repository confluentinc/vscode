import { randomBytes } from "crypto";
import { ObservableScope } from "inertial";
import {
  commands,
  type Disposable,
  type ExtensionContext,
  Uri,
  type Webview,
  type WebviewView,
  type WebviewViewProvider,
  window,
} from "vscode";
import { getExtensionContext } from "../context/extension";
import { ContextValues, setContextValue } from "../context/values";
import { ExtensionContextNotSetError } from "../errors";
import { DEFAULT_RESULT_LIMIT } from "../flinkSql/constants";
import { FlinkStatementResultsManager } from "../flinkSql/flinkStatementResultsManager";
import { Logger } from "../logging";
import { type FlinkStatement } from "../models/flinkStatement";
import { getSidecar } from "../sidecar";
import { DisposableCollection } from "../utils/disposables";
import { handleWebviewMessage } from "../webview/comms/comms";
import statementResultsHtmlTemplate from "../webview/flink-statement-results.html";

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
  private resultsManager?: FlinkStatementResultsManager;
  private observableScope?: ReturnType<typeof ObservableScope>;

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

    // TODO: refactor the block below to be more generally usable since it's currently lifted from
    // a similar implementation in commands/utils/statements.ts
    const os = ObservableScope();
    this.observableScope = os;
    const panelActive = os.produce(true, (value, signal) => {
      const changedState = this.view!.onDidChangeVisibility(() => value(this.view!.visible));
      signal.onabort = () => changedState.dispose();
    });
    const notifyUI = () => {
      queueMicrotask(() => {
        if (panelActive() && this.view) {
          this.view.webview.postMessage(["Timestamp", "Success", Date.now()]);
        }
      });
    };
    const sidecar = await getSidecar();
    this.resultsManager = new FlinkStatementResultsManager(
      os,
      statement,
      sidecar,
      notifyUI,
      DEFAULT_RESULT_LIMIT,
    );
    // Handle messages from the webview and delegate to the results manager
    const handler = handleWebviewMessage(this.view.webview, (...args) => {
      let result;
      // handleMessage() may end up reassigning many signals, so do
      // so in a batch.
      os.batch(() => (result = this.resultsManager!.handleMessage(...args)));
      return result;
    });
    this.disposables.push(handler);

    this.view.webview.html = this.getStatementResultsHtml(this.view.webview);
    // reveal the panel and preserve focus
    this.view.show(true);
  }

  /** Cleanup the current results manager and dispose of related resources. */
  private cleanup(): void {
    if (this.resultsManager) {
      this.resultsManager.dispose();
      this.resultsManager = undefined;
    }
    if (this.observableScope) {
      this.observableScope.dispose();
      this.observableScope = undefined;
    }
    // not handling view-related disposables here since they're managed via this.disposables
  }

  /**
   * Generate the HTML content for displaying statement results, using the same template as the
   * editor-based webviews.
   */
  private getStatementResultsHtml(webview: Webview): string {
    const staticRoot = Uri.joinPath(this.extensionUri, "webview");
    const nonce = randomBytes(16).toString("base64");

    return statementResultsHtmlTemplate({
      cspSource: webview.cspSource,
      nonce,
      path: (src: string) => webview.asWebviewUri(Uri.joinPath(staticRoot, src)),
    });
  }
}
