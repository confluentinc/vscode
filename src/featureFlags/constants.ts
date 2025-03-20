import { LDFlagSet } from "launchdarkly-electron-client-sdk";

/** Client ID to use with the LaunchDarkly SDK. Set during production builds, but can also be
 * overridden in a local .env file for testing. */
export const LD_CLIENT_ID: string | undefined =
  process.env.NODE_ENV !== "production"
    ? process.env.TEST_LAUNCHDARKLY_CLIENT_ID
    : process.env.LAUNCHDARKLY_CLIENT_ID;

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
