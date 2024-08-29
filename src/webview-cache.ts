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
   * Find or create a webview panel with the given id. If a webview with this id exists, return it, else create a new one.
   *
   * @param id Unique identifier for the webview. If a webview with this id is already open, it will be returned.
   * @param viewType createWebviewPanel() viewType parameter, if needing to create a new webview.
   * @param title  createWebviewPanel() title parameter, if needing to create a new webview.
   * @param viewColumn createWebviewPanel() viewColumn parameter, if needing to create a new webview.
   * @param options createWebviewPanel() options parameter, if needing to create a new webview.
   * @returns [vscode.WebviewPanel, boolean] The webview panel and a boolean indicating if it was already open.
   */
  public findOrCreate(
    id: string,
    viewType: string,
    title: string,
    viewColumn: vscode.ViewColumn,
    options: vscode.WebviewOptions,
  ): [vscode.WebviewPanel, boolean] {
    // If one cached already by this id, return it.
    const existing = this.openWebviews.get(id);
    if (existing) {
      // existing.reveal();
      return [existing, true];
    }

    // Create a new webview and add it to the cache.
    const webview = vscode.window.createWebviewPanel(viewType, title, viewColumn, options);
    this.openWebviews.set(id, webview);

    // Remove the webview from this cache when it is disposed.
    webview.onDidDispose(() => {
      this.openWebviews.delete(id);
    });

    return [webview, false];
  }
}
