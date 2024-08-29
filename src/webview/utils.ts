import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { getExtensionContext } from "../context";
/**
 * Utilities for using webviews on the vscode side of the extension.
 */

/**
 * Return the root URI for the static files used in webviews (src/webview).
 */
export function getStaticRoot(): vscode.Uri {
  return vscode.Uri.joinPath(getExtensionContext().extensionUri, "webview");
}

/**
 * Return the URI for a static file in the src/webview directory.
 */
export function getUriPath(
  webview: vscode.Webview,
  staticRoot: vscode.Uri,
  ...paths: string[]
): vscode.Uri {
  return webview.asWebviewUri(vscode.Uri.joinPath(staticRoot, ...paths));
}

/** Get a nonce for use within a webview context */
export function getNonce() {
  return randomBytes(16).toString("base64");
}

/**
 * Cache for webview panels that are already open. Prevents opening multiple instances of the same
 * exact webview. Each subsystem opening different kinds of webviews should have its own cache instance.
 */
export class WebviewPanelCache {
  // Map of webview specific unique id to an open the webview panel instance.
  open_webviews: Map<string, vscode.WebviewPanel>;

  constructor() {
    this.open_webviews = new Map();
  }

  /**
   * Get a webview panel instance by its unique id. Returns undefined if the webview is not open.
   * If is exists already, will reveal the webview prior to returning it, so it is brought to the
   * users's attention in a pleasant manner.
   */
  getWebviewPanel(id: string): vscode.WebviewPanel | undefined {
    const webview = this.open_webviews.get(id);
    if (webview) {
      webview.reveal();
    }
    return webview;
  }

  /** Add a webview panel instance to the cache. */
  addWebviewPanel(id: string, webview: vscode.WebviewPanel) {
    this.open_webviews.set(id, webview);

    // Remove the webview from this cache when it is disposed.
    webview.onDidDispose(() => {
      this.open_webviews.delete(id);
    });
  }
}
