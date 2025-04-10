import {
  MessageTransports,
  MessageReader,
  MessageWriter,
  Message,
  PartialMessageInfo,
  DataCallback,
} from "vscode-languageclient/node";
import { LanguageServerSocket, WebsocketStateEvent } from "./languageServerSocket";
import { EventEmitter, Event, Disposable } from "vscode";
import { Logger } from "../logging";

const logger = new Logger("websocketTransport");

class WebsocketMessageReader implements MessageReader {
  private socket: LanguageServerSocket;
  private messageEmitter = new EventEmitter<Message>();
  private errorEmitter = new EventEmitter<Error>();
  private closeEmitter = new EventEmitter<void>();
  private partialMessageEmitter = new EventEmitter<PartialMessageInfo>();

  constructor(socket: LanguageServerSocket) {
    this.socket = socket;
    this.socket.on("message", (data: string) => {
      try {
        logger.info(`Received message from language server: ${data}`);
        const message = JSON.parse(data);
        this.messageEmitter.fire(message);
        logger.info("Message emitted to language client");
      } catch (e) {
        logger.error(`Error parsing LSP message: ${e}`);
        this.errorEmitter.fire(e as Error);
      }
    });

    this.socket.registerStateChangeHandler((event) => {
      logger.info(`Websocket state changed: ${event}`);
      if (event === WebsocketStateEvent.DISCONNECTED) {
        this.closeEmitter.fire();
      }
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
  private socket: LanguageServerSocket;
  private errorEmitter = new EventEmitter<[Error, Message | undefined, number | undefined]>();
  private closeEmitter = new EventEmitter<void>();

  constructor(socket: LanguageServerSocket) {
    this.socket = socket;
    this.socket.registerStateChangeHandler((event) => {
      if (event === WebsocketStateEvent.DISCONNECTED) {
        this.closeEmitter.fire();
      }
    });
  }

  public async write(message: Message): Promise<void> {
    try {
      logger.info(`Sending message to language server: ${JSON.stringify(message)}`);
      this.socket.send(message);
      logger.info("Message sent successfully");
    } catch (error) {
      logger.error(`Failed to send message: ${error}`);
      this.errorEmitter.fire([error as Error, message, undefined]);
      throw error;
    }
  }

  public onError: Event<[Error, Message | undefined, number | undefined]> = this.errorEmitter.event;
  public onClose: Event<void> = this.closeEmitter.event;

  public async end(): Promise<void> {
    // Not needed for websocket transport
  }

  public dispose(): void {
    this.errorEmitter.dispose();
    this.closeEmitter.dispose();
  }
}

export class WebsocketTransport implements MessageTransports {
  public reader: MessageReader;
  public writer: MessageWriter;

  constructor(socket: LanguageServerSocket) {
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
