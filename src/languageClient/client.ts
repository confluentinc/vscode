import { join } from "path";
import { window, workspace } from "vscode";
import {
  CloseAction,
  ErrorAction,
  ErrorHandlerResult,
  LanguageClient,
  LanguageClientOptions,
  Message,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { getExtensionContext } from "../context/extension";

let languageClient: LanguageClient;

export function getLanguageClient(): LanguageClient {
  if (!languageClient) {
    const context = getExtensionContext();
    const serverModule = context.asAbsolutePath(join("server", "server.js"));
    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
      run: {
        module: serverModule,
        transport: TransportKind.ipc,
      },
      debug: {
        module: serverModule,
        transport: TransportKind.ipc,
      },
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { scheme: "file", language: "flinksql" },
        { scheme: "untitled", language: "flinksql" },
      ],
      synchronize: {
        fileEvents: workspace.createFileSystemWatcher("**/*.flinksql"),
      },
      errorHandler: {
        error: (error: Error, message: Message): ErrorHandlerResult => {
          window.showErrorMessage(`Language server error: ${message}`);
          return { action: ErrorAction.Continue, message: `${message ?? error.message}` };
        },
        closed: () => {
          window.showWarningMessage("Language server connection closed");
          return { action: CloseAction.Restart };
        },
      },
    };

    languageClient = new LanguageClient(
      "flinkSqlLanguageServer",
      "Confluent (Flink SQL Language Server)",
      serverOptions,
      clientOptions,
    );
  }
  return languageClient;
}
