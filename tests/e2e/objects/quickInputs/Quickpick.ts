import { Locator, Page } from "@playwright/test";
import { QuickpickItem } from "./QuickpickItem";

/**
 * Object representing a VS Code {@link https://code.visualstudio.com/api/ux-guidelines/quick-picks quickpick}.
 */
export class Quickpick {
  protected readonly page: Page;
  readonly locator: Locator;

  constructor(page: Page) {
    this.page = page;
    // VS Code quickpick appears in the main workbench area
    this.locator = page.locator(".quick-input-widget");
  }

  /**
   * Gets all visible quickpick items (excluding separators).
   */
  async getItems(options?: {
    waitForItems?: { timeout?: number; minCount?: number } | boolean;
  }): Promise<QuickpickItem[]> {
    const locator = this.locator.locator(".monaco-list-row");

    if (options?.waitForItems) {
      // wait for items to appear using the existing locator
      const waitConfig = options.waitForItems === true ? {} : options.waitForItems;
      const timeout = waitConfig.timeout ?? 10_000;
      const minCount = waitConfig.minCount ?? 1;

      await locator.first().waitFor({ state: "visible", timeout });
      const currentCount = await locator.count();
      if (currentCount < minCount) {
        throw new Error(`Expected at least ${minCount} items, but found ${currentCount}`);
      }
    }

    const count = await locator.count();
    const items: QuickpickItem[] = [];
    for (let i = 0; i < count; i++) {
      const element = locator.nth(i);
      items.push(new QuickpickItem(this.page, element));
    }
    return items;
  }

  async getLabels(): Promise<string[]> {
    const items: QuickpickItem[] = await this.getItems();

    const labels: string[] = [];
    for (const item of items) {
      const label: string | null = await item.label.textContent();
      if (label) {
        labels.push(label.trim());
      }
    }
    return labels;
  }

  /** Gets all separator labels in the quickpick. */
  async getSeparators(): Promise<string[]> {
    const items: QuickpickItem[] = await this.getItems();
    const separators: string[] = [];
    for (const item of items) {
      const separator: string | null = await item.separator.textContent();
      if (separator) {
        separators.push(separator);
      }
    }
    return separators;
  }
}
