import { Locator, Page } from "@playwright/test";
import { collapse, expand, isExpanded } from "../../utils/expansion";
import { ViewItem } from "./viewItems/ViewItem";

/**
 * Object representing a
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}.
 */
export class View {
  protected readonly page: Page;
  readonly locator: Locator;
  /** {@link https://code.visualstudio.com/api/ux-guidelines/views#welcome-views Welcome view} locator. */
  readonly viewsWelcome: Locator;

  // private to use `View.from(page)` instead of `new View(page)` since we aren't
  // creating a "new" view object, just accessing it from the existing page
  protected constructor(page: Page, label: string | RegExp) {
    this.page = page;
    this.locator = page.getByLabel(label);
    this.viewsWelcome = this.page.locator(".welcome-view-content");
  }

  /** Get the view for the given {@link Page page} based on its `label`. */
  static from(page: Page, label: string | RegExp): View {
    return new View(page, label);
  }

  async focus(): Promise<void> {
    await this.waitToBeVisible();
    await expand(this.locator);
    await this.locator.focus();
  }

  async isVisible(): Promise<boolean> {
    return await this.locator.isVisible({ timeout: 500 });
  }

  async waitToBeVisible(): Promise<void> {
    await this.locator.waitFor({ state: "visible" });
  }

  async isExpanded(): Promise<boolean> {
    return isExpanded(this.locator);
  }

  async expand(): Promise<void> {
    await expand(this.locator);
  }

  async collapse(): Promise<void> {
    await collapse(this.locator);
  }

  /** Click a nav action in the view title area by its `label`. */
  async clickNavAction(label: string): Promise<void> {
    this.locator.getByLabel(label).click();
  }

  /**
   * Get all **visible** {@link ViewItem items} in this view.
   *
   * Optionally filter tree items by:
   * - `text`: tree item label+description
   * - `iconId`: can be built-in codicons like "account", "warning", etc. as well as extension-
   * contributed custom icons like "apache-kafka", "confluent-logo", etc.
   * - `level`: the tree item {@link ViewItem.getLevel level} (1-based, root items are level 1)
   *
   * Use `waitForItems: true` to wait with default settings (10s timeout, min 1 item),
   * or pass an object to customize timeout and minCount.
   */
  async getItems(options?: {
    text?: string | RegExp;
    iconId?: string | RegExp;
    level?: number;
    waitForItems?: { timeout?: number; minCount?: number } | boolean;
  }): Promise<ViewItem[]> {
    // use additional locator filters if options are provided
    let locator = this.page.locator('[role="treeitem"]');
    if (options?.text) {
      locator = locator.filter({ has: this.page.locator(`[aria-label*="${options.text}"]`) });
    }
    if (options?.level) {
      // filter for items at the specified level
      locator = locator.filter({ has: this.page.locator(`[aria-level="${options.level}"]`) });
    }
    if (options?.iconId) {
      // filter for a descendant with a codicon class matching the iconId
      // since the icon is not always directly on the uppermost div for that tree item
      locator = locator.filter({ has: this.page.locator(`.codicon.codicon-${options.iconId}`) });
    }

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
    const items: ViewItem[] = [];
    for (let i = 0; i < count; i++) {
      items.push(new ViewItem(this.page, locator.nth(i)));
    }
    return items;
  }
}
