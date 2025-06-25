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
   * Gets all visible {@link QuickpickItem items} (excluding separators).
   *
   * Optionally filter quickpick items by:
   * - `text`: quickpick item label+description
   * - `iconId`: can be built-in codicons like "account", "warning", etc. as well as extension-
   * contributed custom icons like "apache-kafka", "confluent-logo", etc.
   *
   * Use `waitForItems: true` to wait with default settings (10s timeout, min 1 item),
   * or pass an object to customize timeout and minCount.
   */
  async getItems(options?: {
    text?: string | RegExp;
    iconId?: string;
    waitForItems?: { timeout?: number; minCount?: number } | boolean;
  }): Promise<QuickpickItem[]> {
    const locator = this.buildFilteredLocator(options);

    if (options?.waitForItems) {
      await this.waitForFilteredItems(locator, options.waitForItems);
    }

    const items: QuickpickItem[] = [];
    const count: number = await locator.count();
    for (let i = 0; i < count; i++) {
      const element: Locator = locator.nth(i);
      const item = new QuickpickItem(this.page, element);
      items.push(item);
    }
    return items;
  }

  /** Build a locator with filters applied based on the provided options. */
  private buildFilteredLocator(options?: { text?: string | RegExp; iconId?: string }): Locator {
    let locator = this.locator.locator(".monaco-list-row");

    if (options?.text) {
      locator = locator.filter({ hasText: options.text });
    }
    if (options?.iconId) {
      // we already set the locator for the quickpick widget, so we just need to look for the
      // ones that have the specified icon
      locator = locator.filter({ has: this.page.locator(`.codicon-${options.iconId}`) });
    }
    return locator;
  }

  /** Wait for filtered items to appear, with incremental checks for easier debugging. */
  private async waitForFilteredItems(
    locator: Locator,
    waitConfig: { timeout?: number; minCount?: number } | boolean,
    options?: {
      text?: string | RegExp;
      iconId?: string;
    },
  ): Promise<void> {
    const config =
      waitConfig === true ? {} : (waitConfig as { timeout?: number; minCount?: number });
    const timeout = config.timeout ?? 10_000;
    const minCount = config.minCount ?? 1;

    // 1. wait for the quickpick itself to be ready
    await this.locator.waitFor({ state: "visible", timeout });

    // 2. wait for any quickpick item to be visible
    const anyItemLocator = this.locator.locator(".monaco-list-row");
    try {
      await anyItemLocator.first().waitFor({ state: "visible", timeout });
    } catch (e) {
      throw new Error("No quickpick items found", { cause: e });
    }

    // 3. wait for the filtered locator to find a match
    try {
      await locator.first().waitFor({ state: "visible", timeout });
    } catch (e) {
      const allItemsCount = await anyItemLocator.count();
      const allItemsText = await anyItemLocator.allInnerTexts();
      throw new Error(
        `No items found matching filter: ${JSON.stringify(
          options,
        )}. Found ${allItemsCount} total items: [${allItemsText.join(", ")}]`,
        { cause: e },
      );
    }

    const currentCount = await locator.count();
    if (currentCount < minCount) {
      const allItemsText = await locator.allInnerTexts();
      throw new Error(
        `Expected at least ${minCount} items, but found ${currentCount}: [${allItemsText.join(
          ", ",
        )}]`,
      );
    }
  }
}
