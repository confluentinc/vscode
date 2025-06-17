import { Locator, Page } from "@playwright/test";

/** Represents a single item in a VS Code quickpick. */
export class QuickpickItem {
  private readonly page: Page;
  readonly locator: Locator;

  constructor(page: Page, element: Locator) {
    this.page = page;
    this.locator = element;
  }

  async click(): Promise<void> {
    await this.locator.click();
  }

  async isVisible(): Promise<boolean> {
    return await this.locator.isVisible();
  }

  /** Checks if this item is currently enabled (not disabled). */
  async isEnabled(): Promise<boolean> {
    const disabled = await this.locator.getAttribute("aria-disabled");
    return disabled !== "true";
  }

  get icon(): Locator {
    return this.locator.locator(".quick-input-list-icon");
  }

  get label(): Locator {
    return this.locator.locator(".quick-input-list-label");
  }

  /** Gets the separator element locator. */
  get separator(): Locator {
    return this.locator.locator(".quick-input-list-separator");
  }
}
