import { Locator, Page } from "@playwright/test";

/** Object representing a VS Code text input box. */
export class InputBox {
  constructor(public readonly page: Page) {}

  /** The main input box widget locator. */
  get locator(): Locator {
    return this.page.locator(".quick-input-widget");
  }

  /** Get the input field within the input box. */
  get input(): Locator {
    return this.locator.locator("input");
  }

  /** Get the placeholder text from the input field. */
  get placeholder(): Locator {
    return this.input;
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
