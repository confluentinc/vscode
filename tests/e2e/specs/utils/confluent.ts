import { Page } from "@playwright/test";
import { ActivityBar } from "../../objects/activityBar/ActivityBar";

/**
 * Activates the Confluent extension by clicking on its tab on the activity bar, which opens the
 * Confluent sidebar (view container) and makes its views available.
 */
export async function openConfluentSidebar(page: Page): Promise<void> {
  const activityBar = new ActivityBar(page);
  await activityBar.confluentTab.click();
}
