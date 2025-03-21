import { commands, env } from "vscode";
import { EXTENSION_ID, EXTENSION_VERSION } from "../constants";
import { showErrorNotificationWithButtons } from "../errors";
import { Logger } from "../logging";
import { getLaunchDarklyClient } from "./client";
import { FeatureFlag, FeatureFlags, GLOBAL_DISABLED_MESSAGE } from "./constants";
import { DisabledVersion } from "./types";

const logger = new Logger("featureFlags.enablement");

/**
 * Checks if this extension is disabled globally or if this version of the extension is disabled.
 * - If the extension is **disabled**, this returns a reason (`string`) for the disablement.
 * - If the extension is **enabled**, this returns `undefined`.
 *
 * NOTE: this is called before any command invocation to ensure the extension is enabled, but will
 * block the command from being run and show an error notification to the user if the extension is
 * disabled.
 */
export async function checkForExtensionDisabledReason(): Promise<string | undefined> {
  // first check if the extension is enabled at all
  const globalEnabled: boolean | undefined = getFlagValue(FeatureFlag.GLOBAL_ENABLED);
  if (globalEnabled === undefined) {
    return;
  }
  if (!globalEnabled) {
    return GLOBAL_DISABLED_MESSAGE;
  }

  // then make sure the version of the extension is not disabled
  const disabledVersions: DisabledVersion[] | undefined = getFlagValue(
    FeatureFlag.GLOBAL_DISABLED_VERSIONS,
  );
  if (disabledVersions === undefined || !Array.isArray(disabledVersions)) {
    return;
  }
  const versionDisabled: DisabledVersion[] = disabledVersions.filter((disabled) => {
    // will only full-match against production release versions, not pre-release or local builds
    return (
      disabled.product === env.uriScheme &&
      disabled.extensionId === EXTENSION_ID &&
      disabled.version === EXTENSION_VERSION
    );
  });
  if (versionDisabled.length > 0) {
    return versionDisabled[0].reason ?? "Unspecified reason";
  }
}

/**
 * Shows a notification to the user if the extension is disabled globally or if this version of the
 * extension is disabled.
 * - If the extension is **globally disabled**, an error notification with no buttons will be shown.
 * - If **only this extension version** is disabled, an error notification with an "Update Extension"
 *   button will be shown.
 */
export async function showExtensionDisabledNotification(reason: string) {
  const msg = reason
    ? `Extension version "${EXTENSION_VERSION}" is disabled: ${reason}`
    : `Extension version "${EXTENSION_VERSION}" is disabled.`;
  logger.error(msg);

  // if the extension is disabled globally, we don't want to show the "Update Extension" button
  const buttons: Record<string, () => void> = {};
  if (reason !== GLOBAL_DISABLED_MESSAGE) {
    buttons["Update Extension"] = () => {
      commands.executeCommand("workbench.extensions.view.show");
      commands.executeCommand("workbench.extensions.search", `@id:${EXTENSION_ID}`);
    };
  }
  showErrorNotificationWithButtons(msg, buttons);
}
