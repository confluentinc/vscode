import { EXTENSION_VERSION } from "../constants";
import { Logger } from "../logging";
import { showFlinkPreviewNotification } from "./versions/v1_4";

const logger = new Logger("activation.updates");

/**
 * Handle an updated extension installation.
 * This function is called when the extension is updated to a different version. (Usually a newer
 * version, but could be a downgrade to the time that this function was written.)
 */
export async function handleExtensionVersionUpdate() {
  logger.debug("handling updated extension installation");

  if (EXTENSION_VERSION.startsWith("1.4.")) {
    showFlinkPreviewNotification();
  }
  // add more version-specific update handlers here as needed
  // e.g., if (EXTENSION_VERSION.startsWith("1.5.")) { ... }
}
