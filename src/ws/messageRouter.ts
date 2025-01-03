/** Event subscribing / routing for recieved websocket messages */

// Internally using node's EventEmitter for .once() support, lacking in VSCode's EventEmitter implementation
import { EventEmitter } from "node:events";
import { Logger } from "../logging";
import { Message, MessageType } from "./messageTypes";

/** Type describing message handler callbacks to whom messages are routed. */
export type MessageCallback<T extends MessageType> = (message: Message<T>) => Promise<void>;

const logger = new Logger("messageRouter");

/** Message router used to deliver websocket messages to async callbacks within the extension. */
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
  private emitter: EventEmitter;

  private constructor() {
    this.emitter = createMessageRouterEventEmitter();
  }

  /**
   * Register an async callback for messages of the given type. The callback
   * will be called and awaited every time a message of the given type is delivered.
   **/
  subscribe<T extends MessageType>(messageType: T, callback: MessageCallback<T>): void {
    this.emitter.on(messageType, callback);
  }

  /**
   * Register an async callback for messages of the given type, to be called only once upon
   * delivery of the next message of that type.
   **/
  once<T extends MessageType>(messageType: T, callback: MessageCallback<T>): void {
    this.emitter.once(messageType, callback);
  }

  /**
   * Deliver a message to all registered callbacks for the message type.
   * @param message The message to deliver.
   **/
  async deliver<T extends MessageType>(message: Message<T>): Promise<void> {
    const messageType = message.headers.message_type;
    logger.info(`Delivering message of type ${messageType}`);

    const initialCallbackCount = this.emitter.listenerCount(messageType);
    logger.debug(
      `Delivering message of type ${message.headers.message_type} to ${initialCallbackCount} callback(s).`,
    );

    this.emitter.emit(messageType, message);

    logger.debug(
      `Delivered message of type ${message.headers.message_type} to all by-message-type callbacks.`,
    );
    const remainingCallbackCount = this.emitter.listenerCount(messageType);
    if (remainingCallbackCount !== initialCallbackCount) {
      logger.debug(
        `Removed ${initialCallbackCount - remainingCallbackCount} one-time callback(s) for message type ${message.headers.message_type}`,
      );
    }
  }
}

/**
 * Construct the EventEmitter used by the MessageRouter, handling async message handlers.
 *
 * (Exported so that test suite can use also)
 * @param emitters
 */
export function createMessageRouterEventEmitter(): EventEmitter {
  // Set up a new EventEmitter for all message types, with captureRejections enabled
  // to log any errors thrown by the async message handlers.
  const emitter = new EventEmitter({ captureRejections: true });
  emitter.on("error", (error: any) => {
    logger.error(`Error delivering message to message handler: ${error}`);
  });

  return emitter;
}
