import { Locator, Page } from "@playwright/test";
import { collapse, expand, isExpandable, isExpanded } from "../../../utils/expansion";

/** Object representing a tree item in a {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}. */
export class ViewItem {
  protected readonly page: Page;
  readonly locator: Locator;

  constructor(page: Page, locator: Locator) {
    this.page = page;
    this.locator = locator;
  }

  async isVisible(): Promise<boolean> {
    return await this.locator.isVisible();
  }

  async isExpandable(): Promise<boolean> {
    return isExpandable(this.locator);
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

  async hover(): Promise<void> {
    await this.locator.hover();
  }

  async click(): Promise<void> {
    await this.locator.click();
  }

  /** Click an inline {@link https://code.visualstudio.com/api/extension-guides/tree-view#view-actions action} for this item. */
  async clickInlineAction(actionName: string): Promise<void> {
    await this.hover();
    const actionButton: Locator = this.locator.getByRole("button", { name: actionName });
    if (!(await actionButton.isVisible())) {
      throw new Error(`Inline action button "${actionName}" not found for view item`);
    }
    await actionButton.click();
  }

  async isSelected(): Promise<boolean> {
    const ariaSelected: string | null = await this.locator.getAttribute("aria-selected");
    return ariaSelected === "true";
  }

  /** Get the visible text (`label` and `description`) for this item. */
  async getText(): Promise<string> {
    const text: string | null = await this.locator.textContent();
    return text?.trim() ?? "";
  }

  /** Get the icon `id` for this item. */
  async getIconId(): Promise<string> {
    const iconElement: Locator = this.locator.locator("[id]").first();
    const iconId: string | null = await iconElement.getAttribute("id");
    return iconId?.trim() ?? "";
  }

  /**
   * Get the (1-indexed) "level" of this item to represent its placement in the tree view.
   * - `1` means the item is at the root level of the view
   * - `2` means the item is a child of an expanded root level item
   * - `3` means the item is a child of an expanded child item, and so on.
   */
  async getLevel(): Promise<number> {
    const level: string | null = await this.locator.getAttribute("aria-level");
    if (!level) {
      throw new Error("View item does not have an aria-level attribute");
    }
    const parsedLevel: number = parseInt(level, 10);
    if (isNaN(parsedLevel)) {
      throw new Error(`Invalid aria-level value: ${level}`);
    }
    return parsedLevel;
  }
}
