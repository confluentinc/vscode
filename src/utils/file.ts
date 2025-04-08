import { join } from "path";
import * as vscode from "vscode";
import { TextDocument } from "vscode";
import { logError } from "../errors";
import { Logger } from "../logging";
import { deleteFile, readFile, statFile, tmpdir, writeFile } from "./fsWrappers";

const logger = new Logger("utils/file");

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
  const document = vscode.workspace.textDocuments.find((e) => e.uri.toString() === uri.toString());
  if (document) {
    return {
      content: document.getText(),
      openDocument: document,
    };
  }

  try {
    return {
      content: await readFile(uri),
    };
  } catch (e) {
    // wrap error
    throw new Error(`Failed to read file ${uri.toString()}: ${e}`, { cause: e });
  }
}

export class WriteableTmpDir {
  static instance: WriteableTmpDir | undefined;

  static getInstance(): WriteableTmpDir {
    if (!WriteableTmpDir.instance) {
      WriteableTmpDir.instance = new WriteableTmpDir();
    }
    return WriteableTmpDir.instance;
  }

  /** As determined by {@link determine} */
  private _tmpdir: string | undefined;

  private constructor() {
    // Private constructor to prevent external instantiation
  }

  /**
   * Determine a writeable temporary directory. This is a best-effort attempt.
   *
   * Should be called at extension startup to make subsequent calls to
   * {@link get}.
   *
   * (We have reports that when installed through JamfAppInstallers on OSX, tmpdir() is not actually writeable.)
   */
  async determine(): Promise<void> {
    const possibleDirs = [
      tmpdir(), // Should work on all platforms, but JamfAppInstallers on OSX may mangle?
      process.env["TMPDIR"], // UNIX-y, but should also have been what tmpdir() returned.
      process.env["TEMP"], // Windows-y, probably also what tmpdir() returns on Windows.
      process.env["TMP"], // sometimes Windows-y
      "/var/tmp", // UNIX-y
      "/tmp", // UNIX-y
      "/private/tmp", // macOS
    ];
    const errorsEncountered: Error[] = [];

    for (const dir of possibleDirs) {
      if (!dir) {
        continue; // Skip undefined or null directories
      }
      try {
        // Check if the directory is writeable
        const fileUri = vscode.Uri.file(join(dir, ".vscode_test.tmp"));
        await writeFile(fileUri, Buffer.from("test"));
        await deleteFile(fileUri);
        this._tmpdir = dir;
        logger.info(`Found writeable tmpdir: ${dir}`);
        return;
      } catch (e) {
        logger.warn(`Failed to write to ${dir}: ${e}`);
        errorsEncountered.push(e as Error);
        // Ignore errors and try the next directory
      }
    }

    logError(
      logger,
      "determineWriteableTmpDir(): No writeable tmpdir found.",
      {
        attemptedDirs: possibleDirs.join("; "),
        errorsEncountered: errorsEncountered.map((e) => e.message).join("; "),
      },
      true,
    );

    throw new Error("No writeable tmpdir found");
  }

  /** Return the determined writeable tmpdir. Must have awaited determineWriteableTmpDir() prior. */
  get(): string {
    if (this._tmpdir) {
      return this._tmpdir;
    }

    throw Error("get() called before determine() was awaited.");
  }
}
