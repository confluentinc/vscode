import type { TextDocument, Uri } from "vscode";
import { workspace } from "vscode";
import { Logger } from "../../logging";

const logger = new Logger("quickpicks.utils.workspace");

/**
 * Try to {@link workspace.openTextDocument open a text document} for the given URI.
 * Returns `undefined` if the document cannot be opened as text (e.g. binary files).
 * @param uri - The {@link Uri} of the document to open
 * @returns The {@link TextDocument} if successful, `undefined` otherwise
 */
export async function tryToOpenTextDocument(uri: Uri): Promise<TextDocument | undefined> {
  try {
    return await workspace.openTextDocument(uri);
  } catch (error) {
    logger.warn(`Failed to open document at ${uri.toString()}: ${error}`);
  }
}
