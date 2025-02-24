import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { SIDECAR_OUTPUT_CHANNEL } from "../constants";
import { Logger, outputChannel } from "../logging";
import { getStorageManager } from "../storage";

const logger = new Logger("commands.debugtools");

async function resetGlobalStateCommand() {
  await getStorageManager().clearGlobalState();
  vscode.window.showInformationMessage("Global state successfully reset.");
}

async function resetWorkspaceStateCommand() {
  await getStorageManager().clearWorkspaceState();
  vscode.window.showInformationMessage("Workspace state successfully reset.");
}

async function showGlobalStateCommand() {
  const globalStateWebview = vscode.window.createWebviewPanel(
    "confluentDebugToolsGlobalState",
    "Global State Inspector",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    },
  );
  globalStateWebview.webview.onDidReceiveMessage(async (message) => {
    switch (message.action) {
      case "confluent.debugtools.globalState.refresh":
        logger.info("Refreshing global state");
        globalStateWebview.webview.html = await generateHtmlContent("global");
        break;
      case "confluent.debugtools.globalState.item.delete":
        logger.info(`Deleting global state item with key: ${message.key}`);
        await getStorageManager().deleteGlobalState(message.key);
        globalStateWebview!.webview.html = await generateHtmlContent("global");
        break;
      case "confluent.debugtools.globalState.reset":
        logger.info("Resetting global state");
        await resetGlobalStateCommand();
        globalStateWebview!.webview.html = await generateHtmlContent("global");
        break;
    }
  });
  try {
    globalStateWebview.webview.html = await generateHtmlContent("global");
  } catch (error) {
    logger.error("Error generating global state webview", error);
  }
}

async function showWorkspaceStateCommand() {
  const workspaceStateWebview = vscode.window.createWebviewPanel(
    "confluentDebugToolsWorkspaceState",
    "Workspace State Inspector",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    },
  );
  workspaceStateWebview.webview.onDidReceiveMessage(async (message) => {
    // some docs/examples may show `message.command` here, but it has no association with the
    // vscode.Command type or the `vscode.commands` API, so we're using "action" to avoid confusion
    switch (message.action) {
      case "confluent.debugtools.workspaceState.refresh":
        logger.info("Refreshing workspace state");
        workspaceStateWebview!.webview.html = await generateHtmlContent("workspace");
        break;
      case "confluent.debugtools.workspaceState.item.delete":
        logger.info(`Deleting workspace state item with key: ${message.key}`);
        await getStorageManager().deleteWorkspaceState(message.key);
        workspaceStateWebview!.webview.html = await generateHtmlContent("workspace");
        break;
      case "confluent.debugtools.workspaceState.reset":
        logger.info("Resetting workspace state");
        await resetWorkspaceStateCommand();
        workspaceStateWebview!.webview.html = await generateHtmlContent("workspace");
        break;
    }
  });
  try {
    workspaceStateWebview.webview.html = await generateHtmlContent("workspace");
  } catch (error) {
    logger.error("Error generating workspace state webview", error);
  }
}

// TODO: move these two into `src/webviews` and use web UI toolkit and better practices
async function createTableRow(stateKind: "global" | "workspace", key: string): Promise<string> {
  const storageManager = getStorageManager();
  let value =
    stateKind === "global"
      ? await storageManager.getGlobalState(key)
      : await storageManager.getWorkspaceState(key);

  try {
    // Maps will show up as empty objects in the webview unless we convert them to plain objects
    if (value instanceof Map) value = Object.fromEntries(value);
    value = JSON.stringify(value, null, 2);
  } catch {
    // pass the raw string value through as-is
  }

  return `
    <tr>
    <td><code>${key}</code></td>
    <td><div style="max-height: 200px; max-width: 800px; overflow: auto;"><pre>${value}</pre></div></td>
    <td>
      <button onclick="deleteKey('${key}')">Delete</button>
    </td>
    </tr>
  `;
}

async function generateHtmlContent(stateKind: "global" | "workspace"): Promise<string> {
  const storageManager = getStorageManager();
  const keys: readonly string[] =
    stateKind === "global"
      ? await storageManager.getGlobalStateKeys()
      : await storageManager.getWorkspaceStateKeys();

  // display key/value pairs as HTML table in webview with a refresh button and individual delete buttons
  const sortedKeys = [...keys].sort();
  logger.info(`Generating HTML content for ${stateKind} state with keys: ${sortedKeys}`);
  const tableRows = await Promise.all(sortedKeys.map((key) => createTableRow(stateKind, key)));
  // may look like a command name, but isn't associated with the `vscode.commands` API
  const actionPrefix = `confluent.debugtools.${stateKind}State`;
  return `
  <html>
    <head>
    <style>
      table {
      border-collapse: collapse;
      width: 100%;
      }
      th, td {
      padding: 8px;
      text-align: left;
      border: 1px solid #ddd;
      }
      th {
      background-color: rgba(90, 90, 90, 0.2);
      }
      td {
      min-width: 200px;
      }
    </style>
    </head>
    <body>
      <h1>${stateKind} state</h1>
      <button onclick="refresh()">Refresh</button>
      <button onclick="deleteAll()">Delete All</button>
      <table>
        <tr>
          <th>Key</th>
          <th>Value</th>
          <th>Actions</th>
        </tr>
        ${tableRows.join("")}
      </table>
      <script>
        const vscode = acquireVsCodeApi();
        function refresh() {
          vscode.postMessage({ action: "${actionPrefix}.refresh" });
        }
        function deleteKey(key) {
          vscode.postMessage({ action: "${actionPrefix}.item.delete", key });
        }
        function deleteAll() {
          vscode.postMessage({ action: "${actionPrefix}.reset" });
        }
      </script>
    </body>
  </html>
`;
}

async function showOutputChannelCommand() {
  // make sure the Output panel is visible first
  await vscode.commands.executeCommand("workbench.panel.output.focus");
  outputChannel.show();
}

async function showSidecarOutputChannelCommand() {
  // make sure the Output panel is visible first
  await vscode.commands.executeCommand("workbench.panel.output.focus");
  SIDECAR_OUTPUT_CHANNEL.show();
}

export function registerDebugCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.debugtools.globalState.showWebView",
      showGlobalStateCommand,
    ),
    registerCommandWithLogging(
      "confluent.debugtools.workspaceState.showWebView",
      showWorkspaceStateCommand,
    ),
    registerCommandWithLogging("confluent.debugtools.globalState.reset", resetGlobalStateCommand),
    registerCommandWithLogging(
      "confluent.debugtools.workspaceState.reset",
      resetWorkspaceStateCommand,
    ),
    registerCommandWithLogging("confluent.showOutputChannel", showOutputChannelCommand),
    registerCommandWithLogging(
      "confluent.showSidecarOutputChannel",
      showSidecarOutputChannelCommand,
    ),
  ];
}
