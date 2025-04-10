import { Disposable, EventEmitter as VscodeEventEmitter, window } from "vscode";
import WebSocket from "ws";
// import { logError } from "../errors";
import { Logger } from "../logging";

const logger = new Logger("languageServerSocket");

export class LanguageServerSocket implements Disposable {
  static instance: LanguageServerSocket | null = null;

  static getInstance(): LanguageServerSocket {
    if (!LanguageServerSocket.instance) {
      LanguageServerSocket.instance = new LanguageServerSocket();
    }
    return LanguageServerSocket.instance;
  }

  public websocket: WebSocket | null = null;
  private websocketStateEmitter = new VscodeEventEmitter<WebsocketStateEvent>();
  private messageEmitter = new VscodeEventEmitter<string>();
  private disposables: Disposable[] = [];

  private constructor() {
    this.disposables.push(this.messageEmitter);
  }

  /** Are we currently connected to the language server via websocket? */
  public isConnected(): boolean {
    return this.websocket !== null && this.websocket.readyState === WebSocket.OPEN;
  }

  /**
   * Register a listener for WebsocketStateEvent.CONNECTED and DISCONNECTED events.
   */
  public registerStateChangeHandler(listener: (event: WebsocketStateEvent) => any): Disposable {
    return this.websocketStateEmitter.event(listener);
  }

  /**
   * Register a listener for incoming messages.
   */
  public on(event: "message", listener: (data: string) => any): Disposable {
    return this.messageEmitter.event(listener);
  }

  /**
   * Connect websocket to the language server.
   * Resolves the promise upon successfully connecting.
   *
   * @param hostPortFragment The host and port fragment to connect to, e.g. "localhost:8080".
   * @param accessToken The access token to use for authorization.
   */
  async connect(hostPortFragment: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        logger.info("Sidecar lsp ws endpoint already connected");
        resolve();
        return;
      }

      logger.info("Setting up websocket to Sidecar lsp ws endpoint");

      const websocket = new WebSocket(
        `ws://${hostPortFragment}/flsp?connectionId=1&region=us-east1&provider=gcp&environmentId=env-x7727g&organizationId=f551c50b-0397-4f31-802d-d5371a49d3bf`,
        {
          // headers: { authorization: `Bearer ${accessToken}` },
        },
      );

      websocket.on("open", () => {
        logger.info("Websocket connected to Sidecar lsp ws endpoint");
        this.websocket = websocket;
        this.websocketStateEmitter.fire(WebsocketStateEvent.CONNECTED);
        resolve();
      });

      websocket.on("close", () => {
        logger.info("Sidecar lsp ws endpoint closed");
        this.websocket = null;
        this.websocketStateEmitter.fire(WebsocketStateEvent.DISCONNECTED);
      });

      websocket.on("error", (error) => {
        logger.error(`Sidecar lsp ws endpoint error: ${error}`);
        websocket.close();
      });

      websocket.on("message", (data: WebSocket.Data) => {
        try {
          const message = data.toString();
          this.messageEmitter.fire(message);
          logger.info(`Received message from Sidecar lsp ws endpoint: ${message}`);
        } catch (e) {
          logger.error(`Error handling Sidecar lsp ws endpoint message: ${e}`);
        }
      });

      this.disposables.push({
        dispose: () => {
          if (this.websocket && this.websocket.readyState !== WebSocket.CLOSED) {
            this.websocket.close();
            this.websocket = null;
          }
        },
      });
    });
  }

  /**
   * Send a message to the language server over the websocket.
   * @throws {WebsocketClosedError} if the websocket is not connected.
   */
  public send(message: any): void {
    logger.info("Language server SEND event");

    if (!this.websocket) {
      logger.error("Language server websocket not assigned, cannot send message");
      throw new WebsocketClosedError();
    }

    if (this.websocket.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify(message);
      logger.info("socket OPEN, sending:", payload);

      if (payload.length > 64 * 1024) {
        const errorMessage = `Cannot send websocket message, too large: ${payload.length} bytes`;
        logger.error(errorMessage);
        window.showErrorMessage(errorMessage);
        throw new Error(errorMessage);
      }
      this.websocket.send(payload);
    } else {
      logger.error("Language server websocket not open, cannot send message");
      throw new WebsocketClosedError();
    }
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }
}

class WebsocketClosedError extends Error {
  constructor() {
    super("Websocket closed");
    this.name = "WebsocketClosedError";
  }
}

/** Events emitted by LanguageServerSocket.websocketStateEmitter whenever connection state changes. */
export enum WebsocketStateEvent {
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
}
