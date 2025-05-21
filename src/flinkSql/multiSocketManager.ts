import { TextDocument } from "vscode";
import { Message } from "vscode-languageclient/node";
import { Logger } from "../logging";
import { ConnectionStatus, LanguageServerConnection } from "./socketConnectionManager";

const logger = new Logger("flinkSql.multiServerManager");

interface ServerInfo {
  url: string;
  manager: LanguageServerConnection;
  documentFilter: (document: TextDocument) => boolean;
}

/**
 *  Manages multiple websocket server connections, routes messages based on document filters
 */
export class MultiServerManager {
  private servers: Map<string, ServerInfo> = new Map();
  private defaultServerId: string | null = null;
  private _messageHandler: ((message: Message) => void) | null = null;

  /**
   * Set a message handler for all servers
   * @param handler The handler function to call with received messages
   */
  public setMessageHandler(handler: (message: Message) => void): void {
    this._messageHandler = handler;

    // Set handler for all existing servers
    for (const [_, serverInfo] of this.servers.entries()) {
      serverInfo.manager.setMessageHandler(handler);
    }
  }

  /**
   * Register a new server with a unique ID and connection info
   * @param id Unique identifier for this server
   * @param url WebSocket URL
   * @param documentFilter Function to determine if a document should use this server
   * @param isDefault Whether this should be the default server when no match is found
   */
  public registerServer(
    id: string,
    url: string,
    documentFilter: (document: TextDocument) => boolean,
    isDefault: boolean = false,
  ): void {
    if (this.servers.has(id)) {
      logger.warn(`Server with ID '${id}' already registered, replacing`);
      this.servers.get(id)?.manager.dispose();
    }

    const manager = new LanguageServerConnection(url);
    this.servers.set(id, { url, manager, documentFilter });

    // Set message handler if we already have one
    if (this._messageHandler) {
      manager.setMessageHandler(this._messageHandler);
    }

    // Monitor connection status for logging
    manager.onConnectionStatusChange((status) => {
      logger.debug(`Server '${id}' connection status: ${status}`);
    });

    if (isDefault) {
      this.defaultServerId = id;
    }
  }

  /**
   * Get the appropriate server for a given document
   * @param document The document to route
   * @returns The server info or null if no match
   */
  public getServerForDocument(document: TextDocument): ServerInfo | null {
    // Try to find a server that matches the document filter
    for (const [id, serverInfo] of this.servers.entries()) {
      if (serverInfo.documentFilter(document)) {
        logger.debug(`Routing document ${document.uri.toString()} to server '${id}'`);
        return serverInfo;
      }
    }

    // Fall back to default server if available
    if (this.defaultServerId && this.servers.has(this.defaultServerId)) {
      logger.debug(
        `No specific server found for ${document.uri.toString()}, using default server '${this.defaultServerId}'`,
      );
      return this.servers.get(this.defaultServerId) || null;
    }

    logger.warn(`No server found for document ${document.uri.toString()}`);
    return null;
  }

  /**
   * Connect to a specific server by ID
   * @param id The server ID to connect to
   */
  public async connectToServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) {
      throw new Error(`Server with ID '${id}' not found`);
    }

    try {
      await server.manager.connect();
    } catch (error) {
      logger.error(`Failed to connect to server '${id}': ${error}`);
      throw error;
    }
  }

  /**
   * Connect to all registered servers
   */
  public async connectAll(): Promise<void> {
    const connectionPromises = Array.from(this.servers.entries()).map(async ([id, server]) => {
      try {
        await server.manager.connect();
        logger.debug(`Connected to server '${id}'`);
      } catch (error) {
        logger.error(`Failed to connect to server '${id}': ${error}`);
      }
    });

    await Promise.all(connectionPromises);
  }

  /**
   * Send a message to the default server
   * @param message The message to send
   */
  public async sendToDefaultServer(message: Message): Promise<void> {
    if (!this.defaultServerId || !this.servers.has(this.defaultServerId)) {
      throw new Error("No default server configured");
    }

    const serverInfo = this.servers.get(this.defaultServerId);
    if (!serverInfo) {
      throw new Error(`Default server '${this.defaultServerId}' not found`);
    }

    logger.debug(`Sending message to default server '${this.defaultServerId}'`);
    return serverInfo.manager.queueMessage(message);
  }

  /**
   * Send a message to the appropriate server based on document info
   * @param message The message to send
   * @param document The document context for routing
   */
  public async sendMessage(message: Message, document: TextDocument): Promise<void> {
    const server = this.getServerForDocument(document);
    if (!server) {
      throw new Error(`No server available for document ${document.uri.toString()}`);
    }

    return server.manager.queueMessage(message);
  }

  /**
   * Get the connection status for a specific server
   * @param id The server ID
   */
  public getServerStatus(id: string): ConnectionStatus | null {
    const server = this.servers.get(id);
    if (!server) {
      return null;
    }
    return server.manager.connectionStatus;
  }

  /**
   * Check if any servers are currently connected
   */
  public hasConnectedServers(): boolean {
    for (const [_, server] of this.servers.entries()) {
      if (server.manager.connectionStatus === ConnectionStatus.CONNECTED) {
        return true;
      }
    }
    return false;
  }

  /**
   * Dispose all server connections
   */
  public dispose(): void {
    for (const [id, server] of this.servers.entries()) {
      logger.debug(`Disposing server '${id}'`);
      server.manager.dispose();
    }
    this.servers.clear();
    this.defaultServerId = null;
  }
}
