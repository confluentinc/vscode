import { QuickPickItem, TextDocument } from "vscode";

/**
 * Extension of {@link QuickPickItem} to include an associated `value` for easier matching on
 * user selection. Unlike `label`, `description`, and `detail`, `value` is not displayed in the
 * quick pick UI.
 */
export type QuickPickItemWithValue<T> = QuickPickItem & {
  value?: T | undefined;
};

/** Representation of content retrieved from a file or editor. `openDocument` will be provided if
 * the content came from an open editor, or if the associated file is open in an editor for the
 * current workspace. */
export interface LoadedDocumentContent {
  content: string;
  openDocument?: TextDocument;
}
