import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";

const FEEDBACK_URI = vscode.Uri.parse("https://forms.gle/V4aWAa1PWJRBtGgGA");
const ISSUE_URI = vscode.Uri.parse("https://forms.gle/jKH46eY3bqmCYemZA");

function openWalkthroughCommand() {
  vscode.commands.executeCommand(
    "workbench.action.openWalkthrough",
    "confluentinc.vscode-confluent#confluent-walkthrough",
  );
}

function feedbackCommand() {
  vscode.env.openExternal(FEEDBACK_URI);
}

function issueCommand() {
  vscode.env.openExternal(ISSUE_URI);
}

export const commands = [
  registerCommandWithLogging(
    "confluent.support.confluent-walkthrough.launch",
    openWalkthroughCommand,
  ),
  registerCommandWithLogging("confluent.support.feedback", feedbackCommand),
  registerCommandWithLogging("confluent.support.issue", issueCommand),
];
