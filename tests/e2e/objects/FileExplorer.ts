import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { ActivityBarItem } from "./ActivityBarItem";
import { View } from "./views/View";
import { ViewItem } from "./views/viewItems/ViewItem";

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
   * Find a file in the explorer by its name.
   * @param fileName - The name of the file to find
   * @returns A locator for the file item
   */
  findFile(fileName: string): Locator {
    return this.treeItems.filter({ hasText: fileName });
  }

  /**
   * Right-click on a file and select a context menu action.
   * @param fileName - The name of the file to right-click
   * @param actionName - The name of the context menu action to select
   */
  async rightClickFileAndSelectAction(fileName: string, actionName: string): Promise<void> {
    const fileLocator = this.findFile(fileName);
    await expect(fileLocator).toBeVisible();

    const fileItem = new ViewItem(this.page, fileLocator);
    await fileItem.rightClickContextMenuAction(actionName);
  }

  /**
   * Ensure the Explorer view is visible.
   */
  async ensureVisible(): Promise<void> {
    const isVisible = await this.locator.isVisible();
    if (!isVisible) {
      const activityBarItem = new ActivityBarItem(this.page, "Explorer");
      await expect(activityBarItem.locator).toBeVisible();
      await activityBarItem.locator.click();
      await expect(this.locator).toBeVisible();
    }
  }
}
