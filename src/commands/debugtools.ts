import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { EXTENSION_OUTPUT_CHANNEL } from "../logging";

async function showOutputChannelCommand() {
  // make sure the Output panel is visible first
  await vscode.commands.executeCommand("workbench.panel.output.focus");
  EXTENSION_OUTPUT_CHANNEL.show();
}

export function registerDebugCommands(): vscode.Disposable[] {
  return [registerCommandWithLogging("confluent.showOutputChannel", showOutputChannelCommand)];
}
