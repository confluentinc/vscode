import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Object representing a
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}.
 */
export class View {
  constructor(
    public page: Page,
    private label: string | RegExp,
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
