import { LDFlagSet, LDUser } from "launchdarkly-electron-client-sdk";
import { env } from "vscode";

/** Client ID to use with the LaunchDarkly SDK. Set during production builds, but can also be
 * overridden in a local .env file for testing. */
export const LD_CLIENT_ID: string | undefined =
  process.env.NODE_ENV !== "production"
    ? process.env.TEST_LAUNCHDARKLY_CLIENT_ID
    : process.env.LAUNCHDARKLY_CLIENT_ID;

/** Initial user context, only updated during CCloud auth via {@link LDElectronMainClient.identify}. */
export const LD_CLIENT_USER_INIT: LDUser = {
  key: `${env.uriScheme}-user`,
  anonymous: true,
};

/** Options to use when starting the client via the LaunchDarkly SDK. */
export const LD_CLIENT_OPTIONS = {
  streaming: true, // Necessary in order for live flag updating to work
};

export enum FeatureFlag {
  /** Is this extension enabled at all? */
  GLOBAL_ENABLED = "ide.global.enabled",
  /** Are any specific versions of the extension disabled? */
  GLOBAL_DISABLED_VERSIONS = "ide.global.disabledVersions",
  /** Are there any notices for this version that need to be shown to users? */
  GLOBAL_NOTICES = "ide.global.notices",
  /** Is Segment enabled? */
  SEGMENT_ENABLE = "ide.segment.enable",
  /** Is CCloud usage enabled? */
  CCLOUD_ENABLE = "ide.ccloud.enable",
}

/** Default values for feature flags, to be used at startup and/or if the LaunchDarkly API is not
 * reachable. */
export const FEATURE_FLAG_DEFAULTS: LDFlagSet = {
  [FeatureFlag.GLOBAL_ENABLED]: true,
  [FeatureFlag.GLOBAL_DISABLED_VERSIONS]: [],
  [FeatureFlag.GLOBAL_NOTICES]: [],
  [FeatureFlag.SEGMENT_ENABLE]: true,
  [FeatureFlag.CCLOUD_ENABLE]: true,
};

/** Feature flags and their current values
 * (These may change based on the responses from LaunchDarkly.) */
export const FeatureFlags: LDFlagSet = {};

export const GLOBAL_DISABLED_MESSAGE = "Extension is disabled globally.";
