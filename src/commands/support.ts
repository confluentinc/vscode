import archiver from "archiver";
import { createWriteStream } from "fs";
import { homedir } from "os";
import { join } from "path";

import { commands, Disposable, env, Uri, window, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import { EXTENSION_ID } from "../constants";
import { observabilityContext } from "../context/observability";
import { LOGFILE_PATH, Logger } from "../logging";
import { SIDECAR_LOGFILE_PATH } from "../sidecar/constants";

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

/**
 * Convenience function to allow the user to download the Confluent output channel in the form of
 * a .log file.
 */
async function downloadLogs() {
  // prompt where to save the file, using the home directory as the default
  const defaultPath = join(homedir(), "vscode-confluent.log");
  const saveUri = await window.showSaveDialog({ defaultUri: Uri.file(defaultPath) });
  if (saveUri) {
    await handleLogFileSave(saveUri, Uri.parse(LOGFILE_PATH), true);
  }
}

/** Convenience function to allow the user to download the sidecar's .log file. */
async function downloadSidecarLogs() {
  // prompt where to save the file, using the home directory as the default
  const defaultPath = join(homedir(), "vscode-confluent-sidecar.log");
  const saveUri: Uri | undefined = await window.showSaveDialog({
    defaultUri: Uri.file(defaultPath),
  });
  if (saveUri) {
    await handleLogFileSave(saveUri, Uri.parse(SIDECAR_LOGFILE_PATH), true);
  }
}

/** Helper function to handle saving a log file to the given URI. */
async function handleLogFileSave(fileUri: Uri, sourceUri: Uri, forSidecar: boolean = false) {
  let logData: Uint8Array;
  try {
    logData = await workspace.fs.readFile(sourceUri);
  } catch (error) {
    if (error instanceof Error) {
      const errorMsg = `Error reading log file: ${error.message}`;
      logger.error(errorMsg);
      window.showErrorMessage(errorMsg);
    }
    return;
  }

  try {
    await workspace.fs.writeFile(fileUri, logData);
  } catch (error) {
    if (error instanceof Error) {
      const errorMsg = `Error writing log file: ${error.message}`;
      logger.error(errorMsg);
      window.showErrorMessage(errorMsg);
    }
    return;
  }

  const successMsg = `Confluent extension ${forSidecar ? "sidecar " : ""}log file downloaded successfully.`;
  logger.debug(successMsg);
  const openButton = "Open File";
  window.showInformationMessage(successMsg, openButton).then((value) => {
    if (value === openButton) {
      window.showTextDocument(fileUri);
    }
  });
}

/**
 * Convenience function to allow the user to download a .zip of the following:
 * - "Confluent" output channel log file
 * - "Confluent: Sidecar" output channel log file
 * - Observability context (as a .json file)
 */
async function downloadSupportZip() {
  const defaultPath = join(homedir(), `vscode-confluent-support-${new Date().toISOString()}.zip`);
  const saveUri = await window.showSaveDialog({
    defaultUri: Uri.file(defaultPath),
  });
  if (!saveUri) {
    return;
  }

  const output = createWriteStream(saveUri.fsPath);
  const archive = archiver("zip", {
    zlib: { level: 9 },
  });

  // set up event listeners for write errors & close/finalize
  const closeListener = output.on("close", () => {
    const openButton = "Open";
    window
      .showInformationMessage(
        "Confluent extension support .zip downloaded successfully",
        openButton,
      )
      .then((value) => {
        if (value === openButton) {
          // show in OS file explorer, don't try to open it in VS Code
          commands.executeCommand("revealFileInOS", saveUri);
        }
      });
    closeListener.destroy();
  });
  const errorListener = archive.on("error", (err) => {
    window.showErrorMessage(`Error creating zip: ${err.message}`);
    errorListener.destroy();
  });

  archive.pipe(output);

  // add extension+sidecar log files
  const extensionLog = await workspace.fs.readFile(Uri.parse(LOGFILE_PATH));
  archive.append(Buffer.from(extensionLog), { name: "vscode-confluent.log" });
  const sidecarLog = await workspace.fs.readFile(Uri.parse(SIDECAR_LOGFILE_PATH));
  archive.append(Buffer.from(sidecarLog), { name: "vscode-confluent-sidecar.log" });

  // add observability context
  archive.append(Buffer.from(JSON.stringify(observabilityContext.toRecord())), {
    name: "observability-context.json",
  });

  // create the .zip and trigger the onClose event
  await archive.finalize();
}

export function registerSupportCommands(): Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.support.confluent-walkthrough.launch",
      openWalkthroughCommand,
    ),
    registerCommandWithLogging("confluent.support.downloadLogs", downloadLogs),
    registerCommandWithLogging("confluent.support.downloadSidecarLogs", downloadSidecarLogs),
    registerCommandWithLogging("confluent.support.downloadSupportZip", downloadSupportZip),
    registerCommandWithLogging("confluent.support.feedback", feedbackCommand),
    registerCommandWithLogging("confluent.support.issue", issueCommand),
    registerCommandWithLogging("confluent.support.openSettings", openSettings),
  ];
}
