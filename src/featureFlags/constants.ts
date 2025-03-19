import { LDFlagSet } from "launchdarkly-electron-client-sdk";

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
