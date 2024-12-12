import { Disposable } from "vscode";
import WebSocket from "ws";
import { Logger } from "../logging";
import { MessageRouter } from "../ws/messageRouter";
import { Message, MessageHeaders, MessageType } from "../ws/messageTypes";

import { SIDECAR_PORT } from "./constants";

const logger = new Logger("websocketManager");

export class WebsocketManager {
  static instance: WebsocketManager | null = null;

  static getInstance(): WebsocketManager {
    if (!WebsocketManager.instance) {
      WebsocketManager.instance = new WebsocketManager();
    }
    return WebsocketManager.instance;
  }

  private websocket: WebSocket | null = null;
  private disposables: Disposable[] = [];
  private messageRouter = MessageRouter.getInstance();
  private peerWorkspaceCount = 0;

  private constructor() {
    // Install handler for WORKSPACE_COUNT_CHANGED messages. Will get one when connected, and whenever
    // any other workspaces connect or disconnect.
    this.messageRouter.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, async (message) => {
      logger.info(
        `Received WORKSPACE_COUNT_CHANGED message: ${message.body.current_workspace_count}`,
      );
      // The reply is inclusive of the current workspace, but we want peer count.
      this.peerWorkspaceCount = message.body.current_workspace_count - 1;
    });
  }

  /**
   * Connect websocket to the sidecar, then send an ACCESS_REQUEST message containing the access_token.
   * Resolves the promise upon successful authorization.
   * @param access_token
   * @returns
   */
  async connect(accessToken: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.websocket) {
        logger.info("Websocket already connected");
        resolve();
        return;
      }

      logger.info("Setting up websocket to sidecar");

      // Quarkus likes knowing what workspace id is connecting at websocket level, but
      // its websocket framework doesn't let it see request headers. So we pass it in the query string.
      // (We MUST pass the access token in the headers to pass through the sidecar auth filter, which filters on headers.
      //  Is just that the headers we pass are not visible to the Quarkus websocket framework.)
      const websocket = new WebSocket(
        `ws://localhost:${SIDECAR_PORT}/ws?workspace_id=${process.pid}`,
        {
          headers: { authorization: `Bearer ${accessToken}` },
        },
      );

      websocket.on("open", () => {
        logger.info("Websocket connected to sidecar");

        // Resolve when we have gotten the first WORKSPACE_COUNT_CHANGED message. Will be sent
        // when any connect/disconnect happens, even ours.
        // Install a one-time handler for this message type.
        this.messageRouter.once(
          MessageType.WORKSPACE_COUNT_CHANGED,
          async (m: Message<MessageType.WORKSPACE_COUNT_CHANGED>) => {
            logger.info(
              "Received initial WORKSPACE_COUNT_CHANGED message, resolving connection promise",
            );
            this.websocket = websocket;
            this.peerWorkspaceCount = m.body.current_workspace_count - 1;
            resolve();
          },
        );
      });

      websocket.on("close", () => {
        logger.info("Websocket closed");

        // do additional cleanup here
        this.websocket = null;
        this.dispose();
      });

      websocket.on("error", (error) => {
        logger.error(`Websocket error: ${error}`);
      });

      websocket.on("message", (data: WebSocket.Data) => {
        // Deserialize from JSON and deliver the message to the message router.
        try {
          // Deserialize the message from our possible gzipped websocket transport encoding.
          const message = JSON.parse(data.toString()) as Message<any>;

          const headers: MessageHeaders = message.headers;
          const messageType: MessageType = message.headers.message_type;
          const originator: string = headers.originator;
          logger.debug(
            `Recieved ${messageType} websocket message from originator ${originator}: ${JSON.stringify(message, null, 2)}`,
          );

          // Defer to the internal message router to deliver the message to the registered by-message-type async handler(s).
          this.messageRouter.deliver(message).catch((e) => {
            logger.error(`Error delivering message ${JSON.stringify(message, null, 2)}: ${e}`);
          });
        } catch {
          logger.info(`Unparseable websocket message from sidecar: ${data.toString()}`);
        }
      });

      this.disposables.push({
        dispose: () => {
          if (this.websocket) {
            this.websocket.close();
          }
        },
      });
    });
  }

  /**
   * Send a message to / through sidecar over the websocket.
   * The websocket send is ultimately async underneath the hood.
   * @throws {WebsocketClosedError} if the websocket is not connected.
   */
  public send<T extends MessageType>(
    message: Message<T>,
    /** Optional websocket to use for the send, special cased for startup. */
    websocket?: WebSocket,
  ): void {
    websocket = websocket || this.websocket || undefined;
    if (websocket) {
      const payload = JSON.stringify(message);

      if (payload.length > 64 * 1024) {
        logger.error(`Cannot send websocket message, too large: ${payload.length} bytes`);
        throw new Error("Payload too large");
      }
      logger.debug(`Sending ${payload.length} byte message`);
      websocket.send(payload);
    } else {
      logger.error("Websocket not provided/assigned, cannot send message");
      throw new WebsocketClosedError();
    }
  }

  /** How many peer workspaces are connected to sidecar, exclusive of ourselves? */
  public getPeerWorkspaceCount(): number {
    return this.peerWorkspaceCount;
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