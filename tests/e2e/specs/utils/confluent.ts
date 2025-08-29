import { expect, Page } from "@playwright/test";
import { ActivityBarItem } from "../../objects/ActivityBarItem";
import { NotificationArea } from "../../objects/notifications/NotificationArea";
import { ViewContainer } from "../../objects/ViewContainer";
import { ResourcesView } from "../../objects/views/ResourcesView";

/**
 * Clicks on the Confluent extension to load it. This is meant to be called
 * before any subsequent action is taken place.
 * @param page
 */
export async function openConfluentExtension(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");

  // make sure the activity bar item/icon is visible
  const activityBarItem = new ActivityBarItem(page, "Confluent");
  await expect(activityBarItem.locator).toBeVisible();

  // check if the view container is already visible in the primary sidebar first
  // and if not, click the activity bar item to show it
  const viewContainer = new ViewContainer(page, "confluent");
  const isVisible = await viewContainer.locator.isVisible();
  console.log(`Confluent view container is visible: ${isVisible}`);
  if (!isVisible) {
    console.log("Clicking activity bar item to open sidebar");
    await activityBarItem.locator.click();
  }

  const notificationArea = new NotificationArea(page);
  await expect(notificationArea.errorNotifications).toHaveCount(0);

  const resourcesView = new ResourcesView(page);
  // the Resources should be visible and expanded by default
  await expect(resourcesView.header).toHaveAttribute("aria-expanded", "true");
  // and should show the "Confluent Cloud" and "Local" placeholder items (not "No resources found")
  await expect(resourcesView.confluentCloudItem).toBeVisible();
  await expect(resourcesView.localItem).toBeVisible();
}
