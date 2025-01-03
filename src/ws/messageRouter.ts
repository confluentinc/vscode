/** Event subscribing / routing for recieved websocket messages */

// Internally using node's EventEmitter for .once() support, lacking in VSCode's EventEmitter implementation
import { EventEmitter } from "node:events";
import { Logger } from "../logging";
import { Message, MessageType } from "./messageTypes";

/** Type describing message handler callbacks to whom messages are routed. */
export type MessageCallback<T extends MessageType> = (message: Message<T>) => Promise<void>;

const logger = new Logger("messageRouter");

export class MessageRouter {
  private static instance: MessageRouter | null = null;

  static getInstance(): MessageRouter {
    if (!MessageRouter.instance) {
      MessageRouter.instance = new MessageRouter();
    }
    return MessageRouter.instance;
  }

  /**
   * Map of message type -> EventEmitter with callbacks registered via either
   * subscribe() or once().
   */
  private emitters: Map<MessageType, EventEmitter> = new Map();

  private constructor() {
    this.emitters = new Map();
    populateEmittersMap(this.emitters);
  }

  /**
   * Register an async callback for messages of the given type. The callback
   * will be called and awaited every time a message of the given type is delivered.
   **/
  subscribe<T extends MessageType>(messageType: T, callback: MessageCallback<T>): void {
    const emitter = this.emitters.get(messageType);
    if (emitter === undefined) {
      throw new Error(`MessageRouter::subscribe(): unknown message type ${messageType}`);
    }

    emitter.on("message", callback);
  }

  /**
   * Register an async callback for messages of the given type, to be called only once upon
   * delivery of the next message of that type.
   **/
  once<T extends MessageType>(messageType: T, callback: MessageCallback<T>): void {
    const emitter = this.emitters.get(messageType);
    if (emitter === undefined) {
      throw new Error(`MessageRouter::once(): unknown message type ${messageType}`);
    }
    emitter.once("message", callback);
  }

  /**
   * Deliver a message to all registered callbacks for the message type.
   * @param message The message to deliver.
   **/
  async deliver<T extends MessageType>(message: Message<T>): Promise<void> {
    logger.info(`Delivering message of type ${message.headers.message_type}`);

    const emitter = this.emitters.get(message.headers.message_type);
    if (emitter === undefined) {
      logger.warn(`Unknown message type ${message.headers.message_type}`);
      return;
    }

    const initialCallbackCount = emitter.listenerCount("message");
    logger.debug(
      `Delivering message of type ${message.headers.message_type} to ${initialCallbackCount} callback(s).`,
    );

    emitter.emit("message", message);

    logger.debug(
      `Delivered message of type ${message.headers.message_type} to all by-message-type callbacks.`,
    );
    const remainingCallbackCount = emitter.listenerCount("message");
    if (remainingCallbackCount !== initialCallbackCount) {
      logger.debug(
        `Removed ${initialCallbackCount - remainingCallbackCount} one-time callback(s) for message type ${message.headers.message_type}`,
      );
    }
  }
}

/**
 * Construct EventEmitters for each message type
 *
 * (Exported so that test suite can use also)
 * @param emitters
 */
export function populateEmittersMap(emitters: Map<MessageType, EventEmitter>): void {
  for (const messageType in MessageType) {
    // Set up a new EventEmitter for each message type, with captureRejections enabled
    // to log any errors thrown by the async message handlers.
    const perTypeEmitter = new EventEmitter({ captureRejections: true });
    perTypeEmitter.on("error", (error: any) => {
      logger.error(`Error delivering message to message handler for ${messageType}: ${error}`);
    });
    emitters.set(messageType as MessageType, perTypeEmitter);
  }
}
