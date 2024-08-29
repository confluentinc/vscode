import * as vscode from "vscode";

/**
 * Cache for webview panels that are already open. Prevents opening multiple instances of the same
 * exact webview. Each subsystem opening different kinds of webviews should have its own cache instance.
 */
export class WebviewPanelCache {
  // Map of webview specific unique id to an open the webview panel instance.
  openWebviews: Map<string, vscode.WebviewPanel>;

  constructor() {
    this.openWebviews = new Map();
  }

  /**
   * Get a webview panel instance by its unique id. Returns undefined if the webview is not open.
   * If is exists already, will reveal the webview prior to returning it, so it is brought to the
   * users's attention in a pleasant manner.
   */
  getWebviewPanel(id: string): vscode.WebviewPanel | undefined {
    const webview = this.openWebviews.get(id);
    if (webview) {
      webview.reveal();
    }
    return webview;
  }

  /** Add a webview panel instance to the cache. */
  addWebviewPanel(id: string, webview: vscode.WebviewPanel) {
    this.openWebviews.set(id, webview);

    // Remove the webview from this cache when it is disposed.
    webview.onDidDispose(() => {
      this.openWebviews.delete(id);
    });
  }
}
