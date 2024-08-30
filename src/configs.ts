import { workspace, WorkspaceConfiguration } from "vscode";
import { Logger } from "./logging";

const logger = new Logger("configs");

export function getConfigs(): WorkspaceConfiguration {
  const configs = workspace.getConfiguration("confluent");
  logger.debug("configs", configs);
  return configs;
}
