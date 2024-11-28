import { randomUUID } from "crypto";
import { Disposable } from "vscode";
import WebSocket from "ws";
import { Logger } from "../logging";
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

  async connect(access_token: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.websocket) {
        logger.info("Websocket already connected");
        resolve();
        return;
      }

      logger.info("Setting up websocket to sidecar");

      const websocket = new WebSocket(`ws://localhost:${SIDECAR_PORT}/pubsub`);

      websocket.on("open", () => {
        logger.info("Websocket connected to sidecar, sending authorization.");

        // send authorize message to sidecar
        const message = {
          header: {
            originator: `${this.myPid}`,
            message_id: randomUUID().toString(),
            message_type: "AUTHORIZE_REQUEST",
            audience: "sidecar",
          },
          body: {
            access_token: access_token,
          },
        };

        websocket.send(JSON.stringify(message));

        // now wait for the authorize response. Once authorized, then we're good to resolve the promise.
        websocket.once("message", (data: WebSocket.Data) => {
          const message = JSON.parse(data.toString());
          if (message.header?.message_type === "AUTHORIZE_RESPONSE") {
            if (message.body.authorized) {
              logger.info("Authorized by sidecar");
              this.postAuthorizeSetup(websocket);
              resolve();
            } else {
              logger.error("Authorization failed");
              websocket.close();
              reject("Authorization failed");
            }
          } else {
            logger.error("Unexpected message received");
            websocket.close();
            reject("Unexpected message received");
          }
        });
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
          const message = JSON.parse(data.toString());
          // AUTHORIZE_RESPONSE messages handled elsewhere.
          if (message.header.message_type === "AUTHORIZE_RESPONSE") {
            return;
          }

          // todo dispatch to handler(s) hased on message_type.
          const header = message.header;
          const messageType = message.header.message_type as string;
          const originator = header.originator as string;
          logger.info(
            `Recieved ${messageType} websocket message from originator ${originator}: ${JSON.stringify(message, null, 2)}`,
          );
        } catch (e) {
          logger.info(`Unparseable websocket message from sidecar: ${data}`);
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
    // While connected, every 5s, send a hello message to all other workspaces
    const helloTimer = setInterval(() => {
      if (this.websocket) {
        logger.info("Sending hello message to all other workspaces...");
        const message = {
          header: {
            originator: `${this.myPid}`,
            message_id: randomUUID().toString(),
            message_type: "HELLO",
            audience: "workspaces",
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
