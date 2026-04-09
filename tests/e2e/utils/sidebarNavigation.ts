import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { ViewContainer } from "../objects/ViewContainer";
import { ResourcesView } from "../objects/views/ResourcesView";
import { executeVSCodeCommand } from "./commands";

/**
 * Opens the primary sidebar with the main Confluent
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container},
 * which activates the extension if it isn't already activated.
 *
 * For most tests, this should be done first unless another explicit extension activation event is
 * performed.
 */
export async function openConfluentSidebar(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");

  // check if the view container is already visible in the primary sidebar first
  // and if not, use the VS Code focus command to show it
  const viewContainer = new ViewContainer(page, "confluent");
  try {
    await expect(viewContainer.locator).toBeVisible({ timeout: 2000 });
  } catch {
    // use the VS Code command rather than clicking the activity bar tab directly,
    // because the tab click toggles the sidebar: if the Confluent tab is already
    // active (but hasn't rendered yet), clicking it closes the sidebar instead of opening it
    await executeVSCodeCommand(page, "confluent-resources.focus");
    await expect(viewContainer.locator).toBeVisible();
  }

  const resourcesView = new ResourcesView(page);
  // the Resources should be visible and expanded by default
  await expect(resourcesView.header).toHaveAttribute("aria-expanded", "true");
  // and should show the "Confluent Cloud" placeholder item (not "No resources found")
  await expect(resourcesView.confluentCloudItem).toBeVisible();
  // we don't check for the "Local" item here in the event the Confluent Cloud item has children
  // and is expanded, because it may push the Local item out of view and adding logic in here to
  // scroll to it would be more complex than necessary for this utility function
}
