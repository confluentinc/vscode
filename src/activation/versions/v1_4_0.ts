// New installation or update actions specific to extension version 1.4.0

import { commands } from "vscode";
import { SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS } from "../../extensionSettings/constants";
import { showInfoNotificationWithButtons } from "../../notifications";
import { canShowNewOrUpdatedExtensionNotifications } from "./utils";

/** Show a notification about the new Flink features in the extension. */
export function showFlinkPreviewNotification() {
  if (canShowNewOrUpdatedExtensionNotifications()) {
    void showInfoNotificationWithButtons(
      "Confluent Cloud Flink features in the extension are still being actively developed, but are now available to all users! 🎉 Please provide feedback as we continue to iterate.",
      {
        "Open Flink Settings": async () => {
          commands.executeCommand(
            "workbench.action.openSettings",
            "@ext:confluentinc.vscode-confluent flink",
          );
        },
        "Change Notification Settings": async () => {
          commands.executeCommand(
            "workbench.action.openSettings",
            `@id:${SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS}`,
          );
        },
      },
    );
  }
}
