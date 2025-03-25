/**
 * Basic notice structure for the CCloud status bar item. The `level` will affect the background
 * color used, and the `message` will be displayed in the status bar item tooltip.
 *
 * If `suggestion` is provided, it will be displayed in parentheses after the `message`.
 */
export interface CCloudNotice {
  level: "warning" | "error";
  message: string;
  suggestion?: string;
}
