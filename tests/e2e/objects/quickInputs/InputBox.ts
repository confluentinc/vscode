import type { Locator, Page } from "@playwright/test";

/** Object representing a VS Code text input box. */
export class InputBox {
  constructor(
    public readonly page: Page,
    /** Optional pattern to filter input boxes by their `title` text. */
    public readonly titlePattern?: string | RegExp,
  ) {}

  /** The main input box widget locator. */
  get locator(): Locator {
    const baseLocator = this.page.locator(".quick-input-widget");
    if (!this.titlePattern) {
      return baseLocator;
    }

    return baseLocator.filter({
      has: this.page.locator(".quick-input-title", { hasText: this.titlePattern }),
    });
  }

  /** Get the input field within the input box. */
  get input(): Locator {
    return this.locator.locator("input");
  }

  /** Get validation message if present. */
  get validationMessage(): Locator {
    return this.locator.locator(".quick-input-message");
  }

  /** Press Enter to confirm the input. */
  async confirm(): Promise<void> {
    await this.locator.press("Enter");
  }

  /** Press Escape to cancel the input. */
  async cancel(): Promise<void> {
    await this.locator.press("Escape");
  }
}
