import { LDElectronMainClient } from "launchdarkly-electron-client-sdk";
import { env } from "vscode";
import { EXTENSION_ID, EXTENSION_VERSION } from "../constants";
import { getLaunchDarklyClient } from "./client";
import { FeatureFlag, FeatureFlags } from "./constants";
import { DisabledVersion } from "./types";

/**
 * Checks if this extension is disabled globally or if this version of the extension is disabled.
 * - If the extension is **disabled**, this returns a reason (`string`) for the disablement.
 * - If the extension is **enabled**, this returns `undefined`.
 */
export async function checkForExtensionDisabledReason(): Promise<string | undefined> {
  const ldClient: LDElectronMainClient | undefined = getLaunchDarklyClient();
  await ldClient?.waitForInitialization();

  // first check if the extension is enabled at all
  const globalEnabled: boolean = FeatureFlags[FeatureFlag.GLOBAL_ENABLED];
  if (!globalEnabled) {
    return "Extension is disabled globally.";
  }

  // then make sure the version of the extension is not disabled
  const disabledVersions: DisabledVersion[] = FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS];
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
