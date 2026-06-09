import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { NotificationArea } from "../notifications/NotificationArea";
import { SearchableView } from "./View";
import { ViewItem } from "./viewItems/ViewItem";

/**
 * Object representing the "Flink Statements"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}, which lists the
 * Flink SQL statements for the currently-selected compute pool or environment.
 */
export class FlinkStatementsView extends SearchableView {
  constructor(page: Page) {
    super(page, "Flink Statements");
  }

  /** All Flink statement tree items currently shown for the selected compute pool or environment. */
  get statements(): Locator {
    // no nested resources or mixed resource types in this view
    return this.treeItems;
  }

  /**
   * Delete a Flink statement by name via its right-click "Delete Statement" context-menu action.
   *
   * The statement must already be in a terminal/stopped state, since the extension only offers
   * "Delete Statement" for deletable statements; stop it first (see
   * {@link stopStatement}). Verifies the deletion via the success notification.
   */
  async deleteStatement(name: string): Promise<void> {
    const statementLocator: Locator = await this.getItemByLabel(name, this.statements);

    // the "Delete Statement" is only visible when the statement reaches a terminal phase based on
    // its context value including "deletable", otherwise we'll only see the 'Copy Name' action
    await expect(statementLocator).toContainText(/STOPPED|COMPLETED|FAILED/, { timeout: 60_000 });
    const item = new ViewItem(this.page, statementLocator);
    await item.locator.scrollIntoViewIfNeeded();
    await expect(item.locator).toBeVisible();
    await item.rightClickContextMenuAction("Delete Statement");

    const notificationArea = new NotificationArea(this.page);
    const deleted = notificationArea.infoNotifications.filter({
      hasText: `Deleted statement ${name}`,
    });
    await expect(deleted).not.toHaveCount(0);
  }
}
