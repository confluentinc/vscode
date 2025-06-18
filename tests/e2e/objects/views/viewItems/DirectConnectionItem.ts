import { Locator, Page } from "@playwright/test";
import { ViewItem } from "./ViewItem";

/**
 * Object representing a direct connection item in the Resources {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}.
 * This provides the following inline actions:
 * - The "Export connection details" action to save the connection configuration to a JSON file
 * - The "Edit Connection" action to modify the connection configuration
 * - The "Disconnect" action to delete the connection
 */
export class DirectConnectionItem extends ViewItem {
  constructor(page: Page, locator: Locator) {
    super(page, locator);
  }

  /** Click the "Export connection details" inline action on this item. */
  async clickExportConnectionDetails(): Promise<void> {
    await this.clickInlineAction("Export connection details");
  }

  /** Click the "Edit Connection" inline action on this item. */
  async clickEditConnection(): Promise<void> {
    await this.clickInlineAction("Edit Connection");
  }

  /** Click the "Disconnect" inline action on this item. */
  async clickDisconnect(): Promise<void> {
    await this.clickInlineAction("Disconnect");
  }
}
