import type { Page } from "@playwright/test";
import { View } from "./View";

/**
 * Object representing the "Help Center"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view} in the "Confluent"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container}.
 */
export class HelpCenterView extends View {
  constructor(page: Page) {
    super(page, /Help Center.*/);
  }
}
