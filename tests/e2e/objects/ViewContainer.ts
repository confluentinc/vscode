import { Locator, Page } from "@playwright/test";

/**
 * Object representing a
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container}
 * in the VS Code sidebar.
 */
export class ViewContainer {
  constructor(
    public page: Page,
    private viewContainerId: string,
  ) {}

  get locator(): Locator {
    return this.page.locator(`[id="workbench.view.extension.${this.viewContainerId}"]`);
  }
}
