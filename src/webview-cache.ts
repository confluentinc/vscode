import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { getExtensionContext } from "./context/extension";

type TemplateFunction = (ctx: {
  cspSource: string;
  nonce: string;
  path: (src: string) => vscode.Uri;
}) => string;

/**
 * Cache for webview panels that are already open. Prevents opening multiple instances of the same
 * exact webview. Each subsystem opening different kinds of webviews should have its own cache instance.
 */
export class WebviewPanelCache {
  // Map of webview specific unique id to an open the webview panel instance.
  openWebviews = new Map<string, vscode.WebviewPanel[]>();

  /**
   * Find or create a webview panel with the given id. If a webview with this id exists, return it, else create a new one.
   *
   * @param config Contains unique id for the webview. If a webview with this id is already open, it will be returned, unless `multiple` flag is enabled.
   *   Also contains `template` function that generates string template for the new webview.
   * @param viewType createWebviewPanel() viewType parameter, if needing to create a new webview.
   * @param title  createWebviewPanel() title parameter, if needing to create a new webview.
   * @param viewColumn createWebviewPanel() viewColumn parameter, if needing to create a new webview.
   * @param options createWebviewPanel() options parameter, if needing to create a new webview.
   * @returns [vscode.WebviewPanel, boolean] The webview panel and a boolean indicating if it was already open.
   */
  findOrCreate(
    config: { id: string; multiple?: boolean; template: TemplateFunction },
    viewType: string,
    title: string,
    viewColumn: vscode.ViewColumn,
    options: vscode.WebviewOptions,
  ): [vscode.WebviewPanel, boolean] {
    const { id, multiple = false, template } = config;

    // Check if any panels for the id exist in the cache.
    const cached = this.openWebviews.get(id);
    // Only return a cached panel if `multiple` flag is `false`, otherwise create more panels.
    if (cached != null && cached.length > 0 && !multiple) {
      const panel = cached[0];
      return [panel, true];
    }

    const context = getExtensionContext();
    const staticRoot = vscode.Uri.joinPath(context.extensionUri, "webview");

    // Create a new webview panel…
    const panel = vscode.window.createWebviewPanel(viewType, title, viewColumn, {
      ...options,
      localResourceRoots: [staticRoot, ...(options.localResourceRoots ?? [])],
    });

    panel.iconPath = {
      light: vscode.Uri.joinPath(context.extensionUri, "resources/confluent-logo-dark.svg"),
      dark: vscode.Uri.joinPath(context.extensionUri, "resources/confluent-logo-light.svg"),
    };

    // …initialize its template…
    panel.webview.html = template({
      cspSource: panel.webview.cspSource,
      nonce: randomBytes(16).toString("base64"),
      path: (src: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(staticRoot, src)),
    });

    // …and add it to the cache.
    if (!this.openWebviews.has(id)) this.openWebviews.set(id, []);
    const list = this.openWebviews.get(id)!;
    list.push(panel);

    // Remove the webview from this cache when it is disposed.
    panel.onDidDispose(() => {
      const index = list.indexOf(panel);
      if (index >= 0) list.splice(index, 1);
      if (list.length === 0) this.openWebviews.delete(id);
    });
    return [panel, false];
  }
}
