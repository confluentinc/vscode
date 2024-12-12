/** Event subscribing / routing for recieved websocket messages */

import { randomUUID } from "node:crypto";
import { Logger } from "../logging";
import { Message, MessageType } from "./messageTypes";

/** Type describing message handler callbacks to whom messages are routed. */
export type MessageCallback<T extends MessageType> = (message: Message<T>) => Promise<void>;

/** Type keeping track of a per-message-type callbacks. */
type CallbackEntry<T extends MessageType> = {
  callback: MessageCallback<T>; // Callback to be called when a message of this type is recieved.
  once: boolean; // Indicates if the callback should be called only once, then removed. This featurette might never be used.
  registrationToken: string; // Unique token to identify the callback for removal.
};

/** Type for a map of message type -> array of callback entries.*/
type CallbackMap = Map<MessageType, CallbackEntry<any>[]>;

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
   * Map of message type -> array of (many|once) callbacks registered via either
   * subscribe() or once().
   */
  private callbacks: CallbackMap;

  private constructor() {
    this.callbacks = new Map();
    for (const messageType in MessageType) {
      this.callbacks.set(messageType as MessageType, []);
    }
  }

  /**
   * Register an async callback for messages of the given type.
   * @returns A registration token that can be used to unsubscribe the callback.
   **/
  subscribe<T extends MessageType>(messageType: T, callback: MessageCallback<T>): string {
    const registrationToken = this.generateRegistrationToken();
    this.callbacks.get(messageType)!.push({ callback, once: false, registrationToken });
    return registrationToken;
  }

  /**
   * Register an async callback for messages of the given type, to be called only once.
   * @returns A registration token that can be used to unsubscribe the callback (before it is called).
   **/
  once<T extends MessageType>(messageType: T, callback: MessageCallback<T>): string {
    const registrationToken = this.generateRegistrationToken();
    this.callbacks.get(messageType)!.push({ callback, once: true, registrationToken });
    return registrationToken;
  }

  /**
   * Unsubscribe a callback from receiving messages of the given type.
   * @param registrationToken The token returned by the subscribe() or once() call.
   **/
  unsubscribe(registrationToken: string): void {
    for (const callbacks of this.callbacks.values()) {
      for (let i = 0; i < callbacks.length; i++) {
        if (callbacks[i].registrationToken === registrationToken) {
          callbacks.splice(i, 1);
          return;
        }
      }
    }
  }

  /**
   * Deliver a message to all registered callbacks for the message type.
   * @param message The message to deliver.
   **/
  async deliver<T extends MessageType>(message: Message<T>): Promise<void> {
    logger.info(`Delivering message of type ${message.headers.message_type}`);

    // Deliver the message to all registered general by-message-type callbacks.
    const callbacks = this.callbacks.get(message.headers.message_type);
    if (callbacks === undefined) {
      // Wacky! We got a message type that we don't have callbacks array in map for.
      // Mismatch between what sidecar is sending and what the extension is expecting?
      logger.warn(
        `MessageRouter::deliver(): unexpected message type ${message.headers.message_type}!`,
      );
      return;
    }

    const initialCallbackCount = callbacks.length;
    if (initialCallbackCount === 0) {
      logger.warn(`No callbacks for message type ${message.headers.message_type}`);
      return;
    } else {
      logger.info(
        `Found ${initialCallbackCount} callbacks for message type ${message.headers.message_type}`,
      );
    }

    const callbackPromises: Promise<void>[] = [];

    // Collect all the promises from the per-message-type callbacks. Clean out any one-time callbacks as we go.
    for (let i = 0; i < callbacks.length; i++) {
      const { callback, once } = callbacks[i];
      callbackPromises.push(callback(message));
      if (once) {
        // Remove this one-time callback. We're mutating the array in the map.
        callbacks.splice(i, 1);
        // Because we're iterating over what we just mutated, we need to decrement the index again.
        i--;
      }
    }

    // Wait for all the promises to resolve concurrently
    await Promise.all(callbackPromises);

    logger.debug(
      `Delivered message of type ${message.headers.message_type} to all by-message-type callbacks.`,
    );
    if (callbacks.length !== initialCallbackCount) {
      logger.debug(
        `Removed ${initialCallbackCount - callbacks.length} one-time callback(s) for message type ${message.headers.message_type}`,
      );
    }
  }

  private generateRegistrationToken(): string {
    return randomUUID().toString();
  }
}
