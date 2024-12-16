import archiver from "archiver";
import { createWriteStream } from "fs";
import { homedir } from "os";
import { join } from "path";
import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { EXTENSION_ID } from "../constants";
import { observabilityContext } from "../context/observability";
import { LOGFILE_PATH, Logger } from "../logging";
import { SIDECAR_LOGFILE_PATH } from "../sidecar/constants";

const logger = new Logger("commands.support");

const FEEDBACK_URI = vscode.Uri.parse("https://www.surveymonkey.com/r/NYVKQD6");

function openWalkthroughCommand() {
  vscode.commands.executeCommand(
    "workbench.action.openWalkthrough",
    "confluentinc.vscode-confluent#confluent-walkthrough",
  );
}

function feedbackCommand() {
  vscode.env.openExternal(FEEDBACK_URI);
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

  vscode.commands.executeCommand("vscode.openIssueReporter", {
    extensionId: EXTENSION_ID,
    // issueTitle: "Issue title",
    // issueBody: "Issue body",
    extensionData: extensionMarkdown,
  });
}

function openSettings() {
  vscode.commands.executeCommand(
    "workbench.action.openSettings",
    "@ext:confluentinc.vscode-confluent",
  );
}

/** Open the log file for the Confluent output channel in a read-only editor document. */
async function openLogFile() {
  // TODO: check panel state first?

  // VS Code doesn't expose a way to open a non-visible output channel in an editor, so we'll just
  // open it, use a built-in command to show it in an editor, then close the panel
  await vscode.commands.executeCommand("confluent.showOutputChannel");
  vscode.commands.executeCommand("workbench.action.openActiveLogOutputFile");

  // TODO: revert to previous panel state?
  vscode.commands.executeCommand("workbench.action.closePanel");
}

/**
 * Convenience function to allow the user to download the Confluent output channel in the form of
 * a .log file.
 */
function downloadLogs() {
  const defaultPath = join(homedir(), "vscode-confluent.log");
  vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(defaultPath) }).then((saveUri) => {
    if (saveUri) {
      handleLogFileSave(saveUri, vscode.Uri.parse(LOGFILE_PATH), true);
    }
  });
}

/** Convenience function to allow the user to download the sidecar's .log file. */
async function downloadSidecarLogs() {
  const defaultPath = join(homedir(), "vscode-confluent-sidecar.log");
  const saveUri: vscode.Uri | undefined = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(defaultPath),
  });
  if (saveUri) {
    handleLogFileSave(saveUri, vscode.Uri.parse(SIDECAR_LOGFILE_PATH), true);
  }
}

function handleLogFileSave(
  fileUri: vscode.Uri | undefined,
  sourceUri: vscode.Uri,
  forSidecar: boolean = false,
) {
  if (!fileUri) {
    return;
  }

  let didWrite: boolean = false;
  vscode.workspace.fs.readFile(sourceUri).then((data) => {
    try {
      vscode.workspace.fs.writeFile(fileUri, data);
      didWrite = true;
    } catch (error) {
      if (error instanceof Error) {
        const errorMsg = `Error writing log file: ${error.message}`;
        logger.error(errorMsg);
        vscode.window.showErrorMessage(errorMsg);
      }
    }
  });
  if (!didWrite) {
    return;
  }

  const openButton = "Open File";
  vscode.window
    .showInformationMessage(
      `Confluent extension ${forSidecar ? "sidecar " : ""}log file downloaded successfully.`,
      openButton,
    )
    .then((value) => {
      if (value === openButton) {
        vscode.window.showTextDocument(fileUri);
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
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(defaultPath),
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
    vscode.window
      .showInformationMessage(
        "Confluent extension support .zip downloaded successfully",
        openButton,
      )
      .then((value) => {
        if (value === openButton) {
          // show in OS file explorer, don't try to open it in VS Code
          vscode.commands.executeCommand("revealFileInOS", saveUri);
        }
      });
    closeListener.destroy();
  });
  archive.on("error", (err) => {
    vscode.window.showErrorMessage(`Error creating zip: ${err.message}`);
  });

  archive.pipe(output);

  // add extension+sidecar log files
  const extensionLog = await vscode.workspace.fs.readFile(vscode.Uri.parse(LOGFILE_PATH));
  archive.append(Buffer.from(extensionLog), { name: "vscode-confluent.log" });
  const sidecarLog = await vscode.workspace.fs.readFile(vscode.Uri.parse(SIDECAR_LOGFILE_PATH));
  archive.append(Buffer.from(sidecarLog), { name: "vscode-confluent-sidecar.log" });

  // add observability context
  archive.append(Buffer.from(JSON.stringify(observabilityContext.toRecord())), {
    name: "observability-context.json",
  });

  // create the .zip and trigger the onClose event
  await archive.finalize();
}

export function registerSupportCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.support.confluent-walkthrough.launch",
      openWalkthroughCommand,
    ),
    registerCommandWithLogging("confluent.support.openLogFile", openLogFile),
    registerCommandWithLogging("confluent.support.downloadLogs", downloadLogs),
    registerCommandWithLogging("confluent.support.downloadSidecarLogs", downloadSidecarLogs),
    registerCommandWithLogging("confluent.support.downloadSupportZip", downloadSupportZip),
    registerCommandWithLogging("confluent.support.feedback", feedbackCommand),
    registerCommandWithLogging("confluent.support.issue", issueCommand),
    registerCommandWithLogging("confluent.support.openSettings", openSettings),
  ];
}
