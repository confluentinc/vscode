export enum FeatureFlag {
  /** Is this extension version enabled at all? */
  GLOBAL_ENABLED = "ide.global.enabled",
  /** Are there any notices for this version that need to be shown to users? */
  GLOBAL_NOTICES = "ide.global.notices",
  /** Is Segment enabled? */
  SEGMENT_ENABLE = "ide.segment.enable",
  /** Is CCloud usage enabled? */
  CCLOUD_ENABLE = "ide.ccloud.enable",
}
