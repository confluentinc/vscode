import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { ActivityBarItem } from "./ActivityBarItem";
import { View } from "./views/View";

/**
 * Object representing the VS Code File Explorer view.
 * Provides methods to interact with files and folders in the explorer.
 */
export class FileExplorer extends View {
  constructor(page: Page) {
    super(page, "Explorer");
  }

  /** Override to use the more specific Explorer view ID. */
  override get locator(): Locator {
    return this.page.locator('[id="workbench.view.explorer"]');
  }

  /**
   * Ensure the Explorer view is visible.
   */
  async ensureVisible(): Promise<void> {
    try {
      await expect(this.locator).toBeVisible({ timeout: 500 });
    } catch {
      const activityBarItem = new ActivityBarItem(this.page, "Explorer");
      await expect(activityBarItem.locator).toBeVisible();
      await activityBarItem.locator.click();
      await expect(this.locator).toBeVisible();
    }
  }
}
