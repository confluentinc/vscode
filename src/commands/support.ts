import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";

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

function issueCommand() {
  vscode.commands.executeCommand("vscode.openIssueReporter", "confluentinc.vscode-confluent");
}

export const commands = [
  registerCommandWithLogging(
    "confluent.support.confluent-walkthrough.launch",
    openWalkthroughCommand,
  ),
  registerCommandWithLogging("confluent.support.feedback", feedbackCommand),
  registerCommandWithLogging("confluent.support.issue", issueCommand),
];
