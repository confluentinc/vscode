import { expect, Page } from "@playwright/test";
import { TextDocument } from "../objects/editor/TextDocument";

/**
 * Opens a new untitled text document in the VS Code editor area.
 * Optionally sets the language mode for the document if `language` is provided.
 */
export async function openNewUntitledDocument(
  page: Page,
  language?: string,
): Promise<TextDocument> {
  await page.keyboard.press("ControlOrMeta+N");
  const untitledDocument = new TextDocument(page, "Untitled");
  await expect(untitledDocument.tab).toBeVisible();
  await expect(untitledDocument.editorContent).toBeVisible();

  if (language) {
    await untitledDocument.setLanguageMode(language);
  }
  return untitledDocument;
}
