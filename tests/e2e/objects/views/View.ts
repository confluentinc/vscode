import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { InputBox } from "../quickInputs/InputBox";
import { ViewItem } from "./viewItems/ViewItem";

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

  /** Get the tree view message element shown in the body (e.g. search result counts). */
  get viewMessage(): Locator {
    return this.body.locator(".message");
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
    const action = this.header.getByRole("button", { name: label });
    // avoid race condition where action isn't visible before clicking
    await expect(action).toBeVisible();
    await action.click();
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

  /**
   * Wait for a {@link ResourceContainer} tree item to finish loading: first that the loading
   * spinner (`codicon-loading`) has cleared, then that the container did not settle into an error
   * state (`codicon-warning`, set by {@linkcode ResourceContainer.setError}). A settled, non-error
   * container has had {@linkcode ResourceContainer.setLoaded} called and its children populated.
   *
   * Use after waiting for {@linkcode progressIndicator} when a specific container's data must be
   * ready, not just the view-level progress bar cleared.
   */
  async waitForContainerLoaded(containerLocator: Locator): Promise<void> {
    const containerItem = new ViewItem(this.page, containerLocator);
    await expect(containerItem.icon).not.toHaveClass(/codicon-loading/);
    // a settled container is loaded or errored; assert against the error icon so a failed load fails
    // here, not later as a confusing "no items match" search miss
    await expect(containerItem.icon).not.toHaveClass(/codicon-warning/);
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

  /** Determine whether a search is currently applied in this view. */
  async isSearchApplied(): Promise<boolean> {
    await this.ensureExpanded();
    // make sure we're not in any kind of loading state
    await expect(this.progressIndicator).toBeHidden();

    await this.header.hover();
    const clearSearchButton = this.header.getByRole("button", { name: "Clear Search" });
    try {
      await expect(clearSearchButton).toBeVisible({ timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Search for a tree item by its label/name. */
  async search(query: string): Promise<void> {
    // clear the "Clear Search" nav action if it's already visible
    if (await this.isSearchApplied()) {
      const clearSearchButton = this.header.getByRole("button", { name: "Clear Search" });
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

  /**
   * Find a tree item by its label/name via {@link search searching}, re-running the search until
   * the item appears. Views refresh asynchronously (event- or poll-driven), so the item may be
   * absent on the first search; the retry absorbs that. Searching also narrows the virtualized tree
   * so the item is rendered without scrolling. Waits for the search-result message to settle before
   * returning so it doesn't later intercept pointer events on the item's actions.
   *
   * @param label The tree item label (or substring) to find.
   * @param fromLocator Base locator to filter; defaults to all tree items in the view.
   * @returns A Locator for the single matching tree item.
   */
  async getItemByLabel(label: string, fromLocator?: Locator): Promise<Locator> {
    const itemLocator = (fromLocator ?? this.treeItems).filter({ hasText: label });
    await expect(async () => {
      await this.search(label);
      await expect(itemLocator).toHaveCount(1, { timeout: 2_000 });
    }).toPass({ timeout: 30_000, intervals: [1_000, 2_000, 5_000] });
    await expect(itemLocator).toBeVisible();
    await expect(this.viewMessage).toBeVisible();
    return itemLocator.first();
  }
}
