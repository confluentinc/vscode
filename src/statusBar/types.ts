/**
 * Basic notice structure for the CCloud status bar item. The `type` will affect the background
 * color used, and the `message` will be displayed in the status bar item tooltip.
 */
export interface CCloudNotice {
  type: "maintenance" | "incident";
  message: string;
}
