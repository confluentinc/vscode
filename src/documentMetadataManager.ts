import { Disposable, TextDocument, Uri, workspace } from "vscode";
import { Logger } from "./logging";
import { getResourceManager } from "./storage/resourceManager";
import { UriMetadataMap } from "./storage/types";

const logger = new Logger("documentMetadataManager");

// Central list of supported URI schemes
const SUPPORTED_URI_SCHEMES = ["file", "untitled", FLINKSTATEMENT_URI_SCHEME];

/** Manager for VS Code {@link TextDocument}s that tracks metadata across document lifecycle events */
export class DocumentMetadataManager {
  private resourceManager = getResourceManager();
  disposables: Disposable[] = [];

  private constructor() {
<<<<<<< HEAD
    this.registerEventListeners();
=======
    this.disposables.push(
      workspace.onDidOpenTextDocument(this.handleDocumentOpen, this),
      workspace.onDidSaveTextDocument(this.handleDocumentSave, this),
      workspace.onDidCloseTextDocument(this.handleDocumentClose, this),
    );
>>>>>>> main
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

  /** Determines whether a document is relevant for tracking/logging */
  private shouldLogDocumentEvent(document: TextDocument): boolean {
    const { scheme } = document.uri;
    const isCopilotVirtual = scheme === "vscode-chat-code-block";
    return SUPPORTED_URI_SCHEMES.includes(scheme) && !isCopilotVirtual;
  }

  private logDocumentEvent(event: "opened" | "closed" | "saved", uri: Uri) {
    logger.debug(`document ${event}`, { uri: uri.toString() });
  }

  private async handleDocumentOpen(document: TextDocument) {
    if (!SUPPORTED_URI_SCHEMES.includes(document.uri.scheme)) return;
    this.logDocumentEvent("opened", document.uri);
  }

  private async handleDocumentClose(document: TextDocument) {
    if (!SUPPORTED_URI_SCHEMES.includes(document.uri.scheme)) return;
    this.logDocumentEvent("closed", document.uri);
  }

  /**
   * Handles metadata migration when an untitled document is saved to a file.
   */
  private async handleDocumentSave(document: TextDocument) {
    if (!SUPPORTED_URI_SCHEMES.includes(document.uri.scheme)) return;

    this.logDocumentEvent("saved", document.uri);

    // Only attempt metadata migration if saved as a real file
    if (document.uri.scheme !== "file") return;

    const allMetadata: UriMetadataMap = await this.resourceManager.getAllUriMetadata();

    for (const [uriString, metadata] of allMetadata.entries()) {
      const uri: Uri = Uri.parse(uriString);
      if (uri.scheme !== "untitled") continue;

      const untitledDoc = workspace.textDocuments.find(
        (doc) => doc.uri.toString() === uriString,
      );
      if (!untitledDoc) continue;

      logger.debug("found untitled document with metadata", {
        uri: uri.toString(),
        untitledDoc: untitledDoc.uri.toString(),
        metadata,
      });

      const untitledContent = await workspace.openTextDocument(uri).then((doc) => doc.getText());

      if (document.getText().trim() === untitledContent?.trim()) {
        logger.debug(`migrating metadata from untitled document to "${document.uri.toString()}"`);
        await this.resourceManager.setUriMetadata(document.uri, metadata);
        await this.resourceManager.deleteUriMetadata(uri);
        break;
      }
    }
  }
}
