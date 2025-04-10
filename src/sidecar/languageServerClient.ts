import { ExtensionContext, workspace, TextDocument } from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  StreamInfo,
  TextDocumentSyncKind,
} from "vscode-languageclient/node";
import { LanguageServerSocket } from "./languageServerSocket";
import { WebsocketTransport } from "./websocketTransport";
import { Logger } from "../logging";
import * as net from "net";

const logger = new Logger("languageServerClient");

export class LanguageServerClient {
  private client: LanguageClient | null = null;
  private socket: LanguageServerSocket;
  private transport: WebsocketTransport;
  private context: ExtensionContext | null = null;
  private isInitialized: boolean = false;

  constructor() {
    this.socket = LanguageServerSocket.getInstance();
    this.transport = new WebsocketTransport(this.socket);
  }
  public async start(context: ExtensionContext): Promise<void> {
    logger.info("Starting language server client");
    this.context = context;
    const serverOptions = () => Promise.resolve(this.transport);

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: "file", language: "plaintext" },
        { scheme: "file", language: "sql" },
      ],
      outputChannelName: "FlinkSQL Language Server",
      synchronize: {
        fileEvents: workspace.createFileSystemWatcher("**/*.flinksql"),
      },
      initializationOptions: {
        // Add any initialization options needed for the language server
      },
      middleware: {
        didOpen: async (document, next) => {
          logger.info(`Document opened: ${document.fileName}`);
          logger.info(`Document content: ${document.getText()}`);
          await next(document);
        },
        didChange: async (event, next) => {
          logger.info(`Document changed: ${event.document.fileName}`);
          logger.info(`Changes: ${JSON.stringify(event.contentChanges)}`);
          await next(event);
        },
        provideCompletionItem: async (document, position, context, token, next) => {
          logger.info(`Completion requested at position ${position.line}:${position.character}`);
          logger.info(`Document content: ${document.getText()}`);
          const result = await next(document, position, context, token);
          logger.info(`Completion result: ${JSON.stringify(result)}`);
          return result;
        },
      },
    };

    this.client = new LanguageClient(
      "flinksqlLanguageServer",
      "FlinkSQL Language Server",
      serverOptions,
      clientOptions,
    );

    // Set up file open handler
    // context.subscriptions.push(workspace.onDidOpenTextDocument(this.handleDocumentOpen.bind(this)));

    logger.info("Language server client started and file open handler registered");
  }

  public async stop(): Promise<void> {
    logger.info("Stopping language server client");
    if (this.client) {
      await this.client.stop();
      this.client = null;
      this.isInitialized = false;
      logger.info("Language server client stopped");
    }
  }

  public async connect(hostPortFragment: string): Promise<void> {
    logger.info(`Connecting to language server at ${hostPortFragment}`);
    await this.socket.connect(hostPortFragment);
    logger.info("Connected to language server");
  }
}
