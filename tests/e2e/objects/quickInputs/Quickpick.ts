import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Object representing a VS Code {@link https://code.visualstudio.com/api/ux-guidelines/quick-picks quickpick}.
 */
export class Quickpick {
  constructor(public readonly page: Page) {}

  /** The main quickpick widget locator. */
  get locator(): Locator {
    return this.page.locator(".quick-input-widget");
  }

  /** The quickpick header container. */
  get header(): Locator {
    return this.locator.locator(".quick-input-header");
  }

  /**
   * Press Enter to confirm the current selection(s). This is mainly done with multi-select
   * quickpicks since clicking a single item in a regular quickpick will automatically confirm it.
   */
  async confirm(): Promise<void> {
    await this.locator.press("Enter");
  }

  /** Press Escape to cancel the input. */
  async cancel(): Promise<void> {
    await this.locator.press("Escape");
  }

  /** The quickpick input field where you can type to filter items. */
  get textInput(): Locator {
    return this.header.locator(
      ".quick-input-and-message .quick-input-filter .quick-input-box .monaco-findInput .monaco-inputbox .ibwrapper input.input",
    );
  }

  /** Get all quickpick items (rows). Use Playwright's filter methods to narrow down the selection. */
  get items(): Locator {
    return this.locator.locator(".monaco-list-row");
  }

  /**
   * Select a quickpick item by text, typing into the filter input to narrow the list first. With
   * `exact`, matches an item whose label is exactly `text` (not a substring) and asserts exactly
   * one matches before clicking, so a stale/prefix name can't silently select the wrong item.
   */
  async selectItemByText(text: string, options: { exact?: boolean } = {}): Promise<void> {
    await this.textInput.fill(text);
    // `hasText` is a substring match; `exact` instead requires a label that equals `text` so a
    // prefix/stale name (e.g. "env" against "env-2") resolves to 0 items and the guard below fires
    const filteredItems = options.exact
      ? this.items.filter({ has: this.page.getByText(text, { exact: true }) })
      : this.items.filter({ hasText: text });
    if (options.exact) {
      await expect(filteredItems).toHaveCount(1);
    }
    await filteredItems.first().click();
  }
}
