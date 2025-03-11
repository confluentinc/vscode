import archiver from "archiver";
import { createWriteStream } from "fs";
import { Uri, commands, window, workspace } from "vscode";
import { Logger } from "../../logging";

const logger = new Logger("commands.utils.zipFiles");

/** File to include in a zip archive */
export interface ZipFileEntry {
  sourceUri: Uri;
  zipPath: string;
}

/** Data to include directly in a zip archive */
export interface ZipContentEntry {
  content: string | Buffer;
  zipPath: string;
}

/** * Creates a zip file from file(s) and/or string or Buffer content. */
export async function createZipFile(
  saveUri: Uri,
  fileEntries: ZipFileEntry[] = [],
  contentEntries: ZipContentEntry[] = [],
  successMessage: string = "File saved successfully.",
): Promise<void> {
  const output = createWriteStream(saveUri.fsPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  // set up event listeners for write errors & close/finalize
  const closeListener = output.on("close", () => {
    const openButton = "Open";
    window.showInformationMessage(successMessage, openButton).then((value) => {
      if (value === openButton) {
        // show in OS file explorer, don't try to open it in VS Code
        commands.executeCommand("revealFileInOS", saveUri);
      }
    });
    closeListener.destroy();
  });

  const errorListener = archive.on("error", (err) => {
    window.showErrorMessage(`Error creating zip: ${err.message}`);
    errorListener.destroy();
  });

  archive.pipe(output);

  // add content entries
  for (const contentEntry of contentEntries) {
    archive.append(contentEntry.content, { name: contentEntry.zipPath });
  }

  // add file entries
  try {
    for (const fileEntry of fileEntries) {
      try {
        const fileData = await workspace.fs.readFile(fileEntry.sourceUri);
        archive.append(Buffer.from(fileData), { name: fileEntry.zipPath });
      } catch (error) {
        logger.error(`Could not read file ${fileEntry.sourceUri.fsPath}`, error);
      }
    }
    await archive.finalize();
  } catch (err) {
    logger.error("Error processing files for zip", err);
  }
}
