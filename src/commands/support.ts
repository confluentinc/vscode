import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { observabilityContext } from "../context/observability";

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
  const extensionMarkdown = `
<details open="true">
<summary>Confluent Extension + Sidecar Data</summary>

${observabilityContext.toMarkdownTable()}

</details>
`;

  vscode.commands.executeCommand("vscode.openIssueReporter", {
    extensionId: "confluentinc.vscode-confluent",
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

export function registerSupportCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.support.confluent-walkthrough.launch",
      openWalkthroughCommand,
    ),
    registerCommandWithLogging("confluent.support.feedback", feedbackCommand),
    registerCommandWithLogging("confluent.support.issue", issueCommand),
    registerCommandWithLogging("confluent.support.openSettings", openSettings),
  ];
}
