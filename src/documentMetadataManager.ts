import { TextDocument, Uri, workspace } from "vscode";
import { FLINKSTATEMENT_URI_SCHEME } from "./documentProviders/flinkStatement";
import { Logger } from "./logging";
import { getResourceManager } from "./storage/resourceManager";
import { UriMetadataMap } from "./storage/types";
import { BaseDisposableManager } from "./utils/disposables";

const logger = new Logger("documentMetadataManager");

// Central list of supported URI schemes
const SUPPORTED_URI_SCHEMES = ["file", "untitled", FLINKSTATEMENT_URI_SCHEME];

/** Manager for VS Code {@link TextDocument}s that tracks metadata across document lifecycle events */
export class DocumentMetadataManager extends BaseDisposableManager {
  private resourceManager = getResourceManager();

  private constructor() {
    super();
    this.registerEventListeners();
  }

  private static instance: DocumentMetadataManager | null = null;
  static getInstance(): DocumentMetadataManager {
    if (!DocumentMetadataManager.instance) {
      DocumentMetadataManager.instance = new DocumentMetadataManager();
    }
    return DocumentMetadataManager.instance;
  }

  private registerEventListeners() {
    this.disposables.push(
      workspace.onDidOpenTextDocument(this.handleDocumentOpen, this),
      workspace.onDidSaveTextDocument(this.handleDocumentSave, this),
      workspace.onDidCloseTextDocument(this.handleDocumentClose, this),
      // TODO: Add rename/delete/move listeners as needed
    );
  }

  private async handleDocumentOpen(document: TextDocument) {
    if (!SUPPORTED_URI_SCHEMES.includes(document.uri.scheme)) return;
    logger.debug("document opened", { uri: document.uri.toString() });
  }

  private async handleDocumentClose(document: TextDocument) {
    if (!SUPPORTED_URI_SCHEMES.includes(document.uri.scheme)) return;
    logger.debug("document closed", { uri: document.uri.toString() });
  }

  /**
   * Handler for when a document is saved. This primarily checks when a `file` document is saved
   * and attempts to migrate any metadata from an `untitled` document to the saved document.
   *
   * When an `untitled` document is saved, the following happens:
   * 1. A (new) `file` document is opened
   * 2. The `file` document is saved with the same content as the `untitled` document
   * 3. The `untitled` document is closed
   *
   * Between steps 2 and 3, both documents are briefly available and have the same content, so we
   * can use the metadata from the `untitled` document to set the metadata for the `file` document.
   */
  private async handleDocumentSave(document: TextDocument) {
    if (!SUPPORTED_URI_SCHEMES.includes(document.uri.scheme)) return;

    logger.debug("document saved", { uri: document.uri.toString() });

    // Only attempt metadata migration if saved as a real file
    if (document.uri.scheme !== "file") return;

    const allMetadata: UriMetadataMap = await this.resourceManager.getAllUriMetadata();

    for (const [uriString, metadata] of allMetadata.entries()) {
      const uri: Uri = Uri.parse(uriString);
      if (uri.scheme !== "untitled") continue;

      const untitledDoc: TextDocument | undefined = workspace.textDocuments.find(
        (doc) => doc.uri.toString() === uriString,
      );
      if (!untitledDoc) continue;

      logger.debug("found untitled document with metadata", {
        uri: uri.toString(),
        untitledDoc: untitledDoc.uri.toString(),
        metadata,
      });
      // try to match the previous 'untitled' document with this newly saved document
      const untitledContent: string | undefined = await workspace
        .openTextDocument(uri)
        .then((doc) => doc.getText());

      if (document.getText().trim() === untitledContent?.trim()) {
        logger.debug(`migrating metadata from untitled document to "${document.uri.toString()}"`);
        await this.resourceManager.setUriMetadata(document.uri, metadata);
        await this.resourceManager.deleteUriMetadata(uri);
        break;
      }
    }
  }
}
