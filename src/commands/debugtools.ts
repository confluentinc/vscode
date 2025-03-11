import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { SIDECAR_OUTPUT_CHANNEL } from "../constants";
import { OUTPUT_CHANNEL } from "../logging";

async function showOutputChannelCommand() {
  // make sure the Output panel is visible first
  await vscode.commands.executeCommand("workbench.panel.output.focus");
  OUTPUT_CHANNEL.show();
}

async function showSidecarOutputChannelCommand() {
  // make sure the Output panel is visible first
  await vscode.commands.executeCommand("workbench.panel.output.focus");
  SIDECAR_OUTPUT_CHANNEL.show();
}

export function registerDebugCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.showOutputChannel", showOutputChannelCommand),
    registerCommandWithLogging(
      "confluent.showSidecarOutputChannel",
      showSidecarOutputChannelCommand,
    ),
  ];
}
