import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { executeVSCodeCommand } from "../utils/commands";
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
      await expect(this.locator).toBeVisible({ timeout: 2000 });
    } catch {
      // use the VS Code command rather than clicking the activity bar tab directly, because
      // clicking the tab icon toggles the sidebar which may accidentally close it
      await executeVSCodeCommand(this.page, "workbench.view.explorer");
      await expect(this.locator).toBeVisible();
    }
  }
}
