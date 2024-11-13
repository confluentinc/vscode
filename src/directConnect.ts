import { ExtensionContext, ViewColumn } from "vscode";
import { registerCommandWithLogging } from "./commands";
import { WebviewPanelCache } from "./webview-cache";
import connectionFormTemplate from "./webview/direct-connect-form.html";
import { randomUUID } from "crypto";

export const registerDirectConnectionCommand = (context: ExtensionContext) => {
  const directConnectionCommand = registerCommandWithLogging("confluent.connections.direct", () =>
    openDirectConnectionForm(),
  );
  context.subscriptions.push(directConnectionCommand);
};

const directConnectWebviewCache = new WebviewPanelCache();

export function openDirectConnectionForm(): void {
  console.log("openDirectConnectionForm");
  // Set up the webview, checking for existing form for this topic
  const [directConnectForm, formExists] = directConnectWebviewCache.findOrCreate(
    { id: randomUUID(), multiple: false, template: connectionFormTemplate },
    "direct-connect-form",
    `New Connection`,
    ViewColumn.One,
    {
      enableScripts: true,
    },
  );

  if (formExists) {
    directConnectForm.reveal();
    return;
  }

  /**
   * on submit
   * save info in VSCODE Storage/state - name/id (generate it)
   * send to backend
   */
}
