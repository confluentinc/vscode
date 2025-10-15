import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { ActivityBarItem } from "../objects/ActivityBarItem";
import { ViewContainer } from "../objects/ViewContainer";
import { ResourcesView } from "../objects/views/ResourcesView";

/**
 * Clicks on the "Confluent" icon in the
 * {@link https://code.visualstudio.com/api/ux-guidelines/activity-bar activity bar} to open the
 * primary sidebar with the main Confluent
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container},
 * which activates the extension if it isn't already activated.
 *
 * For most tests, this should be done first unless another explicit extension activation event is performed.
 */
export async function openConfluentSidebar(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");

  // check if the view container is already visible in the primary sidebar first
  // and if not, click the activity bar item to show it
  const viewContainer = new ViewContainer(page, "confluent");
  const isVisible = await viewContainer.locator.isVisible();
  if (!isVisible) {
    const activityBarItem = new ActivityBarItem(page, "Confluent");
    await expect(activityBarItem.locator).toBeVisible();
    await activityBarItem.locator.click();
  }

  const resourcesView = new ResourcesView(page);
  // the Resources should be visible and expanded by default
  await expect(resourcesView.header).toHaveAttribute("aria-expanded", "true");
  // and should show the "Confluent Cloud" and "Local" placeholder items (not "No resources found")
  await expect(resourcesView.confluentCloudItem).toBeVisible();
  await expect(resourcesView.localItem).toBeVisible();
}
