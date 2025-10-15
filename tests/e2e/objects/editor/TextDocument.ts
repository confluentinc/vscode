import type { Locator, Page } from "@playwright/test";
import { executeVSCodeCommand } from "../../utils/commands";
import { Quickpick } from "../quickInputs/Quickpick";

/** Object representing a VS Code text editor document. */
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

  /** The CodeLens action elements in the document (if any). */
  get codeLensActions(): Locator {
    return this.locator.locator("span.codelens-decoration");
  }

  /** Error diagnostic squiggles in the document. */
  get errorDiagnostics(): Locator {
    // warning diagnostics are `.cdr.squiggly-warning` and info are `.cdr.squiggly-info`,
    // but we don't use those anywhere yet
    return this.locator.locator(".cdr.squiggly-error");
  }

  /** Save the currently-focused document. */
  async save(): Promise<void> {
    await this.locator.click();
    await this.editorContent.press("ControlOrMeta+s");
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
    await this.editorContent.press("ControlOrMeta+a");
  }

  /** Delete all content in the document. */
  async deleteAll(): Promise<void> {
    await this.selectAll();
    await this.editorContent.press("Backspace");
  }

  /**
   * Insert content at the current cursor position.
   *
   * NOTE: You may need to use `configureVSCodeSettings()` during test setup to disable
   * auto-formatting for more reliable test results if the defaults are not suitable.
   */
  async insertContent(content: string): Promise<void> {
    await this.locator.click();
    // we can't use `.fill()` here since it doesn't work nicely with the monaco editor elements
    await this.editorContent.pressSequentially(content);
  }

  /** Replace all content in the document with new content. */
  async replaceContent(content: string): Promise<void> {
    await this.deleteAll();
    await this.insertContent(content);
  }

  /** Change the language mode of the document using the command palette. */
  async setLanguageMode(language: string): Promise<void> {
    await this.locator.click();
    // use the command ID since "Change Language Mode" will fuzzy match with others
    await executeVSCodeCommand(this.page, "workbench.action.editor.changeLanguageMode");

    const languageQuickpick = new Quickpick(this.page);
    await languageQuickpick.selectItemByText(language);
  }
}
