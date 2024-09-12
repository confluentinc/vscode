import { workspace, WorkspaceConfiguration } from "vscode";

/** Convenience function for getting the configuration settings for the extension. */
export function getConfigs(): WorkspaceConfiguration {
  return workspace.getConfiguration("confluent");
}
