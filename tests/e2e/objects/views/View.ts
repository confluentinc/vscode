import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { InputBox } from "../quickInputs/InputBox";

/**
 * Object representing a
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}.
 */
export class View {
  constructor(
    public page: Page,
    protected label: string | RegExp,
  ) {}

  /** The main `pane` locator for this view. */
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

  /**
   * Get the progress indicator shown between the {@link header} and {@link body} when the view is
   * loading.
   */
  get progressIndicator(): Locator {
    return this.locator.locator(".monaco-progress-container.active");
  }

  /** Get the body section of this view containing the tree items and content. */
  get body(): Locator {
    return this.locator.locator(".pane-body");
  }

  /** {@link https://code.visualstudio.com/api/ux-guidelines/views#welcome-views Welcome view} locator. */
  get viewsWelcome(): Locator {
    return this.body.locator(".welcome-view-content");
  }

  /** Get all tree items in this view. */
  get treeItems(): Locator {
    return this.body.locator('[role="treeitem"]');
  }

  /**
   * Click a
   * {@link https://code.visualstudio.com/api/extension-guides/tree-view#view-actions view action}
   * (with `"group": "navigation"`) by its `label`. */
  async clickNavAction(label: string): Promise<void> {
    // the view must be expanded before we can click a nav action, since the buttons aren't visible
    // when the header is collapsed (even though the header is always visible by default)
    await this.ensureExpanded();
    await this.header.hover();
    await this.header.getByRole("button", { name: label }).click();
  }

  /** Click the tree item with the given label. */
  async clickTreeItem(label: string): Promise<void> {
    // the view must be expanded before we can click an item in it
    await this.ensureExpanded();
    const treeItem = this.treeItems.filter({ hasText: label });
    await treeItem.click();
  }

  /** Ensure the view is expanded (not collapsed). */
  async ensureExpanded(): Promise<void> {
    const isExpanded = await this.header.getAttribute("aria-expanded");
    if (isExpanded !== "true") {
      await this.header.click();
    }
    await expect(this.header).toHaveAttribute("aria-expanded", "true");
  }
}

/**
 * Object representing a
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}
 * that supports searching for tree items.
 */
export class SearchableView extends View {
  /** Click the "Search" nav action/button in this view's header. */
  async clickSearch(): Promise<void> {
    await this.clickNavAction("Search");
  }

  /** Search for a tree item by its label/name. */
  async search(query: string): Promise<void> {
    await this.ensureExpanded();
    await expect(this.progressIndicator).toBeHidden();

    // clear the "Clear Search" nav action if it's already visible
    const clearSearchButton = this.header.getByRole("button", { name: "Clear Search" });
    const hasActiveSearch = await clearSearchButton.isVisible();
    if (hasActiveSearch) {
      await clearSearchButton.click();
      await expect(clearSearchButton).toBeHidden();
    }

    await this.clickSearch();

    const inputBox = new InputBox(this.page, /Search items in the .* view/);
    await expect(inputBox.locator).toBeVisible();
    await inputBox.input.fill(query);
    await inputBox.confirm();
    await expect(inputBox.locator).toBeHidden();
  }

  /** Get a tree item by its label/name, optionally searching within a specific locator. */
  async getItemByLabel(label: string, fromLocator?: Locator): Promise<Locator> {
    // make sure we're not in any kind of loading state
    await expect(this.progressIndicator).toBeHidden();

    // filter all tree items in this view unless a specific locator is provided
    const baseLocator = fromLocator ?? this.treeItems;
    const itemLocator = baseLocator.filter({ hasText: label });

    try {
      await expect(itemLocator, {
        message: `should check if '${label}' is visible before searching`,
      }).toBeVisible({ timeout: 1000 });
      // item is in the DOM but may be partially out of view, so we may need to scroll to
      // it before any other actions can happen
      await itemLocator.scrollIntoViewIfNeeded();
      return itemLocator;
    } catch {
      // item not found, try searching for it
    }

    await this.search(label);

    await expect(itemLocator).toBeVisible();
    return itemLocator;
  }
}
