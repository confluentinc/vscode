import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { Notification } from "../objects/notifications/Notification";
import { NotificationArea } from "../objects/notifications/NotificationArea";

/**
 * Reads text from the system clipboard.
 *
 * If `notificationText` is provided, this will wait for an info notification with the specified
 * string/regex to appear and be dismissed before actually reading from the clipboard.
 *
 * NOTE: This requires the `"clipboard-read"` permission to have been granted to the Electron
 * app context beforehand, like:
 * ```ts
 * await electronApp.context().grantPermissions(["clipboard-read"]);
 * ```
 *
 * @param page The Playwright Page instance.
 * @param notificationText The string or RegExp to match in an info notification that appears, if
 * any. If `undefined`, this will immediately read and return the clipboard text.
 */
export async function readFromClipboard(
  page: Page,
  notificationText: string | RegExp | undefined = /Copied ".*" to clipboard/,
): Promise<string> {
  if (notificationText !== undefined) {
    // don't resolve until the "Copied ... to clipboard." info notification appears and is dismissed
    const notificationArea = new NotificationArea(page);
    const copyNotifications = notificationArea.infoNotifications.filter({
      hasText: notificationText,
    });
    await expect(copyNotifications).toHaveCount(1);
    const notification = new Notification(page, copyNotifications.first());
    await notification.dismiss();
  }

  return await page.evaluate(async () => await navigator.clipboard.readText());
}
