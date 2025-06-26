import { Locator, Page } from "@playwright/test";

/**
 * Object representing a single
 * {@link https://code.visualstudio.com/api/ux-guidelines/notifications notification} toast in
 * the notification area.
 */
export class NotificationToast {
  constructor(
    public readonly page: Page,
    public readonly locator: Locator,
  ) {}

  /** Get the main row containing the {@linkcode icon}, message, and toolbar (gear, dismiss button). */
  get mainRow(): Locator {
    return this.locator.locator(".notification-list-item-main-row");
  }

  /** Get the notification icon element. */
  get icon(): Locator {
    return this.mainRow.locator(".notification-list-item-icon");
  }

  /** Get the main message text of the notification. */
  get message(): Locator {
    return this.mainRow.locator(".notification-list-item-message");
  }

  /** Get the toolbar container with gear and dismiss buttons. */
  get toolbar(): Locator {
    return this.mainRow.locator(".notification-list-item-toolbar-container");
  }

  /** Get the details row containing the "Source: ____" and any provided action buttons. */
  get detailsRow(): Locator {
    return this.locator.locator(".notification-list-item-details-row");
  }

  /** Get the source text (e.g., "Source: Confluent"). */
  get source(): Locator {
    return this.detailsRow.locator(".notification-list-item-source");
  }

  /** Get the buttons container in the details row. */
  get buttonsContainer(): Locator {
    return this.detailsRow.locator(".notification-list-item-buttons-container");
  }

  /** Get the progress indicator if this is a progress notification. */
  get progressIndicator(): Locator {
    return this.locator.locator(".monaco-progress-container");
  }

  /** Get the notification type based on its icon. */
  async getNotificationType(): Promise<"info" | "warning" | "error" | "progress"> {
    const hasProgress = await this.progressIndicator.isVisible();
    if (hasProgress) {
      return "progress";
    }

    const iconElement = this.icon.locator(".codicon").first();
    const className = await iconElement.getAttribute("class");
    if (className?.includes("codicon-info")) {
      return "info";
    } else if (className?.includes("codicon-warning")) {
      return "warning";
    } else if (className?.includes("codicon-error")) {
      return "error";
    }
    throw new Error(`Unknown notification type: ${className}`);
  }

  /** Get the notification icon ID (e.g., "info", "warning", "error"). */
  async getIconId(): Promise<string> {
    const iconElement = this.icon.locator(".codicon[class*='codicon-']").first();
    const className = await iconElement.getAttribute("class");
    if (className) {
      const iconMatch = className.match(/codicon-([^\s]+)/);
      if (iconMatch) {
        return iconMatch[1];
      }
    }
    return "";
  }

  /** Get the visible message text of the notification. */
  async getMessageText(): Promise<string> {
    const text = await this.message.textContent();
    return text?.trim() ?? "";
  }

  /** Click the dismiss button (X) in the notification's toolbar area. */
  async dismiss(): Promise<void> {
    const dismissButton = this.toolbar.getByRole("button", { name: "Dismiss" });
    await dismissButton.click();
  }

  /** Click a specific action button in the details row by its `buttonText`. */
  async clickActionButton(buttonText: string): Promise<void> {
    const button = this.buttonsContainer.getByRole("button", { name: buttonText });
    await button.click();
  }

  /** Wait for a progress notification to complete (progress indicator disappears). */
  async waitForProgressCompletion(): Promise<void> {
    if (await this.progressIndicator.isVisible()) {
      await this.progressIndicator.waitFor({ state: "detached" });
    }
  }
}
