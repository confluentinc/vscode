/** Event subscribing / routing for recieved websocket messages */

import { Logger } from "../logging";
import { Message, MessageType } from "./messageTypes";

/** Type describing message handler callbacks to whom messages are routed. */
export type MessageCallback<T extends MessageType> = (message: Message<T>) => Promise<void>;

type CallbackEntry<T extends MessageType> = {
  callback: MessageCallback<T>; // Callback to be called when the event is triggered
  once: boolean; // Indicates if the callback should be called only once
  registrationToken: string; // Unique token to identify the callback for removal
};

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

  private callbacks: CallbackMap;

  private constructor() {
    this.callbacks = new Map();
    for (const messageType in MessageType) {
      this.callbacks.set(messageType as MessageType, []);
    }
  }

  subscribe<T extends MessageType>(messageType: T, callback: MessageCallback<T>): string {
    const registrationToken = this.generateRegistrationToken();
    this.callbacks.get(messageType)!.push({ callback, once: false, registrationToken });
    return registrationToken;
  }

  once<T extends MessageType>(messageType: T, callback: MessageCallback<T>): string {
    const registrationToken = this.generateRegistrationToken();
    this.callbacks.get(messageType)!.push({ callback, once: true, registrationToken });
    return registrationToken;
  }

  async deliver<T extends MessageType>(message: Message<T>): Promise<void> {
    logger.info(`Delivering message of type ${message.headers.message_type}`);
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

    // Collect all the promises from the callbacks + clean out any one-time callbacks
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

    logger.info(`Delivered message of type ${message.headers.message_type} to all callbacks.`);
    if (callbacks.length !== initialCallbackCount) {
      logger.info(
        `Removed ${initialCallbackCount - callbacks.length} one-time callbacks for message type ${message.headers.message_type}`,
      );
    }
  }

  remove(registrationToken: string): void {
    for (const callbacks of this.callbacks.values()) {
      for (let i = 0; i < callbacks.length; i++) {
        if (callbacks[i].registrationToken === registrationToken) {
          callbacks.splice(i, 1);
          return;
        }
      }
    }
  }

  private generateRegistrationToken(): string {
    return Math.random().toString(36).substring(2);
  }
}
