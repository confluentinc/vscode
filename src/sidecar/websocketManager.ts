import { randomUUID } from "crypto";
import { Disposable } from "vscode";
import WebSocket from "ws";
import { Logger } from "../logging";
import {
  AccessRequestBody,
  AccessResponseBody,
  Audience,
  HelloBody,
  Message,
  MessageType,
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
  private myPid = process.pid;

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

        // send authorize message to sidecar
        const message: Message<AccessRequestBody> = {
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

        // now wait for the next message, which should be an access response.
        // If comes back with payload `true`, then we're good to resolve the promise.
        websocket.once("message", (data: WebSocket.Data) => {
          const message = JSON.parse(data.toString()) as Message<AccessResponseBody>;
          if (message.headers.message_type === "ACCESS_RESPONSE") {
            if (message.body.authorized) {
              logger.info("Authorized by sidecar");
              this.postAuthorizeSetup(websocket);
              resolved = true;
              resolve();
            } else {
              logger.error("Authorization failed");
              websocket.close();
              resolved = true;
              reject("Authorization failed");
            }
          } else {
            logger.error("Unexpected message received, type: " + message.headers.message_type);
            websocket.close();
            resolved = true;
            reject("Unexpected message received");
          }
        });

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
          // AUTHORIZE_RESPONSE messages handled elsewhere.
          if (message.headers.message_type === MessageType.ACCESS_RESPONSE) {
            return;
          }

          // todo dispatch to handler(s) hased on message_type.
          const headers = message.headers;
          const messageType = message.headers.message_type;
          const originator = headers.originator;
          logger.info(
            `Recieved ${messageType} websocket message from originator ${originator}: ${JSON.stringify(message, null, 2)}`,
          );
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
        const message: Message<HelloBody> = {
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

    this.disposables.push({ dispose: () => clearInterval(helloTimer) });

    this.websocket = websocket;
  }
} // class
