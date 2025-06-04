import * as semver from "semver";
import { commands, workspace, WorkspaceConfiguration } from "vscode";
import { EXTENSION_VERSION } from "../constants";
import { SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS } from "../extensionSettings/constants";
import { Logger } from "../logging";
import { showInfoNotificationWithButtons } from "../notifications";
import { GlobalStorageKeys } from "../storage/constants";
import { getGlobalState } from "../storage/utils";

const logger = new Logger("activation.newInstallOrUpdate");

/** Callbacks for when the extension is newly installed or updated. */
export async function handleNewOrUpdatedExtensionInstallation() {
  // look up the previous version of the extension in global state, if any
  // (NOTE: any version before 1.4.0 will be considered a new installation here)
  const previousVersion: string | undefined = await getGlobalState().get(
    GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION,
  );
  const currentVersion: string = EXTENSION_VERSION;
  logger.debug("checking for new or updated extension installation", {
    previousVersion,
    currentVersion,
  });

  if (previousVersion === undefined) {
    await handleNewExtensionInstallation();
  } else if (previousVersion !== currentVersion) {
    await handleUpdatedExtensionInstallation(previousVersion, currentVersion);
  } else {
    logger.debug("extension version has not changed, no action needed");
  }

  // set the current version in global state for future reference
  logger.debug("storing last activated extension version", {
    currentVersion,
  });
  await getGlobalState().update(GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION, currentVersion);
}

/**
 * Handle a new extension installation.
 * This function is called when the extension is installed for the first time.
 */
export async function handleNewExtensionInstallation() {
  logger.debug("handling new extension installation");
  showFlinkPreviewNotification();
}

/**
 * Handle an updated extension installation.
 * This function is called when the extension is updated to a different version. (Usually a newer
 * version, but could be a downgrade to the time that this function was written.)
 */
export async function handleUpdatedExtensionInstallation(
  previousVersion: string,
  currentVersion: string,
) {
  logger.debug("handling updated extension installation");
  if (semver.lt(previousVersion, currentVersion)) {
    logger.debug("handling extension version upgrade", {
      previousVersion,
      currentVersion,
    });
    showFlinkPreviewNotification();
  } else if (semver.gt(previousVersion, currentVersion)) {
    logger.debug("handling extension version downgrade", {
      previousVersion,
      currentVersion,
    });
  } else {
    logger.debug("other extension version change", {
      previousVersion,
      currentVersion,
    });
  }
}

/** Check if the user has enabled notifications for new or updated extension activations. */
export function canShowNewOrUpdatedExtensionNotifications(): boolean {
  const config: WorkspaceConfiguration = workspace.getConfiguration();
  return config.get(SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS, true) === true;
}

export function showFlinkPreviewNotification() {
  // 1.4.0: show a notice about Flink being in preview mode
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
