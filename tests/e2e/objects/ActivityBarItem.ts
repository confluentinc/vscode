import type { Locator, Page } from "@playwright/test";

/**
 * Object representing an item (icon) in the VS Code
 * {@link https://code.visualstudio.com/api/ux-guidelines/activity-bar activity bar}.
 */
export class ActivityBarItem {
  constructor(
    public page: Page,
    private label: string,
  ) {}

  /** The main activity bar item for this extension's view container. */
  get locator(): Locator {
    return this.page.getByRole("tab", { name: this.label }).locator("a");
  }
}
