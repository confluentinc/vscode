import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { Notification } from "../objects/notifications/Notification";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { ViewContainer } from "../objects/ViewContainer";
import { ResourcesView } from "../objects/views/ResourcesView";
import { executeVSCodeCommand } from "./commands";

/**
 * Prepare a freshly-loaded VS Code workspace/window before any test interactions.
 *
 * NOTE: This should be safe to call at fixture startup (before any test has touched the window) and
 * after any workspace/window reload.
 */
export async function prepareTestWorkspace(page: Page): Promise<void> {
  // wait for the (new) VS Code window DOM + workbench shell to be ready; same waits the
  // electronApp fixture uses at initial launch
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".monaco-workbench").waitFor({ timeout: 30000 });

  // dismiss the "All installed extensions are temporarily disabled" toast that always appears
  // under --disable-extensions; tolerate it being absent on subsequent reloads
  try {
    const notificationArea = new NotificationArea(page);
    const infoNotifications = notificationArea.infoNotifications.filter({
      hasText: "All installed extensions are temporarily disabled",
    });
    await expect(infoNotifications).not.toHaveCount(0, { timeout: 2000 });
    await new Notification(page, infoNotifications.first()).dismiss();
  } catch {
    // toast wasn't present or couldn't be dismissed
  }

  // collapse the secondary sidebar if it's expanded since it isn't used for anything
  try {
    await expect(page.locator(`[id="workbench.parts.auxiliarybar"]`)).toBeVisible({
      timeout: 1000,
    });
    // use the default VS Code keybinding instead of the command palette: `Ctrl+Shift+P` can be
    // swallowed by a focused Chat webview on workspace reload, but `Ctrl+Alt+B` is a global
    // workbench keybinding that routes regardless of webview focus
    await page.keyboard.press("ControlOrMeta+Alt+B");
  } catch {
    console.warn("Error locating/toggling secondary sidebar");
  }
}

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
