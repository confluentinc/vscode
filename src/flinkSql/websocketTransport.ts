import { Disposable, Event, EventEmitter } from "vscode";
import {
  DataCallback,
  Message,
  MessageReader,
  MessageTransports,
  MessageWriter,
  PartialMessageInfo,
} from "vscode-languageclient/node";
import { WebSocket } from "ws";
import { Logger } from "../logging";

const logger = new Logger("flinkSql.languageClient.WebsocketTransport");

/** Create a WebSocket that reads/writes messages in Language Server Protocol + JSON-RPC
 * Used by the FlinkSQL LanguageClient to communicate with the ccloud language server
 */
class WebsocketMessageReader implements MessageReader {
  private socket: WebSocket;
  private messageEmitter = new EventEmitter<Message>();
  private errorEmitter = new EventEmitter<Error>();
  private closeEmitter = new EventEmitter<void>();
  private partialMessageEmitter = new EventEmitter<PartialMessageInfo>();

  constructor(socket: WebSocket) {
    this.socket = socket;

    this.socket.on("message", (data: Buffer | string) => {
      try {
        const strData = typeof data === "string" ? data : data.toString("utf8");
        const message = JSON.parse(strData);
        this.messageEmitter.fire(message);
      } catch (e) {
        logger.error(`Error parsing LSP message: ${e}`);
        this.errorEmitter.fire(e as Error);
      }
    });

    this.socket.on("close", () => {
      logger.debug("WebSocket connection closed");
      this.closeEmitter.fire();
    });

    this.socket.on("error", (error) => {
      logger.error(`WebSocket error: ${error}`);
      this.errorEmitter.fire(error);
    });
  }

  public onError: Event<Error> = this.errorEmitter.event;
  public onClose: Event<void> = this.closeEmitter.event;
  public onPartialMessage: Event<PartialMessageInfo> = this.partialMessageEmitter.event;

  public listen(callback: DataCallback): Disposable {
    return this.messageEmitter.event((event) => {
      callback(event);
    });
  }

  public dispose(): void {
    this.messageEmitter.dispose();
    this.errorEmitter.dispose();
    this.closeEmitter.dispose();
    this.partialMessageEmitter.dispose();
  }
}

class WebsocketMessageWriter implements MessageWriter {
  private socket: WebSocket;
  private errorEmitter = new EventEmitter<[Error, Message | undefined, number | undefined]>();
  private closeEmitter = new EventEmitter<void>();

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.on("close", () => {
      this.closeEmitter.fire();
    });

    this.socket.on("error", (error) => {
      this.errorEmitter.fire([error, undefined, undefined]);
    });
  }

  public async write(message: Message): Promise<void> {
    // Check if socket was closed to prevent "sendAfterClose" errors
    if (this.socket.readyState !== WebSocket.OPEN) {
      logger.warn("Attempted to write to closed WebSocket, ignoring message");
      return Promise.resolve();
    }

    try {
      const messageStr = JSON.stringify(message);
      return new Promise<void>((resolve, reject) => {
        this.socket.send(messageStr, (error) => {
          if (error) {
            logger.error(`Failed to send message: ${error}`);
            this.errorEmitter.fire([error, message, undefined]);
            reject(error);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      logger.error(`Error preparing message: ${error}`);
      this.errorEmitter.fire([error as Error, message, undefined]);
      throw error;
    }
  }

  public onError: Event<[Error, Message | undefined, number | undefined]> = this.errorEmitter.event;
  public onClose: Event<void> = this.closeEmitter.event;

  public async end(): Promise<void> {
    // Close the WebSocket connection gently if needed
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000, "Client closed connection");
    }
  }

  public dispose(): void {
    this.errorEmitter.dispose();
    this.closeEmitter.dispose();
  }
}

export class WebsocketTransport implements MessageTransports {
  public reader: MessageReader;
  public writer: MessageWriter;
  private socket: WebSocket;

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.reader = new WebsocketMessageReader(socket);
    this.writer = new WebsocketMessageWriter(socket);
  }

  public async dispose(): Promise<void> {
    logger.debug("Disposing websocket transport");
    // Make sure we close the writer first to send any pending messages
    try {
      await (this.writer as WebsocketMessageWriter).end();
    } catch (err) {
      logger.error(`Error calling writer.end(): ${err}`);
    }

    // Then dispose both reader and writer
    this.reader.dispose();
    this.writer.dispose();

    // Finally, close the socket directly if it's still open
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      try {
        this.socket.close(1000, "Transport disposed");
      } catch (err) {
        logger.error(`Error closing WebSocket: ${err}`);
      }
    }
  }
}
