import { Locator, Page } from "@playwright/test";

/**
 * Object representing a VS Code {@link https://code.visualstudio.com/api/ux-guidelines/quick-picks quickpick}.
 */
export class Quickpick {
  constructor(public readonly page: Page) {}

  /** The main quickpick widget locator. */
  get locator(): Locator {
    return this.page.locator(".quick-input-widget");
  }

  /** Get all quickpick items (rows). Use Playwright's filter methods to narrow down the selection. */
  get items(): Locator {
    return this.locator.locator(".monaco-list-row");
  }
}
