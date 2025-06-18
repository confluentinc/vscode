import { Locator, Page } from "@playwright/test";

/** Object representing a tree item in a {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}. */
export class ViewItem {
  constructor(
    public readonly page: Page,
    public readonly locator: Locator,
  ) {}

  /** Click an inline {@link https://code.visualstudio.com/api/extension-guides/tree-view#view-actions action} for this item. */
  async clickInlineAction(actionName: string): Promise<void> {
    await this.locator.hover();
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
