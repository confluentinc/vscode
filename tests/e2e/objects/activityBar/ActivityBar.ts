import { Locator, Page } from "@playwright/test";

/**
 * Object representing the VS Code
 * {@link https://code.visualstudio.com/api/ux-guidelines/activity-bar Activity Bar}
 */
export class ActivityBar {
  constructor(public page: Page) {}

  /** The main activity bar container locator. */
  get locator(): Locator {
    return this.page.locator(".part.activitybar");
  }

  /** Get all activity bar items (tabs). */
  get items(): Locator {
    return this.locator.locator('[role="tablist"] [role="tab"]');
  }

  /** Get the Confluent activity bar tab specifically. */
  get confluentTab(): Locator {
    return this.items.filter({ has: this.page.getByLabel("Confluent") });
  }
}
