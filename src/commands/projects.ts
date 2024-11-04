import { commands, Disposable, Uri } from "vscode";
import { registerCommandWithLogging } from ".";
import { Project } from "../models/project";

async function openProject(project: Project): Promise<void> {
  commands.executeCommand("vscode.openFolder", Uri.file(project.fsPath), true);
}

export function registerProjectCommands(): Disposable[] {
  return [registerCommandWithLogging("confluent.projects.open", openProject)];
}
