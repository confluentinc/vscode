import * as vscode from "vscode";
import {
  Message,
  MessageReader,
  MessageTransports,
  MessageWriter,
} from "vscode-languageclient/node";
import { Logger } from "../logging";
import { MultiServerManager } from "./multiSocketManager";

const logger = new Logger("flinkSql.serverOptionsProvider");

/**
 * Custom MessageReader that forwards to the appropriate WebSocket based on document context
 */
class FlinkSqlMessageReader implements MessageReader {
  private onErrorEmitter = new vscode.EventEmitter<Error>();
  private onCloseEmitter = new vscode.EventEmitter<void>();
  private onPartialMessageEmitter = new vscode.EventEmitter<any>();
  private listeners: Map<string, vscode.Disposable> = new Map();
  private onMessageEmitter = new vscode.EventEmitter<Message>();

  constructor() {}

  public get onError() {
    return this.onErrorEmitter.event;
  }

  public get onClose() {
    return this.onCloseEmitter.event;
  }

  public get onPartialMessage() {
    return this.onPartialMessageEmitter.event;
  }

  /**
   * Method called by the language client to register a callback for incoming messages
   */
  public listen(callback: (message: Message) => void): vscode.Disposable {
    // Setup subscription to our message emitter
    logger.debug("Language client registered to listen for incoming messages");
    const subscription = this.onMessageEmitter.event((message) => {
      try {
        // Log information about the response
        if (typeof message === "object" && message !== null) {
          if ("id" in message && "result" in message) {
            const responseId = message.id;
            let resultInfo = "";

            // For completion responses, add more detailed logging
            if (
              typeof message.result === "object" &&
              message.result !== null &&
              "items" in message.result
            ) {
              const items = message.result.items;
              const itemCount = Array.isArray(items) ? items.length : "?";
              resultInfo = ` with ${itemCount} completion items`;
            }

            logger.debug(`Processing response for request id ${responseId}${resultInfo}`);
          } else if ("method" in message) {
            logger.debug(`Processing notification: ${message.method}`);
          }
        }

        // Forward the message to the language client
        callback(message);
      } catch (error) {
        logger.error(`Error in message listener callback: ${error}`);
      }
    });

    return {
      dispose: () => {
        logger.debug("Language client message listener disposed");
        subscription.dispose();
      },
    };
  }

  /**
   * Pass a message received from a websocket to our message emitter
   */
  public forwardMessage(message: Message): void {
    try {
      // Log message ID and type for debugging
      if (typeof message === "object" && message !== null) {
        if ("id" in message && "result" in message) {
          logger.debug(`Forwarding response for request id ${message.id} to language client`);
        } else if ("method" in message) {
          logger.debug(`Forwarding notification with method ${message.method} to language client`);
        } else {
          logger.debug(
            `Forwarding message to language client: ${JSON.stringify(message).substring(0, 100)}...`,
          );
        }
      } else {
        logger.debug("Forwarding non-object message to language client");
      }

      this.onMessageEmitter.fire(message);
    } catch (error) {
      logger.error(`Error forwarding message: ${error}`);
    }
  }

  /**
   * Dispose all resources
   */
  public dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
    this.listeners.clear();
    this.onErrorEmitter.dispose();
    this.onCloseEmitter.dispose();
    this.onPartialMessageEmitter.dispose();
    this.onMessageEmitter.dispose();
  }
}

/**
 * Custom MessageWriter that forwards messages to the appropriate WebSocket
 * based on document context
 */
class FlinkSqlMessageWriter implements MessageWriter {
  private onErrorEmitter = new vscode.EventEmitter<
    [Error, Message | undefined, number | undefined]
  >();
  private onCloseEmitter = new vscode.EventEmitter<void>();
  private serverManager: MultiServerManager;
  private openDocuments: Map<string, vscode.TextDocument> = new Map();
  private documentSelector: vscode.DocumentSelector;
  private pendingRequests: Map<number | string, string> = new Map(); // Maps request IDs to document URIs

