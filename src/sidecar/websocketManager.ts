import { Disposable, EventEmitter } from "vscode";
import WebSocket from "ws";
import { Logger } from "../logging";
import { MessageRouter } from "../ws/messageRouter";
import { Message, MessageHeaders, MessageType, validateMessageBody } from "../ws/messageTypes";

const logger = new Logger("websocketManager");

export class WebsocketManager implements Disposable {
  static instance: WebsocketManager | null = null;

  static getInstance(): WebsocketManager {
    if (!WebsocketManager.instance) {
      WebsocketManager.instance = new WebsocketManager();
    }
    return WebsocketManager.instance;
  }

  private websocket: WebSocket | null = null;
  // Emits WebsocketStateEvent.CONNECTED and DISCONNECTED events.
  private websocketStateEmitter = new EventEmitter<WebsocketStateEvent>();
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

    this.messageRouter.subscribe(MessageType.PROTOCOL_ERROR, this.onProtocolError.bind(this));
  }

  /** Are we currently connected to sidecar via websocket? */
  public isConnected(): boolean {
    return this.websocket !== null && this.websocket.readyState === WebSocket.OPEN;
  }

  /** Register a listener for WebsocketStateEvent.CONNECTED and DISCONNECTED events. */
  public registerStateChangeHandler(listener: (event: WebsocketStateEvent) => any): Disposable {
    return this.websocketStateEmitter.event(listener);
  }

  /**
   * Connect websocket to the sidecar, then send an ACCESS_REQUEST message containing the access_token.
   * Resolves the promise upon successful authorization.
   * @param access_token
   * @returns
   */
  async connect(hostPortFragment: string, accessToken: string): Promise<void> {
    return new Promise<void>((resolve) => {
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        logger.info("Websocket already connected");
        resolve();
        return;
      }

      logger.info("Setting up websocket to sidecar");

      const websocket = new WebSocket(`ws://${hostPortFragment}/ws`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });

      websocket.on("open", () => {
        logger.info("Websocket connected to sidecar, saying hello ...");

        // send the hello message
        const helloMessage: Message<MessageType.WORKSPACE_HELLO> = {
          headers: {
            message_type: MessageType.WORKSPACE_HELLO,
            originator: process.pid.toString(),
            message_id: "1",
          },
          body: {
            workspace_id: process.pid,
          },
        };

        // this.websocket isn't assigned yet, so explicitly pass it in
        this.send(helloMessage, websocket);

        // Now await the first WORKSPACE_COUNT_CHANGED message, will be sent
        // to all workspaces when any connect+hello or disconnect happens.

        // Resolve when we have gotten the first WORKSPACE_COUNT_CHANGED message. Will be sent
        // when any connect/disconnect happens, even ours.
        // Install a one-time handler for this message type.
        this.messageRouter.once(
          MessageType.WORKSPACE_COUNT_CHANGED,
          async (m: Message<MessageType.WORKSPACE_COUNT_CHANGED>) => {
            logger.info(
              "Received initial WORKSPACE_COUNT_CHANGED message, websocket now fully connected.",
            );
            this.websocket = websocket;
            this.peerWorkspaceCount = m.body.current_workspace_count - 1;
            // Emit an event to let the extension know the websocket has closed.
            // This will get picked up by sidecarManager, which will then attempt to reconnect.
            this.websocketStateEmitter.fire(WebsocketStateEvent.CONNECTED);
            resolve();
          },
        );
      });

      websocket.on("close", () => {
        logger.info("Websocket closed");

        // do additional cleanup here
        this.websocket = null;

        // Emit an event to let the extension know the websocket has closed.
        // This will get picked up by sidecarManager, which will then attempt to reconnect.
        this.websocketStateEmitter.fire(WebsocketStateEvent.DISCONNECTED);
      });

      websocket.on("error", (error) => {
        logger.error(`Websocket error: ${error}`);
        // Go ahead and close the websocket, which will trigger the close event above.
        websocket.close();
      });

      websocket.on("message", (data: WebSocket.Data) => {
        // Deserialize from JSON and deliver the message to the message router.
        let message: Message<MessageType>;
        try {
          message = WebsocketManager.parseMessage(data);
        } catch (e) {
          logger.info(
            `Unparseable websocket message from sidecar: ${(e as Error).message} from message '${data.toString()}'`,
          );
          return;
        }

        const headers: MessageHeaders = message.headers;
        logger.debug(
          `Recieved ${headers.message_type} websocket message from originator ${headers.originator}: ${JSON.stringify(message, null, 2)}`,
        );

        // Defer to the internal message router to deliver the message to the registered by-message-type async handler(s).
        this.messageRouter.deliver(message).catch((e) => {
          logger.error(`Error delivering message ${JSON.stringify(message, null, 2)}: ${e}`);
        });
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

  private async onProtocolError(message: Message<MessageType.PROTOCOL_ERROR>): Promise<void> {
    logger.error(`Sidecar reported a websocket protocol error: ${message.body.error}.`);
  }

  /**
   * Send a message to / through sidecar over the websocket.
   * The websocket send is ultimately async underneath the hood.
   * @throws {WebsocketClosedError} if the websocket is not connected.
   */
  public send<T extends MessageType>(
    message: Message<T>,
    websocket: WebSocket | undefined = undefined,
  ): void {
    if (!websocket) {
      if (!this.websocket) {
        logger.error("Websocket not assigned or provided, cannot send message");
        throw new WebsocketClosedError();
      }
      websocket = this.websocket;
    }

    if (websocket && websocket.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify(message);
      if (payload.length > 64 * 1024) {
        logger.error(`Cannot send websocket message, too large: ${payload.length} bytes`);
        throw new Error("Payload too large");
      }
      logger.debug(`Sending ${payload.length} byte ${message.headers.message_type} message`);
      websocket.send(payload);
    } else {
      logger.error("Websocket not assigned + open, cannot send message");
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

  /** Parse a message recieved from websocket into a Message<T> or die trying *
   */
  static parseMessage(data: WebSocket.Data): Message<MessageType> {
    const strMessage = data.toString();
    const message = JSON.parse(strMessage) as Message<MessageType>;
    // ensure the message has the required headers
    const headers = message.headers;
    if (!headers) {
      throw new Error("Message missing headers: " + strMessage);
    }
    if (!message.headers.message_type) {
      throw new Error("Message missing headers.message_type: " + strMessage);
    }
    // message type must be known
    if (!MessageType[message.headers.message_type]) {
      throw new Error("Unknown message type: " + message.headers.message_type);
    }
    if (!message.headers.originator) {
      throw new Error("Message missing originator header: " + strMessage);
    }
    // originator must either be "sidecar" or a process id string
    if (message.headers.originator !== "sidecar" && isNaN(parseInt(message.headers.originator))) {
      throw new Error("Invalid originator value: " + message.headers.originator);
    }

    const body: any = message.body;

    if (!body) {
      throw new Error("Message missing body: " + strMessage);
    }

    if (typeof body !== "object") {
      throw new Error("Message body must be an object: " + strMessage);
    }

    // Validate the body against the message type
    validateMessageBody(message.headers.message_type, body);

    return message;
  }
}

class WebsocketClosedError extends Error {
  constructor() {
    super("Websocket closed");
    this.name = "WebsocketClosedError";
  }
}

/** Events emitted by WebsocketManager.websocketStateEmitter whenever connection state changes. */
export enum WebsocketStateEvent {
  CONNECTED = "connected",
  DISCONNECTED = "disconnected",
}
