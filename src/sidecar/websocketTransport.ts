import {
  MessageTransports,
  MessageReader,
  MessageWriter,
  Message,
  PartialMessageInfo,
  DataCallback,
} from "vscode-languageclient/node";
import { EventEmitter, Event, Disposable } from "vscode";
import { Logger } from "../logging";
import { WebSocket } from "ws";

const logger = new Logger("websocketTransport");

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
        logger.info(`Received message from language server: ${strData}`);
        const message = JSON.parse(strData);
        this.messageEmitter.fire(message);
        logger.info("Message emitted to language client");
      } catch (e) {
        logger.error(`Error parsing LSP message: ${e}`);
        this.errorEmitter.fire(e as Error);
      }
    });

    this.socket.on("close", () => {
      logger.info("WebSocket connection closed");
      this.closeEmitter.fire();
    });

    this.socket.on("error", (error) => {
      logger.error(`WebSocket error: ${error}`);
      this.errorEmitter.fire(error);
    });
  }

  public onMessage: Event<Message> = this.messageEmitter.event;
  public onError: Event<Error> = this.errorEmitter.event;
  public onClose: Event<void> = this.closeEmitter.event;
  public onPartialMessage: Event<PartialMessageInfo> = this.partialMessageEmitter.event;

  public listen(callback: DataCallback): Disposable {
    // Not needed for websocket transport
    return new Disposable(() => {});
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
    try {
      const messageStr = JSON.stringify(message);
      logger.info(`Sending message to language server: ${messageStr}`);

      return new Promise<void>((resolve, reject) => {
        this.socket.send(messageStr, (error) => {
          if (error) {
            logger.error(`Failed to send message: ${error}`);
            this.errorEmitter.fire([error, message, undefined]);
            reject(error);
          } else {
            logger.info("Message sent successfully");
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

  constructor(socket: WebSocket) {
    logger.info("Creating websocket transport");
    this.reader = new WebsocketMessageReader(socket);
    this.writer = new WebsocketMessageWriter(socket);
  }

  public dispose(): void {
    logger.info("Disposing websocket transport");
    this.reader.dispose();
    this.writer.dispose();
  }
}
