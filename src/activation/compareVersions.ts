import { EXTENSION_VERSION } from "../constants";
import { Logger } from "../logging";
import { GlobalStorageKeys } from "../storage/constants";
import { getGlobalState } from "../storage/utils";
import { handleExtensionVersionUpdate } from "./updates";

const logger = new Logger("activation.compareVersions");

/** Callbacks for when the extension is newly installed or updated. */
export async function handleNewOrUpdatedExtensionInstallation() {
  // look up the previous version of the extension in global state, if any
  const previousVersion: string | undefined = await getGlobalState().get(
    GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION,
  );
  const currentVersion: string = EXTENSION_VERSION;
  logger.debug("checking for new or updated extension installation", {
    previousVersion,
    currentVersion,
  });

  // we may want to specifically check if the previous version is undefined here if we only want
  // some actions to happen on a new installation (versus a version update)
  if (previousVersion !== currentVersion) {
    await handleExtensionVersionUpdate();
  } else {
    logger.debug("extension version has not changed, no action needed");
  }

  // set the current version in global state for future reference
  logger.debug("storing last activated extension version", {
    currentVersion,
  });
  await getGlobalState().update(GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION, currentVersion);
}
