import { Locator, Page } from "@playwright/test";

export enum NotificationType {
  Info = "info",
  Warning = "warning",
  Error = "error",
  Progress = "progress",
}

/**
 * Object representing a single
 * {@link https://code.visualstudio.com/api/ux-guidelines/notifications notification} (toast) in
 * the notification area.
 */
export class Notification {
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

  /** Click the dismiss button (X) in the notification's toolbar area. */
  async dismiss(): Promise<void> {
    const dismissButton = this.toolbar.locator(".codicon-notifications-clear");
    await dismissButton.click();
  }

  /** Click a specific action button in the details row by its `buttonText`. */
  async clickActionButton(buttonText: string): Promise<void> {
    const button = this.buttonsContainer.getByRole("button", { name: buttonText });
    await button.click();
  }
}
