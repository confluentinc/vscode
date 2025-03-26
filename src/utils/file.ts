import * as vscode from "vscode";
import { TextDocument } from "vscode";
import { readFile, statFile } from "./fsWrappers";

/** Check if a file URI exists in the filesystem. */
export async function fileUriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await statFile(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Representation of content retrieved from a file or editor. `openDocument` will be provided if
 * the content came from an open editor, or if the associated file is open in an editor for the
 * current workspace.
 * */
export interface LoadedDocumentContent {
  /** Contents of the editor buffer or of a file. May be the emtpy string. */
  content: string;

  /** Reference to the document if the content was loaded from an open editor. */
  openDocument?: TextDocument;
}

/**
 * Get the contents of a Uri, preferring any possibly-dirty open buffer contents
 * over saved file contents on disk.
 * @param uri The Uri of the file to read.
 * @returns A LoadedDocumentContent describing the contents of the file or editor and a reference
 * to the open document if it was read from an editor, if any.
 * @throws An error if the file cannot be read (and is not open in an editor).
 */
export async function getEditorOrFileContents(uri: vscode.Uri): Promise<LoadedDocumentContent> {
  const editor = vscode.window.visibleTextEditors.find(
    (e) => e.document.uri.toString() === uri.toString(),
  );
  if (editor) {
    return {
      content: editor.document.getText(),
      openDocument: editor.document,
    };
  }

  try {
    const fileContents = await readFile(uri);
    return {
      content: Buffer.from(fileContents).toString("utf8"),
    };
  } catch (e) {
    // wrap error
    throw new Error(`Failed to read file ${uri.toString()}: ${e}`, { cause: e });
  }
}
