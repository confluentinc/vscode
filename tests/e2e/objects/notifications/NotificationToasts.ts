import { Locator, Page } from "@playwright/test";
import { NotificationToast } from "./NotificationToast";

type NotificationType = "info" | "warning" | "error" | "progress";

const NOTIFICATION_TYPE_ICON = {
  info: "codicon-info",
  warning: "codicon-warning",
  error: "codicon-error",
  progress: ".monaco-progress-container", // no special icon, just a different selector
};

/**
 * Object representing the
 * {@link https://code.visualstudio.com/api/ux-guidelines/notifications notifications} area
 * containing all visible notifications.
 */
export class NotificationToasts {
  constructor(public readonly page: Page) {}

  /** Get the main notifications container. */
  get container(): Locator {
    return this.page.locator(".notification-toasts");
  }

  /**
   * Get all visible {@link NotificationToast notification toasts}.
   *
   * Optionally filter notification toasts by:
   * - `text`: notification message text (exact match or regex)
   * - `type`: notification type ("info", "warning", "error", "progress")
   *
   * Use `waitForItems: true` to wait with default settings (10s timeout, min 1 item),
   * or pass an object to customize timeout and minCount.
   */
  async getToasts(options?: {
    text?: string | RegExp;
    type?: NotificationType;
    waitForItems?: { timeout?: number; minCount?: number } | boolean;
  }): Promise<NotificationToast[]> {
    const locator = this.buildFilteredLocator(options);

    if (options?.waitForItems) {
      await this.waitForFilteredItems(locator, options.waitForItems, options);
    }

    const items: NotificationToast[] = [];
    const count: number = await locator.count();
    for (let i = 0; i < count; i++) {
      const element: Locator = locator.nth(i);
      const item = new NotificationToast(this.page, element);
      items.push(item);
    }
    return items;
  }

  /** Find a notification by its `messageText`. */
  async findByMessage(messageText: string): Promise<NotificationToast | null> {
    const toasts = await this.getToasts({ text: messageText });
    return toasts[0] ?? null;
  }

  /** Find notifications by their `type`. */
  async findByType(type: NotificationType): Promise<NotificationToast[]> {
    return await this.getToasts({ type });
  }

  /** Build a locator with filters applied based on the provided options. */
  private buildFilteredLocator(options?: {
    text?: string | RegExp;
    type?: NotificationType;
  }): Locator {
    let locator = this.container.locator(".notification-toast-container");

    if (options?.text) {
      locator = locator.filter({ hasText: options.text });
    }
    if (options?.type) {
      if (options.type === "progress") {
        locator = locator.filter({ has: this.page.locator(NOTIFICATION_TYPE_ICON.progress) });
      } else {
        locator = locator.filter({
          has: this.page.locator(`.${NOTIFICATION_TYPE_ICON[options.type]}`),
        });
      }
    }
    return locator;
  }

  /** Wait for filtered items to appear, with incremental checks for easier debugging. */
  private async waitForFilteredItems(
    locator: Locator,
    waitConfig: { timeout?: number; minCount?: number } | boolean,
    options?: {
      text?: string | RegExp;
      type?: NotificationType;
    },
  ): Promise<void> {
    const config =
      waitConfig === true ? {} : (waitConfig as { timeout?: number; minCount?: number });
    const timeout = config.timeout ?? 10_000;
    const minCount = config.minCount ?? 1;

    // 1. wait for the notifications container to be ready
    await this.container.waitFor({ state: "visible", timeout });

    // 2. wait for any notification to be visible
    const anyToastLocator = this.container.locator(".notification-toast-container");
    try {
      await anyToastLocator.first().waitFor({ state: "visible", timeout });
    } catch (e) {
      throw new Error("No notification toasts found", { cause: e });
    }

    // 3. wait for the filtered locator to find a match
    try {
      await locator.first().waitFor({ state: "visible", timeout });
    } catch (e) {
      const allToastsCount = await anyToastLocator.count();
      const allToastsText = await anyToastLocator.allInnerTexts();
      throw new Error(
        `No notification toasts found matching filter: ${JSON.stringify(
          options,
        )}. Found ${allToastsCount} total toasts: [${allToastsText.join(", ")}]`,
        { cause: e },
      );
    }

    const currentCount = await locator.count();
    if (currentCount < minCount) {
      const allToastsText = await locator.allInnerTexts();
      throw new Error(
        `Expected at least ${minCount} notification toasts, but found ${currentCount}: [${allToastsText.join(
          ", ",
        )}]`,
      );
    }
  }
}
