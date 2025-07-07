import { Locator, Page } from "@playwright/test";
import { executeVSCodeCommand } from "../../utils/commands";

/**
 * Object representing a VS Code text editor document/tab.
 * Provides methods for common document operations like selecting all, replacing content, etc.
 */
export class TextDocument {
  constructor(
    private readonly page: Page,
    private readonly documentTitle: string,
  ) {}

  /** The main locator for this document's editor instance. */
  get locator(): Locator {
    return this.page.locator(`.editor-instance[aria-label*="${this.documentTitle}"]`);
  }

  /** The tab element for this document. */
  get tab(): Locator {
    return this.page.getByRole("tab", { name: this.documentTitle });
  }

  /** The editor content area where text is displayed and edited. */
  get editorContent(): Locator {
    return this.locator.getByRole("code");
  }

  /** Save the currently-focused document. */
  async save(): Promise<void> {
    await this.locator.click();
    await this.page.keyboard.press("ControlOrMeta+s");
  }

  /** Close the currently-focused document. */
  async close(): Promise<void> {
    await this.locator.click();
    // use the command ID since "View: Close Editor" will fuzzy match with others
    await executeVSCodeCommand(this.page, "workbench.action.closeActiveEditor");
  }

  /** Select all content in the document. */
  async selectAll(): Promise<void> {
    await this.locator.click();
    await this.page.keyboard.press("ControlOrMeta+a");
  }

  /** Delete all content in the document. */
  async deleteAll(): Promise<void> {
    await this.selectAll();
    await this.page.keyboard.press("Backspace");
  }

  /**
   * Insert content at the current cursor position.
   *
   * NOTE: Use `configureVSCodeSettings()` during test setup to disable auto-formatting for more
   * reliable test results.
   */
  async insertContent(content: string): Promise<void> {
    await this.locator.click();
    // we can't use `locator.fill()` since it doesn't work nicely with the monaco editor elements,
    // but we can't use `page.keyboard.type()` directly since it might miss/skip some characters
    await this.editorContent.pressSequentially(content);
  }

  /** Replace all content in the document with new content. */
  async replaceContent(content: string): Promise<void> {
    await this.deleteAll();
    await this.insertContent(content);
  }
}