  constructor(serverManager: MultiServerManager, documentSelector: vscode.DocumentSelector) {
    this.serverManager = serverManager;
    this.documentSelector = documentSelector;

    // Track open documents to know which server to route messages to
    vscode.workspace.textDocuments.forEach((doc) => {
      if (vscode.languages.match(this.documentSelector, doc)) {
        this.openDocuments.set(doc.uri.toString(), doc);
      }
    });

    // Listen for document open/close events
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (vscode.languages.match(this.documentSelector, doc)) {
        logger.debug(`Tracking document: ${doc.uri.toString()}`);
        this.openDocuments.set(doc.uri.toString(), doc);
      }
    });

    vscode.workspace.onDidCloseTextDocument((doc) => {
      logger.debug(`Removing tracked document: ${doc.uri.toString()}`);
      this.openDocuments.delete(doc.uri.toString());
    });
  }

  public get onError() {
    return this.onErrorEmitter.event;
  }

  public get onClose() {
    return this.onCloseEmitter.event;
  }

  /**
   * Find the active document to use for routing
   * This is a heuristic - we try to use the most recently active document
   * that matches our document selector
   */
  private getActiveDocument(): vscode.TextDocument | undefined {
    // Try the active editor first
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && vscode.languages.match(this.documentSelector, activeEditor.document)) {
      return activeEditor.document;
    }

    // Fall back to any visible editor
    for (const editor of vscode.window.visibleTextEditors) {
      if (vscode.languages.match(this.documentSelector, editor.document)) {
        return editor.document;
      }
    }

    // Last resort: use any open document
    if (this.openDocuments.size > 0) {
      return Array.from(this.openDocuments.values())[0];
    }

    return undefined;
  }

  /**
   * Write a message to the appropriate WebSocket
   */
  public async write(message: Message): Promise<void> {
    // Check if this looks like an initialization message by examining the method property
    const isInitializationMessage =
      message &&
      typeof message === "object" &&
      "method" in message &&
      typeof message.method === "string" &&
      (message.method === "initialize" || message.method.startsWith("$/"));

    // Check if this is a request message (has ID and method)
    const isRequest =
      message && typeof message === "object" && "id" in message && "method" in message;

    // Get additional information about the request for logging
    let requestMethod =
      isRequest && typeof (message as any).method === "string"
        ? (message as any).method
        : "unknown";
    let requestId = isRequest ? (message as any).id : null;

    // If this is a completion or other document-specific request, try to extract document URI
    let documentUri: string | undefined;
    if (
      isRequest &&
      (message as any).method === "textDocument/completion" &&
      typeof (message as any).params === "object" &&
      (message as any).params &&
      "textDocument" in (message as any).params &&
      (message as any).params.textDocument &&
      "uri" in (message as any).params.textDocument
    ) {
      documentUri = (message as any).params.textDocument.uri;

      // Store the document URI associated with this request ID for later
      if (requestId !== null && documentUri) {
        logger.debug(`Associating request ${requestId} with document ${documentUri}`);
        this.pendingRequests.set(requestId as string | number, documentUri);
      }
    }

    if (isInitializationMessage) {
      logger.debug(`Handling initialization or protocol message: ${message.method}`);
      // For initialization and protocol messages, always route to the default server
      try {
        await this.serverManager.sendToDefaultServer(message);
        return Promise.resolve();
      } catch (error) {
        logger.error(`Error sending initialization message: ${error}`);
        this.onErrorEmitter.fire([error as Error, message, undefined]);
        return Promise.reject(error);
      }
    }

    // If we have a document URI from the request, try to use that document
    let activeDocument: vscode.TextDocument | undefined;
    if (documentUri) {
      activeDocument = this.openDocuments.get(documentUri);
      if (activeDocument) {
        logger.debug(`Using document from request params: ${documentUri}`);
      } else {
        logger.debug(`Document from request params not found in open documents: ${documentUri}`);
      }
    }

    // If we don't have a document from the request, try to find an active document
    if (!activeDocument) {
      activeDocument = this.getActiveDocument();
    }

    if (!activeDocument) {
      logger.debug(
        `No active document found for ${isRequest ? "request" : "message"} ${requestMethod}${requestId ? ` (id: ${requestId})` : ""}, using default server`,
      );

      // No document context available, try to find a connected server
      if (!this.serverManager.hasConnectedServers()) {
        logger.error("No connected servers available to send message");
        return Promise.reject(new Error("No connected servers available"));
      }

      // Send to the default server since we don't have a document context
      try {
        await this.serverManager.sendToDefaultServer(message);
        return Promise.resolve();
      } catch (error) {
        logger.error(`Error sending message to default server: ${error}`);
        this.onErrorEmitter.fire([error as Error, message, undefined]);
        return Promise.reject(error);
      }
    }

    try {
      logger.debug(
        `Sending ${isRequest ? "request" : "message"} ${requestMethod}${requestId ? ` (id: ${requestId})` : ""} for document ${activeDocument.uri.toString()}`,
      );
      await this.serverManager.sendMessage(message, activeDocument);
      return Promise.resolve();
    } catch (error) {
      logger.error(`Error sending message: ${error}`);
      this.onErrorEmitter.fire([error as Error, message, undefined]);
      return Promise.reject(error);
    }
  }

  /**
   * End the writer - we don't do anything here as the connections
   * are managed by the MultiWebSocketServerManager
   */
  public end(): void {
    // No-op, connections are managed by the MultiWebSocketServerManager
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    this.onErrorEmitter.dispose();
    this.onCloseEmitter.dispose();
  }
}

