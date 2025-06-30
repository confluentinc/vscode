import { Locator, Page } from "@playwright/test";

/** Object representing a tree item in a {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}. */
export class ViewItem {
  constructor(
    public readonly page: Page,
    public readonly locator: Locator,
  ) {}

  /** Get the icon element for this tree item. */
  get icon(): Locator {
    return this.locator.locator(".custom-view-tree-node-item-icon");
  }

  /** Get the label container for this tree item. */
  get label(): Locator {
    return this.locator.locator(".monaco-icon-name-container .label-name");
  }

  /** Get the description text if present (appears next to the label). */
  get description(): Locator {
    return this.locator.locator(".monaco-icon-description-container");
  }

  /** Get the inline actions container for buttons. */
  get inlineActions(): Locator {
    return this.locator.locator(".actions .actions-container");
  }

  /**
   * Click a
   * {@link https://code.visualstudio.com/api/extension-guides/tree-view#view-actions view item action}
   * (with `"group": "inline"`) by its `label`. */
  async clickInlineAction(actionName: string): Promise<void> {
    await this.locator.hover();
    await this.inlineActions.getByRole("button", { name: actionName }).click();
  }
}
