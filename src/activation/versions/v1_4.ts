// New installation or update actions specific to extension version 1.4.x

import { commands } from "vscode";
import { EXTENSION_ID } from "../../constants";
import { SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS } from "../../extensionSettings/constants";
import { showInfoNotificationWithButtons } from "../../notifications";
import { canShowNewOrUpdatedExtensionNotifications } from "./utils";

export const FLINK_PREVIEW_MESSAGE =
  "Confluent Cloud Flink features in the extension are still being actively developed, but are now available to all users! 🎉 Please provide feedback as we continue to iterate.";

/** Show a notification about the new Flink features in the extension. */
export function showFlinkPreviewNotification() {
  if (canShowNewOrUpdatedExtensionNotifications()) {
    // future branch: will be good to make a wrapper for this notification to always include the
    // "Change Notification Settings" button, so we don't have to repeat it
    void showInfoNotificationWithButtons(FLINK_PREVIEW_MESSAGE, {
      "Open Flink Settings": () => {
        void commands.executeCommand("workbench.action.openSettings", `@ext:${EXTENSION_ID} flink`);
      },
      "Change Notification Settings": () => {
        void commands.executeCommand(
          "workbench.action.openSettings",
          `@id:${SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS}`,
        );
      },
    });
  }
}
