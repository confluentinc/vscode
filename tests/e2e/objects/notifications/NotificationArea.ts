import { Locator, Page } from "@playwright/test";

/**
 * Object representing the
 * {@link https://code.visualstudio.com/api/ux-guidelines/notifications notification area}
 * containing all visible notifications.
 */
export class NotificationArea {
  constructor(public readonly page: Page) {}

  /** Get the main notifications container. */
  get container(): Locator {
    return this.page.locator(".notifications-toasts");
  }

  /** Get all notifications. Use Playwright's filter methods to narrow down the selection. */
  get notifications(): Locator {
    return this.container.locator(".notification-toast-container");
  }

  get progressNotifications(): Locator {
    return this.notifications.filter({ has: this.page.locator(".monaco-progress-container") });
  }

  get infoNotifications(): Locator {
    return this.notifications.filter({ has: this.page.locator(".codicon-info") });
  }

  get warningNotifications(): Locator {
    return this.notifications.filter({ has: this.page.locator(".codicon-warning") });
  }

  get errorNotifications(): Locator {
    return this.notifications.filter({ has: this.page.locator(".codicon-error") });
  }
}
