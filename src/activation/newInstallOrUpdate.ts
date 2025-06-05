import { EXTENSION_VERSION } from "../constants";
import { Logger } from "../logging";
import { GlobalStorageKeys } from "../storage/constants";
import { getGlobalState } from "../storage/utils";
import { showFlinkPreviewNotification } from "./versions/v1_4_0";

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
    await handleUpdatedExtensionInstallation();
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

  if (EXTENSION_VERSION.startsWith("1.4.0")) {
    showFlinkPreviewNotification();
  }
}

/**
 * Handle an updated extension installation.
 * This function is called when the extension is updated to a different version. (Usually a newer
 * version, but could be a downgrade to the time that this function was written.)
 */
export async function handleUpdatedExtensionInstallation() {
  logger.debug("handling updated extension installation");

  if (EXTENSION_VERSION.startsWith("1.4.0")) {
    showFlinkPreviewNotification();
  }
}
