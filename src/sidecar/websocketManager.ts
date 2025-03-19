import { Disposable, EventEmitter as VscodeEventEmitter, window } from "vscode";
// our message callback routing internally using node's EventEmitter for .once() support + per-event-type callbacks, lacking in VSCode's EventEmitter implementation
import { EventEmitter as NodeEventEmitter } from "node:events";
import WebSocket from "ws";
import { logError } from "../errors";
import { Logger } from "../logging";
import { Message, MessageBodyDecoders, MessageType, validateMessageBody } from "../ws/messageTypes";

const logger = new Logger("websocketManager");

/** Type describing message handler callbacks to whom received messages are routed. */
export type MessageCallback<T extends MessageType> = (message: Message<T>) => Promise<void>;

export class WebsocketManager implements Disposable {
  static instance: WebsocketManager | null = null;

  static getInstance(): WebsocketManager {
    if (!WebsocketManager.instance) {
      WebsocketManager.instance = new WebsocketManager();
    }
    return WebsocketManager.instance;
  }

  private websocket: WebSocket | null = null;

  /**  Emits WebsocketStateEvent.CONNECTED and DISCONNECTED events on 'event' key. **/
  private websocketStateEmitter = new VscodeEventEmitter<WebsocketStateEvent>();

  /**
   * Delivers received messages to registered async calbacks based on the message type.
   *  @see {@link subscribe()}, {@link once()}, and {@link deliverToCallbacks()} methods.
   */
  private messageRouter: NodeEventEmitter;
  private disposables: Disposable[] = [];
  private peerWorkspaceCount = 0;

  private constructor() {
    // Set up a NodeJS EventEmitter to route received websocket messages to the appropriate async handlers
    // based on the message type.
    this.messageRouter = constructMessageRouter();

    // Install handler for WORKSPACE_COUNT_CHANGED messages. Will recieve one when connected, and whenever
    // any other workspaces connect or disconnect.
    this.subscribe(MessageType.WORKSPACE_COUNT_CHANGED, async (message) => {
      // The reply is inclusive of the current workspace, but we want to retain the peer count.
      this.peerWorkspaceCount = message.body.current_workspace_count - 1;
    });

    // Deregister all message handlers when we're disposed of.
    this.disposables.push({
      dispose: () => {
        this.messageRouter.removeAllListeners();
      },
    });
  }

  /** Are we currently connected to sidecar via websocket? */
  public isConnected(): boolean {
    return this.websocket !== null && this.websocket.readyState === WebSocket.OPEN;
  }

  /**
   * Register a listener for WebsocketStateEvent.CONNECTED and DISCONNECTED events. Primarily
   * used by the sidecarManager to know when to attempt to reconnect.
   */
  public registerStateChangeHandler(listener: (event: WebsocketStateEvent) => any): Disposable {
    return this.websocketStateEmitter.event(listener);
  }

  /**
   * Connect websocket to the sidecar, then send a WORKSPACE_HELLO message with the workspace process id.
   * Resolves the promise upon successfully connecting, have the WORKSPACE_HELLO message accepted by
   * sidecar, and sidecar sending the expected WORKSPACE_COUNT_CHANGED message, informing us of if there
   * are other workspaces online (aka the general workspace -> sidecar websocket handshaking process).
   *
   * @param hostPortFragment The host and port fragment to connect to, e.g. "localhost:8080".
   * @param accessToken The access token to use for authorization.
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

        // Resolve when we have gotten the first WORKSPACE_COUNT_CHANGED message. Will be sent
        // when any connect/disconnect happens, even ours.
        // Install a one-time handler for this message type.
        this.once(
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

        // Now send the hello message (after the handler is installed)
        // (this.websocket isn't assigned yet, so explicitly pass it to send())
        this.send(helloMessage, websocket);

        // Will now wait for the WORKSPACE_COUNT_CHANGED message to resolve the promise
        // in the above once() handler.
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

        // Defer to the NodeJS EventEmitter to deliver the message to the registered by-message-type async handler(s).
        this.deliverToCallbacks(message).catch((e) => {
          logger.error(`Error delivering message ${JSON.stringify(message, null, 2)}: ${e}`);
        });
      });

      this.disposables.push({
        dispose: () => {
          // Close the websocket when we're disposed of.
          if (this.websocket && this.websocket.readyState !== WebSocket.CLOSED) {
            this.websocket.close();
            this.websocket = null;
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
        const errorMessage = `Cannot send websocket message, too large: ${payload.length} bytes`;
        logger.error(errorMessage);
        window.showErrorMessage(errorMessage);
        throw new Error(errorMessage);
      }
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

  // Subsciption and delivery of messages to the appropriate async handlers

  /**
   * Register an async callback for messages of the given type. The callback
   * will be called by `deliverToCallbacks()` and awaited every time a message of the given type is delivered.
   **/
  public subscribe<T extends MessageType>(messageType: T, callback: MessageCallback<T>): void {
    this.messageRouter.on(messageType, callback);
  }

  /**
   * Register an async callback for messages of the given type, to be called only once by
   * `deliverToCallbacks` upon  delivery of the next message of that type.
   **/
  public once<T extends MessageType>(messageType: T, callback: MessageCallback<T>): void {
    this.messageRouter.once(messageType, callback);
  }

  /**
   * Deliver a received-from-websocket message to all registered callbacks for the message type.
   * @param message The message to deliver.
   **/
  public async deliverToCallbacks<T extends MessageType>(message: Message<T>): Promise<void> {
    const messageType = message.headers.message_type;

    // const initialCallbackCount = this.messageRouter.listenerCount(messageType);
    // logger.debug(
    //  `Delivering message of type ${message.headers.message_type} to ${initialCallbackCount} callback(s).`,
    // );

    this.messageRouter.emit(messageType, message);
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  /** Parse/deserialize a message received from websocket into a Message<T> or die trying **/
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

    const messageType = message.headers.message_type;

    // Validate the body against the message type
    validateMessageBody(messageType, body);

    // If needed for the message type, perform any higher-level body deserialization, say, promoting Dates encoded as
    // strings up to Date instances.
    const additionalDeserializer = MessageBodyDecoders[messageType];
    if (additionalDeserializer) {
      try {
        message.body = additionalDeserializer(body);
      } catch (e) {
        logError(
          e,
          "Websocket message body higher-level body deserialization error",
          {
            message: strMessage,
          },
          true,
        );

        // rethrow the error
        throw e;
      }
    }

    return message;
  }
}

export function constructMessageRouter(): NodeEventEmitter {
  // Portion of WebsocketManager constructor exported for test suite purposes.
  const messageRouter = new NodeEventEmitter({ captureRejections: true });
  messageRouter.on("error", (error: any) => {
    logger.error(`Error delivering message to message handler: ${error}`);
  });

  return messageRouter;
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
