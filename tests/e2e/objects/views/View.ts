import { Locator, Page } from "@playwright/test";
import { expand } from "../../utils/expansion";
import { ViewItem } from "./viewItems/ViewItem";

/**
 * Object representing a
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}.
 */
export class View {
  constructor(
    public page: Page,
    private label: string | RegExp,
  ) {}

  get locator(): Locator {
    // find the specific pane (view) that contains a pane-header button with our view label
    return this.page
      .locator(".pane")
      .filter({ has: this.page.getByRole("button", { name: this.label }) })
      .first();
  }

  /**
   * Get the header section of this view containing the title (optionally the description) and
   * any contributed nav/ungrouped action buttons.
   */
  get header(): Locator {
    return this.locator.locator(".pane-header");
  }

  /** Get the body section of this view containing the tree items and content. */
  get body(): Locator {
    return this.locator.locator(".pane-body");
  }

  /** {@link https://code.visualstudio.com/api/ux-guidelines/views#welcome-views Welcome view} locator. */
  get viewsWelcome(): Locator {
    return this.body.locator(".welcome-view-content");
  }

  /**
   * The equivalent of the built-in `<view id>.focus` command in VS Code, which locates the view,
   * expands it if necessary, and focuses it.
   */
  async focus(): Promise<void> {
    await this.header.waitFor({ state: "visible", timeout: 500 });
    await expand(this.header);
    await this.body.waitFor({ state: "visible", timeout: 500 });
    await this.locator.focus();
  }

  /** Click a nav action in the view title area by its `label`. */
  async clickNavAction(label: string): Promise<void> {
    await this.header.hover();
    this.header.getByLabel(label).click();
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
    iconId?: string;
    level?: number;
    waitForItems?: { timeout?: number; minCount?: number } | boolean;
  }): Promise<ViewItem[]> {
    const locator = this.buildFilteredLocator(options);

    if (options?.waitForItems) {
      await this.waitForFilteredItems(locator, options.waitForItems, options);
    }

    const items: ViewItem[] = [];
    const count: number = await locator.count();
    for (let i = 0; i < count; i++) {
      const element: Locator = locator.nth(i);
      const item = new ViewItem(this.page, element);
      items.push(item);
    }
    return items;
  }

  /** Build a locator with filters applied based on the provided options. */
  private buildFilteredLocator(options?: {
    text?: string | RegExp;
    iconId?: string;
    level?: number;
  }): Locator {
    let locator = this.body.locator('[role="treeitem"]');
    if (options?.level) {
      locator = this.body.locator(`[role="treeitem"][aria-level="${options.level}"]`);
    }

    if (options?.text) {
      locator = locator.filter({ hasText: options.text });
    }
    if (options?.iconId) {
      // we're already filtering the view body for tree items (maybe with a level), so
      // we just need to look for the ones that have the specified icon
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
      level?: number;
    },
  ): Promise<void> {
    const config =
      waitConfig === true ? {} : (waitConfig as { timeout?: number; minCount?: number });
    const timeout = config.timeout ?? 10_000;
    const minCount = config.minCount ?? 1;

    // 1. wait for the view itself to be ready
    await this.body.waitFor({ state: "visible", timeout });

    // 2. wait for any tree item to be visible
    const anyItemLocator = this.body.locator('[role="treeitem"]');
    try {
      await anyItemLocator.first().waitFor({ state: "visible", timeout });
    } catch (e) {
      throw new Error("No tree items found in view", { cause: e });
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
