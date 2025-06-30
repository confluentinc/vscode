import { Locator } from "@playwright/test";
import { Webview } from "./Webview";

/**
 * Object representing the Message Viewer {@link https://code.visualstudio.com/api/ux-guidelines/webviews webview}
 * that mainly appears when clicking the inline "View Messages" action on a topic item in the Topics
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}.
 */
export class MessageViewerWebview extends Webview {
  /** The top-level wrapper element containing the header/content/footer sections. */
  get wrapper(): Locator {
    return this.webview.locator("main.wrapper");
  }

  /** The header section containing all the message viewer settings and controls. */
  get messageViewerSettings(): Locator {
    return this.wrapper.locator("header.message-viewer-settings");
  }

  /** The consume settings section within the header (Working View Settings). */
  get consumeSettingsSection(): Locator {
    return this.messageViewerSettings.locator("section.consume-settings");
  }

  /** The message search section within the header (Message Quick Search). */
  get messageSearchSection(): Locator {
    return this.messageViewerSettings.getByTestId("message-quick-search");
  }

  /** The main content area containing the histogram, message grid, and banner. */
  get content(): Locator {
    return this.wrapper.locator("section.content");
  }

  /** The footer section containing pagination controls. */
  get paginationControls(): Locator {
    return this.wrapper.locator("footer.message-viewer-pagination");
  }

  // "Working View Settings" / Consume Controls area

  get partitionsButton(): Locator {
    return this.consumeSettingsSection.locator('button[popovertarget="partitionConsumeControl"]');
  }
  get partitionsPopover(): Locator {
    return this.consumeSettingsSection.locator("#partitionConsumeControl");
  }
  get consumeModeDropdown(): Locator {
    return this.consumeSettingsSection.locator("#consume-mode");
  }
  /** Timestamp input, only visible/present when {@linkcode consumeModeDropdown} is set to "timestamp". */
  get consumeModeTimestampField(): Locator {
    return this.consumeSettingsSection.locator("#consume-mode-timestamp");
  }
  get maxResultsDropdown(): Locator {
    return this.consumeSettingsSection.locator("#messages-limit");
  }
  /** The primary "Pause"/"Resume" button. */
  get streamToggleButton(): Locator {
    return this.consumeSettingsSection.locator("#stream-toggle");
  }
  /** The button that appears when any kind of response error is encountered while consuming messages. */
  get errorButton(): Locator {
    return this.consumeSettingsSection.locator('button[popovertarget="errorLog"]');
  }
  get errorPopover(): Locator {
    return this.consumeSettingsSection.locator("#errorLog");
  }
  get timeElapsedTimer(): Locator {
    return this.consumeSettingsSection.locator("consume-timer");
  }

  // "Message Quick Search" area
  get messageSearchField(): Locator {
    return this.messageSearchSection.locator("#message-search");
  }
  get partitionsFilterButton(): Locator {
    return this.messageSearchSection.locator('button[popovertarget="partitionFilterControl"]');
  }
  get partitionsFilterPopover(): Locator {
    return this.messageSearchSection.locator("#partitionFilterControl");
  }

  // Histogram+Table area

  /** "X messages streamed since YYYY-MM-DDTHH:mm:ssZ (UTC)" */
  get messageCountSinceTimestamp(): Locator {
    return this.wrapper.locator(".histogram-label").first();
  }
  get messagesHistogram(): Locator {
    return this.wrapper.locator("messages-histogram");
  }
  /** The central status indicator for various states (loading, error, paused, etc.). */
  get gridBanner(): Locator {
    return this.content.locator(".grid-banner");
  }
  /** The main table that displays the consumed messages. */
  get messagesGrid(): Locator {
    return this.content.locator("table.grid");
  }
  get columnSettingsButton(): Locator {
    return this.content.locator('th[popovertarget="columnSettings"]');
  }
  get columnSettingsPopover(): Locator {
    return this.content.locator("#columnSettings");
  }

  // footer / pagination area
  get previousPageButton(): Locator {
    return this.paginationControls.locator("#prevPage");
  }
  get nextPageButton(): Locator {
    return this.paginationControls.locator("#nextPage");
  }
  get pageStatsButton(): Locator {
    return this.paginationControls.locator("#pageOutput");
  }
  get jsonExportButton(): Locator {
    return this.paginationControls.locator('button[title="Open consumed messages as JSON"]');
  }

  /**
   * Searches for messages using the message search field.
   * @param query - The search query
   */
  async searchMessages(query: string): Promise<void> {
    await this.messageSearchField.fill(query);
    await this.messageSearchField.press("Enter");
  }

  async clearSearch(): Promise<void> {
    await this.messageSearchField.clear();
  }

  /**
   * Double-clicks on a specific message row in the table.
   * @param rowIndex - Zero-based index of the row to double-click
   */
  async doubleClickMessageRow(rowIndex: number): Promise<void> {
    await this.messagesGrid.locator("tbody tr").nth(rowIndex).dblclick();
  }
}
