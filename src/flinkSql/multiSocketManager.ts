import { TextDocument } from "vscode";
import { Message } from "vscode-languageclient/node";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { Logger } from "../logging";
import { SIDECAR_PORT } from "../sidecar/constants";
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
   * Build the WebSocket URL for a given compute pool id.
   * This should be the single source of truth for URL construction.
   */
  public static buildWebSocketUrl(options: {
    organizationId: string;
    environmentId: string;
    region: string;
    provider: string;
  }): string {
    const { organizationId, environmentId, region, provider } = options;
    return `ws://localhost:${SIDECAR_PORT}/flsp?connectionId=${CCLOUD_CONNECTION_ID}&region=${region}&provider=${provider}&environmentId=${environmentId}&organizationId=${organizationId}`;
  }

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
   * @param computePoolId Unique identifier for this server (should match compute pool id)
   * @param poolInfo Object containing organizationId, environmentId, region, provider
   * @param documentFilter Function to determine if a document should use this server
   * @param isDefault Whether this should be the default server when no match is found
   */
  public registerServer(
    computePoolId: string,
    poolInfo: { organizationId: string; environmentId: string; region: string; provider: string },
    documentFilter: (document: TextDocument) => boolean,
    isDefault: boolean = false,
  ): void {
    if (this.servers.has(computePoolId)) {
      logger.warn(`Server with ID '${computePoolId}' already registered, replacing`);
      this.servers.get(computePoolId)?.manager.dispose(); // TODO NC probably don't need to replace?
    }

    const url = MultiServerManager.buildWebSocketUrl(poolInfo);
    const manager = new LanguageServerConnection(url);
    this.servers.set(computePoolId, { url, manager, documentFilter });

    // Set message handler if we already have one
    if (this._messageHandler) {
      manager.setMessageHandler(this._messageHandler);
    }

    // Monitor connection status for logging
    manager.onConnectionStatusChange((status) => {
      logger.debug(`Server '${computePoolId}' connection status: ${status}`);
    });

    if (isDefault) {
      this.defaultServerId = computePoolId;
    }
  }

  /**
   * Get the appropriate server for a given document
   * @param document The document to route
   * @returns The server info or null if no match is found
   */
  public getServerForDocument(document: TextDocument): ServerInfo | null {
    // Try to find a server that matches the document filter
    for (const [computePoolId, serverInfo] of this.servers.entries()) {
      if (serverInfo.documentFilter(document)) {
        logger.debug(`Routing document ${document.uri.toString()} to server '${computePoolId}'`);
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
   * @param computePoolId The server ID to connect to
   */
  public async connectToServer(computePoolId: string): Promise<void> {
    const server = this.servers.get(computePoolId);
    if (!server) {
      throw new Error(`Server with ID '${computePoolId}' not found`);
    }

    try {
      await server.manager.connect();
    } catch (error) {
      logger.error(`Failed to connect to server '${computePoolId}': ${error}`);
      throw error;
    }
  }

  /**
   * Connect to all registered servers
   */
  public async connectAll(): Promise<void> {
    const connectionPromises = Array.from(this.servers.entries()).map(
      async ([computePoolId, server]) => {
        try {
          await server.manager.connect();
          logger.debug(`Connected to server '${computePoolId}'`);
        } catch (error) {
          logger.error(`Failed to connect to server '${computePoolId}': ${error}`);
        }
      },
    );

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
   * @param computePoolId The server ID
   */
  public getServerStatus(computePoolId: string): ConnectionStatus | null {
    const server = this.servers.get(computePoolId);
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
    for (const [computePoolId, server] of this.servers.entries()) {
      logger.debug(`Disposing server '${computePoolId}'`);
      server.manager.dispose();
    }
    this.servers.clear();
    this.defaultServerId = null;
  }
}
