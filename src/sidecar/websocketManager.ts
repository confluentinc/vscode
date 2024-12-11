import { Disposable } from "vscode";
import WebSocket from "ws";
import { Logger } from "../logging";
import { MessageRouter } from "../ws/messageRouter";
import {
  AccessResponseBody,
  Audience,
  Message,
  MessageHeaders,
  MessageType,
  newMessageHeaders,
  RequestResponseMessageTypes,
  RequestResponseTypeMap,
} from "../ws/messageTypes";

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

  private constructor() {}

  /**
   * Connect websocket to the sidecar, then send an ACCESS_REQUEST message containing the access_token.
   * Resolves the promise upon successful authorization.
   * @param access_token
   * @returns
   */
  async connect(access_token: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.websocket) {
        logger.info("Websocket already connected");
        resolve();
        return;
      }

      logger.info("Setting up websocket to sidecar");

      const websocket = new WebSocket(`ws://localhost:${SIDECAR_PORT}/ws`);

      websocket.on("open", () => {
        logger.info("Websocket connected to sidecar, sending authorization.");

        // construct access request message to sidecar
        const message: Message<MessageType.ACCESS_REQUEST> = {
          headers: newMessageHeaders(MessageType.ACCESS_REQUEST, Audience.SIDECAR),
          body: {
            access_token: access_token,
          },
        };

        // send it and wait for the reply for at most 5s.
        this.sendrecv(message, 5000, websocket)
          .then((accessReply) => {
            if (accessReply.body.authorized) {
              logger.info("Authorized by sidecar");
              this.postAuthorizeSetup(websocket, accessReply.body);
              resolve();
            } else {
              logger.error("Websocke authorization failed!");
              websocket.close();
              reject("Authorization failed");
            }
          })
          .catch((e) => {
            logger.error(`Error authorizing websocket: ${e}`);
            websocket.close();
            reject(e);
          });
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
    }); // returned promise
  } // async connect()

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

  /**
   * Send a message expecting a single response. Return promise of the reply message.
   * Should only be called with messages whose type is a replyable type.
   */
  public sendrecv<T extends RequestResponseMessageTypes>(
    /** Message to send that should recieve a single direct response. */
    message: Message<T>,
    /** Optional milliseconds to wait for the reply. */
    timeoutMs?: number,
    /** Optional websocket to use for the send, special cased for startup. */
    websocket?: WebSocket,
  ): Promise<Message<RequestResponseTypeMap[T]>> {
    return new Promise((resolve, reject) => {
      if (!websocket) {
        websocket = this.websocket || undefined;
      }

      if (!websocket) {
        logger.error("Websocket not provided or inferrable, cannot send message");
        reject(new WebsocketClosedError());
        return;
      }

      // if a timeout is provided, set up a timer to reject the promise if the reply doesn't come in time.
      let timeoutId: NodeJS.Timeout | undefined;
      if (timeoutMs) {
        timeoutId = setTimeout(() => {
          logger.error(`Timed out waiting for reply to message ${message.headers.message_id}`);
          reject("Timeout waiting for reply");
        }, timeoutMs);
      }

      // set up a handler for the reply message which resolves the promise, returning the reply message to our caller.
      const replyHandler = async (message: Message<RequestResponseTypeMap[T]>) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(message);
      };

      const messageRouter = MessageRouter.getInstance();
      messageRouter.registerReplyCallback(message.headers.message_id, replyHandler);

      // now send the message, having set up the reply handler. When the reply comes in, the handler will resolve the promise.
      // The callback will be automatically removed by the messageRouter when the reply is received.
      this.send(message, websocket);
    });
  }

  public getPeerWorkspaceCount(): number {
    return this.peerWorkspaceCount;
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  /**
   * Do one-time setup after successfully authorizing the workspace to sidecar.
   * When done experimenting with the websocket / MessageRouter build-out, this method will be removed
   * and the websocket will be assigned to the instance variable directly in the connect() method.
   * */
  private postAuthorizeSetup(websocket: WebSocket, accessReply: AccessResponseBody): void {
    // Real work, not fun...
    // Assign the websocket to the instance variable so regular callers can use it to send messages.
    this.websocket = websocket;
    // Store the initial workspace PEER workspace count. The reply is inclusive of the current workspace.
    this.peerWorkspaceCount = accessReply.current_workspace_count - 1;

    logger.info(`Authorized by sidecar, peer workspace count: ${this.peerWorkspaceCount}`);

    // set up handler for WORKSPACE_COUNT_CHANGED messages
    this.messageRouter.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, async (message) => {
      logger.info(
        `Received WORKSPACE_COUNT_CHANGED message: ${message.body.current_workspace_count}`,
      );
      // Remember, the reply is inclusive of the current workspace.
      this.peerWorkspaceCount = message.body.current_workspace_count - 1;
    });
  }
} // class

class WebsocketClosedError extends Error {
  constructor() {
    super("Websocket closed");
    this.name = "WebsocketClosedError";
  }
}
