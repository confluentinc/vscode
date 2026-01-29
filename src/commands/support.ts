import { homedir } from "os";
import { join } from "path";

import type { Disposable } from "vscode";
import { commands, env, Uri, window, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import { EXTENSION_ID } from "../constants";
import { observabilityContext } from "../context/observability";
import { ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER } from "../extensionSettings/constants";
import { FlinkLanguageClientManager } from "../flinkSql/flinkLanguageClientManager";
import { EXTENSION_OUTPUT_CHANNEL, Logger } from "../logging";
import type { ZipContentEntry, ZipFileEntry } from "./utils/zipFiles";
import { createZipFile } from "./utils/zipFiles";

const logger = new Logger("commands.support");

const FEEDBACK_URI = Uri.parse("https://www.surveymonkey.com/r/T262TDT");
const JOIN_SLACK_URI = Uri.parse("https://cnfl.io/slack-dp");

function openWalkthroughCommand() {
  commands.executeCommand(
    "workbench.action.openWalkthrough",
    "confluentinc.vscode-confluent#confluent-walkthrough",
  );
}

function joinSlackCommand() {
  env.openExternal(JOIN_SLACK_URI);
}

function feedbackCommand() {
  env.openExternal(FEEDBACK_URI);
}

/**
 * Wrapper function for the built-in `openIssueReporter` command, which pre-fills the extension ID
 * and adds an expanded section for our extension data based on the current {@link observabilityContext}
 */
function issueCommand() {
  let extensionMarkdown = "";

  const contextTable = observabilityContext.toMarkdownTable();
  if (contextTable) {
    // if we get a non-empty string, add it as a new collapsible section
    extensionMarkdown = `
<details>
<summary>Confluent Extension Data</summary>

${contextTable}

</details>
`;
  }

  commands.executeCommand("vscode.openIssueReporter", {
    extensionId: EXTENSION_ID,
    extensionData: extensionMarkdown,
  });
}

function openSettings() {
  commands.executeCommand("workbench.action.openSettings", "@ext:confluentinc.vscode-confluent");
}

/**
 * Save extension log files to the user's local file system.
 * If multiple files exist, they'll be saved as a zip.
 */
async function saveExtensionLogFile() {
  const logUris: Uri[] = EXTENSION_OUTPUT_CHANNEL.getFileUris();

  // one file: save it directly
  if (logUris.length === 1) {
    const defaultPath: string = join(homedir(), EXTENSION_OUTPUT_CHANNEL.logFileName);
    const saveUri: Uri | undefined = await window.showSaveDialog({
      defaultUri: Uri.file(defaultPath),
      filters: { "Log files": ["log"] },
      title: "Save Confluent Extension Log",
    });
    if (!saveUri) return;

    await handleLogFileSave(logUris[0], saveUri);
    return;
  }

  // multiple files: save as a zip
  const dateTimeString: string = new Date().toISOString().replace(/[-:T]/g, "").slice(0, -5);
  const defaultPath: string = join(homedir(), `vscode-confluent-logs-${dateTimeString}.zip`);
  const saveUri: Uri | undefined = await window.showSaveDialog({
    defaultUri: Uri.file(defaultPath),
    filters: { "ZIP files": ["zip"] },
    title: "Save Confluent Extension Logs",
  });
  if (!saveUri) return;

  const fileEntries: ZipFileEntry[] = logUris.map((uri) => ({
    sourceUri: uri,
    zipPath: uri.path.split("/").pop() || "vscode-confluent.log",
  }));

  await createZipFile(saveUri, fileEntries, [], "Confluent extension logs saved successfully.");
}

/**
 * Read the contents from one file Uri and write to another file Uri, then show an info notification,
 * allowing the user to open the file as a new text document.
 */
async function handleLogFileSave(readUri: Uri, writeUri: Uri) {
  let logData: Uint8Array;
  try {
    logData = await workspace.fs.readFile(readUri);
  } catch (error) {
    if (error instanceof Error) {
      const errorMsg = `Error reading log file: ${error.message}`;
      logger.error(errorMsg);
      window.showErrorMessage(errorMsg);
    }
    return;
  }

  try {
    await workspace.fs.writeFile(writeUri, logData);
  } catch (error) {
    if (error instanceof Error) {
      const errorMsg = `Error writing log file: ${error.message}`;
      logger.error(errorMsg);
      window.showErrorMessage(errorMsg);
    }
    return;
  }

  const successMsg = "Confluent extension log file saved successfully.";
  logger.debug(successMsg);
  const openButton = "Open File";
  window.showInformationMessage(successMsg, openButton).then((value) => {
    if (value === openButton) {
      window.showTextDocument(writeUri);
    }
  });
}

/**
 * Save a .zip of the following:
 * - "Confluent" output channel log file
 * - Flink Language Server log file (if enabled)
 * - Observability context (as a .json file)
 */
async function saveSupportZip() {
  // use a date-time string like YYYYmmddHHMMSS for the .zip filename, not the full ISO format
  const dateTimeString = new Date().toISOString().replace(/[-:T]/g, "").slice(0, -5);
  const defaultPath = join(homedir(), `vscode-confluent-support-${dateTimeString}.zip`);
  const writeUri = await window.showSaveDialog({
    defaultUri: Uri.file(defaultPath),
  });
  if (!writeUri) {
    return;
  }

  // add extension log files
  // NOTE: this will not include other workspaces' logs, only the current workspace
  const fileEntries: ZipFileEntry[] = EXTENSION_OUTPUT_CHANNEL.getFileUris().map((uri) => ({
    sourceUri: uri,
    zipPath: `${uri.path.split("/").pop() || "vscode-confluent.log"}`,
  }));

  // add flink language server log files if Flink Language Server is enabled and has started
  if (ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.value) {
    const flinkLanguageServerLogfileURIs = FlinkLanguageClientManager.getInstance()
      .getOutputChannel()
      .getFileUris();
    fileEntries.push(
      ...flinkLanguageServerLogfileURIs.map((uri) => ({
        sourceUri: uri,
        zipPath: `${uri.path.split("/").pop() || "vscode-confluent-flink-language-server.log"}`,
      })),
    );
  }

  // add the observability context as JSON content
  const contentEntries: ZipContentEntry[] = [
    {
      content: JSON.stringify(observabilityContext.toRecord(), null, 2),
      zipPath: "observability-context.json",
    },
  ];

  await createZipFile(
    writeUri,
    fileEntries,
    contentEntries,
    "Confluent extension support .zip saved successfully.",
  );
}

export function registerSupportCommands(): Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.support.confluent-walkthrough.launch",
      openWalkthroughCommand,
    ),
    registerCommandWithLogging("confluent.support.saveLogs", saveExtensionLogFile),
    registerCommandWithLogging("confluent.support.saveSupportZip", saveSupportZip),
    registerCommandWithLogging("confluent.support.feedback", feedbackCommand),
    registerCommandWithLogging("confluent.support.issue", issueCommand),
    registerCommandWithLogging("confluent.support.openSettings", openSettings),
    registerCommandWithLogging("confluent.support.joinSlack", joinSlackCommand),
  ];
}