/**
 * A custom MessageTransports implementation that uses our MultiWebSocketServerManager
 * to route messages to the appropriate server
 */
class FlinkSqlMessageTransports implements MessageTransports {
  public reader: MessageReader;
  public writer: MessageWriter;
  private serverManager: MultiServerManager;

  constructor(serverManager: MultiServerManager, documentSelector: vscode.DocumentSelector) {
    this.serverManager = serverManager;
    this.reader = new FlinkSqlMessageReader();
    this.writer = new FlinkSqlMessageWriter(this.serverManager, documentSelector);

    // Connect the message handler so incoming WebSocket messages get forwarded to the reader
    this.serverManager.setMessageHandler((message: Message) => {
      this.forwardIncomingMessage(message);
    });
  }

  /**
   * Pass a message received from a websocket to our reader
   */
  public forwardIncomingMessage(message: Message): void {
    logger.debug("Forwarding message to LSP client");
    (this.reader as FlinkSqlMessageReader).forwardMessage(message);
  }
}

/**
 * Provides server options for the language client using our websocket manager
 */
export class FlinkServerProvider {
  private serverManager: MultiServerManager;
  private messageTransports: FlinkSqlMessageTransports | null = null;
  private documentSelector: vscode.DocumentSelector;

  constructor(
    documentSelector: vscode.DocumentSelector,
    computePoolId: string,
    poolInfo: { organizationId: string; environmentId: string; region: string; provider: string },
  ) {
    this.serverManager = new MultiServerManager();
    this.documentSelector = documentSelector;

    // Register the default server using computePoolId and poolInfo
    this.serverManager.registerServer(
      computePoolId,
      poolInfo,
      (document) =>
        document.languageId === "flinksql" ||
        !!vscode.languages.match({ pattern: "**/*.flink.sql" }, document),
      true, // Set as default server
    );
  }

  /**
   * Get server options for the language client
   * This returns a factory function that will be called by the client
   */
  public getServerOptions() {
    return async () => {
      try {
        // Connect to all servers
        await this.serverManager.connectAll();

        this.messageTransports = new FlinkSqlMessageTransports(
          this.serverManager,
          this.documentSelector,
        );

        // Verify that at least one server is connected
        if (!this.serverManager.hasConnectedServers()) {
          throw new Error("No WebSocket servers connected");
        }

        logger.debug("Server options created successfully");
        return this.messageTransports;
      } catch (error) {
        logger.error(`Failed to create server options: ${error}`);
        throw error;
      }
    };
  }

  /**
   * Dispose resources
   */
  public dispose(): void {
    if (this.messageTransports) {
      this.messageTransports.reader.dispose();
      this.messageTransports.writer.dispose();
      this.messageTransports = null;
    }
  }
}
