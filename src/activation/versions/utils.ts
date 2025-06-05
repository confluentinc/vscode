import { workspace, WorkspaceConfiguration } from "vscode";
import { SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS } from "../../extensionSettings/constants";

/** Check if the user has enabled notifications for new or updated extension activations. */
export function canShowNewOrUpdatedExtensionNotifications(): boolean {
  const config: WorkspaceConfiguration = workspace.getConfiguration();
  return config.get(SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS, true) === true;
}
