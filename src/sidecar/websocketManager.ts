import { randomUUID } from "crypto";
import { Disposable } from "vscode";
import WebSocket from "ws";
import { Logger } from "../logging";
import { MessageRouter } from "../ws/messageRouter";
import { Audience, Message, MessageHeader, MessageType } from "../ws/messageTypes";
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
  private myPid = process.pid;
  private messageRouter = MessageRouter.getInstance();

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

      const websocket = new WebSocket(`ws://localhost:${SIDECAR_PORT}/pubsub`);

      let resolved = false;

      websocket.on("open", () => {
        logger.info("Websocket connected to sidecar, sending authorization.");

        // set up to handle the access request response *before* we send the access request.
        // When a positive response is received, we can then proceed with the rest of the setup
        // and resolve our overall promise.
        const messageRouter = MessageRouter.getInstance();
        const accessResponseHandler = async (message: Message<MessageType.ACCESS_RESPONSE>) => {
          if (message.body.authorized) {
            logger.info("Authorized by sidecar");
            this.postAuthorizeSetup(websocket);
            resolved = true;
            resolve();
          } else {
            logger.error("Websocke authorization failed!");
            websocket.close();
            resolved = true;
            reject("Authorization failed");
          }
        };
        messageRouter.once(MessageType.ACCESS_RESPONSE, accessResponseHandler);

        // send authorize message to sidecar
        const message: Message<MessageType.ACCESS_REQUEST> = {
          headers: {
            originator: `${this.myPid}`,
            message_id: randomUUID().toString(),
            message_type: MessageType.ACCESS_REQUEST,
            audience: Audience.SIDECAR,
          },
          body: {
            access_token: access_token,
          },
        };

        websocket.send(JSON.stringify(message));

        // if takes more than 5s to get a response, reject the promise.
        setTimeout(() => {
          if (!resolved) {
            logger.error("Authorization timeout");
            websocket.close();
            reject("Authorization timeout");
          }
        }, 5000);
      }); // on open

      websocket.on("close", () => {
        logger.info("Websocket closed");

        // do additional cleanup here

        this.websocket = null;
        this.dispose();
      }); // on close

      websocket.on("message", (data: WebSocket.Data) => {
        // decode from json. All messages from sidecar are expected to be JSON.
        try {
          const message = JSON.parse(data.toString()) as Message<any>;

          const headers: MessageHeader = message.headers;
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
    }); // promise
  } // async connect()

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  private postAuthorizeSetup(websocket: WebSocket): void {
    // While connected, every 5s, send a hello message to all other workspaces just as a proof-of-concept.
    const helloTimer = setInterval(() => {
      if (this.websocket) {
        logger.info("Sending hello message to all other workspaces...");
        const message: Message<MessageType.HELLO> = {
          headers: {
            originator: `${this.myPid}`,
            message_id: randomUUID().toString(),
            message_type: MessageType.HELLO,
            audience: Audience.WORKSPACES,
          },
          body: {
            message: `hello from workspace ${this.myPid}`,
          },
        };
        this.websocket.send(JSON.stringify(message));
        logger.info("... sent.");
      }
    }, 5000);

    const messageRouter = MessageRouter.getInstance();
    const helloHandler = async (message: Message<MessageType.HELLO>) => {
      logger.info(
        `Received hello message from workspace ${message.headers.originator}: ${message.body.message}`,
      );
    };
    const registrationToken = messageRouter.subscribe(MessageType.HELLO, helloHandler);

    this.disposables.push({ dispose: () => clearInterval(helloTimer) });

    this.websocket = websocket;
  }
} // class
