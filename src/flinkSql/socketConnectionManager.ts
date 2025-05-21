import { EventEmitter } from "vscode";
import { Message, MessageTransports } from "vscode-languageclient/node";
import { WebSocket } from "ws";
import { Logger } from "../logging";
import { getStorageManager } from "../storage";
import { SecretStorageKeys } from "../storage/constants";
import { WebsocketTransport } from "./websocketTransport";

const logger = new Logger("flinkSql.websocketServerManager");

// Connection statuses
export enum ConnectionStatus {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
}

interface QueuedMessage {
  message: Message;
  timestamp: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class LanguageServerConnection {
  private _url: string;
  private _socket: WebSocket | null = null;
  private _transport: WebsocketTransport | null = null;
  private _isReconnecting = false;
  private _reconnectAttempts = 0;
  private _maxReconnectAttempts = 5;
  private _reconnectBackoff = 1000; // Start with 1 second
  private _reconnectTimer: NodeJS.Timeout | null = null;
  private _messageQueue: QueuedMessage[] = [];
  private _connectionStatusEmitter = new EventEmitter<ConnectionStatus>();
  private _connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private _connectionToken: string | null = null;
  private _messageHandler: ((message: Message) => void) | null = null;

  constructor(url: string) {
    this._url = url;
  }

  get connectionStatus(): ConnectionStatus {
    return this._connectionStatus;
  }

  get onConnectionStatusChange() {
    return this._connectionStatusEmitter.event;
  }

  /**
   * Set a callback to be called when a message is received from the server
   * @param handler Function to call with received messages
   */
  public setMessageHandler(handler: (message: Message) => void): void {
    this._messageHandler = handler;
  }

  private setConnectionStatus(status: ConnectionStatus) {
    this._connectionStatus = status;
    this._connectionStatusEmitter.fire(status);
  }

  /**
   * Initialize the connection to the WebSocket server
   */
  public async connect(): Promise<MessageTransports> {
    if (this._transport && this._socket?.readyState === WebSocket.OPEN) {
      logger.debug("Using existing WebSocket connection");
      return this._transport;
    }

    logger.info(`Connecting to WebSocket server: ${this._url}`);
    this.setConnectionStatus(ConnectionStatus.CONNECTING);

    try {
      logger.debug("Retrieving access token");
      const accessToken = await getStorageManager().getSecret(SecretStorageKeys.SIDECAR_AUTH_TOKEN);

      if (!accessToken) {
        const error = new Error("No access token found for WebSocket connection");
        logger.error(error.message);
        this.setConnectionStatus(ConnectionStatus.DISCONNECTED);
        throw error;
      }

      this._connectionToken = accessToken;
      logger.debug("Access token retrieved, creating WebSocket connection");
      return await this.createWebSocketConnection(accessToken);
    } catch (error) {
      this.setConnectionStatus(ConnectionStatus.DISCONNECTED);
      logger.error(`Failed to connect to WebSocket server: ${error}`);
      throw error;
    }
  }

  /**
   * Create a WebSocket connection and set up event handlers
   */
  private async createWebSocketConnection(accessToken: string): Promise<MessageTransports> {
    return new Promise((resolve, reject) => {
      logger.debug(`Creating WebSocket connection to ${this._url}`);

      try {
        const socket = new WebSocket(this._url, {
          headers: { authorization: `Bearer ${accessToken}` },
        });

        const errorHandler = (error: any) => {
          const errorMsg = error?.message || String(error);
          logger.error(`WebSocket connection error: ${errorMsg}`);
          if (this._connectionStatus === ConnectionStatus.CONNECTING) {
            reject(new Error(`Failed to connect to WebSocket server: ${errorMsg}`));
          } else {
            this.handleDisconnect();
          }
        };

        socket.onerror = errorHandler;

        // Set a timeout for the connection
        const connectionTimeout = setTimeout(() => {
          if (this._connectionStatus === ConnectionStatus.CONNECTING) {
            logger.error("WebSocket connection timeout");
            socket.close();
            reject(new Error("Connection timeout"));
          }
        }, 10000); // 10 second timeout

        // Clear the timeout once connected
        socket.onopen = () => {
          clearTimeout(connectionTimeout);

          logger.info("WebSocket connection established successfully");
          this._socket = socket;
          this._reconnectAttempts = 0;
          this._transport = new WebsocketTransport(socket);

          // Set up the message handler to forward received messages
          socket.onmessage = (event) => {
            try {
              const data =
                typeof event.data === "string" ? event.data : event.data.toString("utf8");
              const message = JSON.parse(data);

              // Log more information about the message for debugging
              if (typeof message === "object" && message !== null) {
                if ("id" in message && "result" in message) {
                  // This is a response to a previous request
                  logger.debug(`Received response for request id ${message.id}`);

                  // For completion results, log more details
                  if (
                    typeof message.result === "object" &&
                    message.result !== null &&
                    "items" in message.result
                  ) {
                    const items = message.result.items;
                    const itemCount = Array.isArray(items) ? items.length : "?";
                    logger.debug(`Response contains ${itemCount} completion items`);
                  }
                } else if ("method" in message) {
                  // This is a notification or request from the server
                  logger.debug(`Received message with method: ${message.method}`);
                } else {
                  // Other type of message
                  logger.debug(`Received message: ${JSON.stringify(message).substring(0, 100)}...`);
                }
              } else {
                logger.debug("Received non-object message");
              }

              if (this._messageHandler) {
                logger.debug("Forwarding received message to language client");
                this._messageHandler(message);
              } else {
                logger.warn("Message received but no handler is registered");
              }
            } catch (error) {
              logger.error(`Error processing incoming message: ${error}`);
            }
          };

          this.setConnectionStatus(ConnectionStatus.CONNECTED);
          this.processQueuedMessages();

          resolve(this._transport);
        };

        socket.onclose = (event) => {
          clearTimeout(connectionTimeout);
          const reason = event.reason || "Unknown reason";
          const code = event.code;
          logger.warn(`WebSocket connection closed: Code ${code}, Reason: ${reason}`);
          this.handleDisconnect();
        };
      } catch (error) {
        logger.error(`Error creating WebSocket: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * Handle WebSocket disconnection with automatic reconnection
   */
  private handleDisconnect() {
    if (this._isReconnecting) {
      return;
    }

    this._isReconnecting = true;
    this.setConnectionStatus(ConnectionStatus.RECONNECTING);

    if (this._reconnectAttempts < this._maxReconnectAttempts) {
      const backoffTime = this._reconnectBackoff * Math.pow(2, this._reconnectAttempts);
      logger.info(
        `Reconnecting to WebSocket server in ${backoffTime}ms (attempt ${this._reconnectAttempts + 1}/${this._maxReconnectAttempts})`,
      );

      this._reconnectTimer = setTimeout(async () => {
        this._reconnectAttempts++;

        try {
          if (this._connectionToken) {
            await this.createWebSocketConnection(this._connectionToken);
            this._isReconnecting = false;
          } else {
            // Need to get a new token
            this._isReconnecting = false;
            await this.connect();
          }
        } catch (error) {
          logger.error(`Reconnection attempt failed: ${error}`);
          this._isReconnecting = false;
          this.handleDisconnect();
        }
      }, backoffTime);
    } else {
      logger.error(
        `Maximum reconnection attempts (${this._maxReconnectAttempts}) reached. Giving up.`,
      );
      this._isReconnecting = false;
      this.setConnectionStatus(ConnectionStatus.DISCONNECTED);
    }
  }

  /**
   * Queue a message to be sent when the connection is available
   */
  public queueMessage(message: Message): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // If we have an active connection, try to send immediately
      if (this._socket?.readyState === WebSocket.OPEN && this._transport) {
        this._transport.writer.write(message).then(resolve).catch(reject);
        return;
      }

      // Otherwise queue the message
      this._messageQueue.push({
        message,
        timestamp: Date.now(),
        resolve,
        reject,
      });

      // If we're not already reconnecting, try to connect
      if (this._connectionStatus === ConnectionStatus.DISCONNECTED && !this._isReconnecting) {
        this.connect().catch((error) => {
          logger.error(`Failed to reconnect: ${error}`);
        });
      }
    });
  }

  /**
   * Process any queued messages
   */
  private processQueuedMessages() {
    if (!this._transport || this._socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    const messagesToProcess = [...this._messageQueue];
    this._messageQueue = [];

    for (const queuedMessage of messagesToProcess) {
      this._transport.writer
        .write(queuedMessage.message)
        .then(queuedMessage.resolve)
        .catch((error) => {
          logger.error(`Failed to send queued message: ${error}`);
          queuedMessage.reject(error);
        });
    }
  }

  /**
   * Dispose the WebSocket connection and cleanup resources
   */
  public dispose() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._transport) {
      this._transport.dispose();
      this._transport = null;
    }

    if (
      this._socket &&
      (this._socket.readyState === WebSocket.OPEN ||
        this._socket.readyState === WebSocket.CONNECTING)
    ) {
      try {
        this._socket.close(1000, "Manager disposed");
      } catch (err) {
        logger.error(`Error closing WebSocket: ${err}`);
      }
    }

    this._socket = null;
    this._messageQueue = [];
    this.setConnectionStatus(ConnectionStatus.DISCONNECTED);
    this._connectionStatusEmitter.dispose();
  }
}
