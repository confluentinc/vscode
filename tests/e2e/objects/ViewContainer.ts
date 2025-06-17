import { Locator, Page } from "@playwright/test";

/**
 * Object representing the "Confluent"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container}.
 */
export class ViewContainer {
  private readonly page: Page;
  /** {@link Locator} for the "Confluent" view container item in the activity bar. */
  readonly locator: Locator;

  // private to use `ViewContainer.from(page)` instead of `new ViewContainer(page)` since we aren't
  // creating a "new" view container object, just accessing it from the existing page
  private constructor(page: Page) {
    this.page = page;
    this.locator = page.getByRole("tab", { name: "Confluent" }).locator("a");
  }

  /** Get the Confluent view container for the given {@link Page page} */
  static from(page: Page): ViewContainer {
    return new ViewContainer(page);
  }

  async isVisible(): Promise<boolean> {
    return await this.locator.isVisible();
  }

  async click(): Promise<void> {
    await this.locator.click();
  }

  async waitForLoad(): Promise<void> {
    await this.locator.waitFor({ state: "visible" });
  }
}
