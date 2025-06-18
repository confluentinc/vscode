import { Locator, Page } from "@playwright/test";
import { Webview } from "./Webview";

/**
 * Object representing the Message Viewer {@link https://code.visualstudio.com/api/ux-guidelines/webviews webview}
 * that mainly appears when clicking the inline "View Messages" action on a topic item in the Topics
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}.
 */
export class MessageViewerWebview extends Webview {
  constructor(page: Page) {
    super(page);
  }

  // "Working View Settings" / Consume Controls area

  get partitionsButton(): Locator {
    return this.webview.locator('button[popovertarget="partitionConsumeControl"]');
  }
  get partitionsPopover(): Locator {
    return this.webview.locator("#partitionConsumeControl");
  }
  get consumeModeDropdown(): Locator {
    return this.webview.locator("#consume-mode");
  }
  /** Timestamp input, only visible/present when {@linkcode consumeModeDropdown} is set to "timestamp". */
  get consumeModeTimestampField(): Locator {
    return this.webview.locator("#consume-mode-timestamp");
  }
  get maxResultsDropdown(): Locator {
    return this.webview.locator("#messages-limit");
  }
  /** The primary "Pause"/"Resume" button. */
  get streamToggleButton(): Locator {
    return this.webview.locator("#stream-toggle");
  }
  /** The button that appears when any kind of response error is encountered while consuming messages. */
  get errorButton(): Locator {
    return this.webview.locator('button[popovertarget="errorLog"]');
  }
  get errorPopover(): Locator {
    return this.webview.locator("#errorLog");
  }
  get timeElapsedTimer(): Locator {
    return this.webview.locator("consume-timer");
  }
  /** Main locators for the "Working View Settings" area. */
  get workingViewSettingsControls(): Locator[] {
    return [
      this.partitionsButton,
      this.consumeModeDropdown,
      this.maxResultsDropdown,
      this.streamToggleButton,
      this.timeElapsedTimer,
    ];
  }

  // "Message Quick Search" area
  get messageSearchField(): Locator {
    return this.webview.locator("#message-search");
  }
  get partitionsFilterButton(): Locator {
    return this.webview.locator('button[popovertarget="partitionFilterControl"]');
  }
  get partitionsFilterPopover(): Locator {
    return this.webview.locator("#partitionFilterControl");
  }
  /** Main locators for the "Message Quick Search" area. */
  get messageQuickSearchControls(): Locator[] {
    return [this.messageSearchField, this.partitionsFilterButton];
  }
  /**
   * All main header control locators from {@linkcode workingViewSettingsControls} and
   * {@linkcode messageQuickSearchControls}.
   */
  get headerControls(): Locator[] {
    return [...this.workingViewSettingsControls, ...this.messageQuickSearchControls];
  }

  // Histogram+Table area

  /** "X messages streamed since YYYY-MM-DDTHH:mm:ssZ (UTC)" */
  get messageCountSinceTimestamp(): Locator {
    return this.webview.locator(".histogram-label").first();
  }
  get messagesHistogram(): Locator {
    return this.webview.locator("messages-histogram");
  }
  /** The central status indicator for {@linkcode isL} */
  get gridBanner(): Locator {
    return this.webview.locator(".grid-banner");
  }
  /** The main table that displays the consumed messages. */
  get messagesGrid(): Locator {
    return this.webview.locator("table.grid");
  }
  get columnSettingsButton(): Locator {
    return this.webview.locator('th[popovertarget="columnSettings"]');
  }
  get columnSettingsPopover(): Locator {
    return this.webview.locator("#columnSettings");
  }

  // footer / pagination area
  get previousPageButton(): Locator {
    return this.webview.locator("#prevPage");
  }
  get nextPageButton(): Locator {
    return this.webview.locator("#nextPage");
  }
  get pageStatsButton(): Locator {
    return this.webview.locator("#pageOutput");
  }
  get jsonExportButton(): Locator {
    return this.webview.locator('button[title="Open consumed messages as JSON"]');
  }
  get paginationSection(): Locator {
    return this.webview.locator("footer.message-viewer-pagination");
  }

  async waitForLoad(): Promise<void> {
    // the top-level <main class="wrapper"> from `src/webviews/message-viewer.html`
    await this.webview.locator("main.wrapper").waitFor({ state: "visible", timeout: 10_000 });
  }

  /**
   * Waits for the message viewer to load and verifies it's in a valid operational state.
   * This is a utility method that combines waiting for load with basic state validation,
   * useful for test setup where you just need to ensure the message viewer is ready for use.
   *
   * @param timeout - Optional timeout for waiting operations (default: 10000ms)
   */
  async waitForLoadAndValidateState(timeout: number = 10_000): Promise<void> {
    await this.waitForLoad();
    // should now be visible in the editor area with some of the main controls
    await this.locator.waitFor({ state: "visible", timeout });
    await this.messageSearchField.waitFor({ state: "visible", timeout: 5_000 });
    await this.gridBanner.waitFor({ state: "visible", timeout: 5_000 });

    // it should also show some of the top-level controls and be in a loading, error,
    // or got-some-messages state
    const [isLoading, hasMessages, hasLoadError, isPaused, hasEmptyFilter] = await Promise.all([
      this.isWaitingForMessages(),
      this.hasMessages(),
      this.hasLoadError(),
      this.isPaused(),
      this.hasEmptyFilterResult(),
    ]);
    const isInValidState = isLoading || hasMessages || hasLoadError || isPaused || hasEmptyFilter;
    if (!isInValidState) {
      throw new Error(
        "Message viewer is not in a recognizable state. Expected one of: loading, has messages, has error, paused, or empty filter result.",
      );
    }
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

  /** Checks if the "Waiting for messages..." state is displayed (stream is running). */
  async isWaitingForMessages(): Promise<boolean> {
    return await this.gridBanner
      .filter({ has: this.webview.locator("vscode-progress-ring") })
      .filter({ hasText: "Waiting for messages…" })
      .isVisible({ timeout: 500 });
  }

  /** Checks if the "Paused" state is displayed (stream is paused). */
  async isPaused(): Promise<boolean> {
    return await this.gridBanner
      .filter({ has: this.webview.locator(".codicon-debug-pause") })
      .filter({ hasText: "Paused" })
      .isVisible({ timeout: 500 });
  }

  /** Checks if the "Failed to load messages" error state is displayed. */
  async hasLoadError(): Promise<boolean> {
    return await this.gridBanner
      .filter({ has: this.webview.locator(".codicon-error") })
      .filter({ hasText: "Failed to load messages." })
      .isVisible({ timeout: 500 });
  }

  /** Checks if the "Unable to find messages for currently set filters" state is displayed. */
  async hasEmptyFilterResult(): Promise<boolean> {
    return await this.gridBanner
      .filter({ hasText: "Unable to find messages for currently set filters" })
      .isVisible({ timeout: 500 });
  }

  /** Checks if messages are currently displayed in the table. */
  async hasMessages(): Promise<boolean> {
    return await this.messagesGrid.isVisible({ timeout: 500 });
  }
}
