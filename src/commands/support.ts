import { homedir } from "os";
import { join, normalize } from "path";

import { commands, Disposable, env, Uri, window, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import { EXTENSION_ID } from "../constants";
import { observabilityContext } from "../context/observability";
import { CURRENT_LOGFILE_NAME, LOGFILE_DIR, Logger, ROTATED_LOGFILE_NAMES } from "../logging";
import { SIDECAR_LOGFILE_PATH } from "../sidecar/constants";
import { createZipFile, ZipContentEntry, ZipFileEntry } from "./utils/zipFiles";

const logger = new Logger("commands.support");

const FEEDBACK_URI = Uri.parse("https://www.surveymonkey.com/r/NYVKQD6");

function openWalkthroughCommand() {
  commands.executeCommand(
    "workbench.action.openWalkthrough",
    "confluentinc.vscode-confluent#confluent-walkthrough",
  );
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
<summary>Confluent Extension + Sidecar Data</summary>

${contextTable}

</details>
`;
  }

  commands.executeCommand("vscode.openIssueReporter", {
    extensionId: EXTENSION_ID,
    // issueTitle: "Issue title",
    // issueBody: "Issue body",
    extensionData: extensionMarkdown,
  });
}

function openSettings() {
  commands.executeCommand("workbench.action.openSettings", "@ext:confluentinc.vscode-confluent");
}

/** Return the file URIs for the extension's currently-active log file and any rotated log files for
 * this extension instance, normalized for the user's OS. */
function extensionLogFileUris(): Uri[] {
  const uris: Uri[] = [];
  // early on, CURRENT_LOGFILE_NAME will be included in ROTATED_LOGFILE_NAMES, but after a few
  // rotations, it will be removed from the array so we need to make sure we include it here
  const filenames: string[] = [CURRENT_LOGFILE_NAME, ...ROTATED_LOGFILE_NAMES];
  for (const filename of filenames) {
    const uri = Uri.file(normalize(join(LOGFILE_DIR, filename)));
    if (!uris.some((existingUri) => existingUri.fsPath === uri.fsPath)) {
      uris.push(uri);
    }
  }
  return uris;
}

/** Return the file URI for the sidecar's log file, normalized for the user's OS. */
function sidecarLogFileUri(): Uri {
  return Uri.file(normalize(SIDECAR_LOGFILE_PATH));
}

/**
 * Save extension log files to the user's local file system.
 * If multiple files exist, they'll be saved as a zip.
 */
async function saveExtensionLogFile() {
  const logUris: Uri[] = extensionLogFileUris();

  // one file: save it directly
  if (logUris.length === 1) {
    const defaultPath: string = join(homedir(), CURRENT_LOGFILE_NAME);
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
 * Save the sidecar log file to the user's local file system, prompting for a save location.
 * The default save location is the user's home directory.
 */
async function saveSidecarLogFile() {
  // prompt where to save the file, using the home directory as the default
  const defaultPath = join(homedir(), "vscode-confluent-sidecar.log");
  const saveUri: Uri | undefined = await window.showSaveDialog({
    defaultUri: Uri.file(defaultPath),
    filters: {
      "Log files": ["log"],
    },
    title: "Save Confluent Extension Sidecar Log",
  });
  if (saveUri) {
    await handleLogFileSave(sidecarLogFileUri(), saveUri, true);
  }
}

/**
 * Read the contents from one file Uri and write to another file Uri, then show an info notification,
 * allowing the user to open the file as a new text document.
 */
async function handleLogFileSave(readUri: Uri, writeUri: Uri, forSidecar: boolean = false) {
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

  const successMsg = `Confluent extension ${forSidecar ? "sidecar " : ""}log file saved successfully.`;
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
 * - "Confluent: Sidecar" output channel log file
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

  // add extension+sidecar log files
  // NOTE: this will not include other workspaces' logs, only the current workspace
  const fileEntries: ZipFileEntry[] = extensionLogFileUris().map((uri) => ({
    sourceUri: uri,
    zipPath: `${uri.path.split("/").pop() || "vscode-confluent.log"}`,
  }));
  fileEntries.push({
    sourceUri: sidecarLogFileUri(),
    zipPath: `${sidecarLogFileUri().path.split("/").pop() || "vscode-confluent-sidecar.log"}`,
  });

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
    registerCommandWithLogging("confluent.support.saveSidecarLogs", saveSidecarLogFile),
    registerCommandWithLogging("confluent.support.saveSupportZip", saveSupportZip),
    registerCommandWithLogging("confluent.support.feedback", feedbackCommand),
    registerCommandWithLogging("confluent.support.issue", issueCommand),
    registerCommandWithLogging("confluent.support.openSettings", openSettings),
  ];
}
