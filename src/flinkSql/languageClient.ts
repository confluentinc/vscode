import * as vscode from "vscode";
import {
  CloseAction,
  ErrorAction,
  ErrorHandlerResult,
  LanguageClient,
  LanguageClientOptions,
  Message,
  Trace,
} from "vscode-languageclient/node";
import { WebSocket } from "ws";
import { Logger } from "../logging";
import { getStorageManager } from "../storage";
import { SecretStorageKeys } from "../storage/constants";
import { WebsocketTransport } from "./websocketTransport";

const logger = new Logger("flinkSql.languageClient");

/** Initialize the FlinkSQL language client and connect to the language server websocket
 * @returns A promise that resolves to the language client, or null if initialization failed
 * Prerequisites:
 * - User is authenticated with CCloud
 * - User has selected a compute pool
 */
export async function initializeLanguageClient(
  url: string,
  onWebSocketDisconnect: () => void,
): Promise<LanguageClient | null> {
  let accessToken: string | undefined = await getStorageManager().getSecret(
    SecretStorageKeys.SIDECAR_AUTH_TOKEN,
  );
  if (!accessToken) {
    logger.error(
      "Failed to initialize Flink SQL language client: No access token found for language client",
    );
    return null;
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    ws.onerror = (error) => {
      logger.error(`WebSocket connection error: ${error}`);
      reject(new Error("Failed to connect to Flink SQL language server")); //FIXME here's one error that surfaces to users
    };
    ws.onopen = async () => {
      logger.debug("WebSocket connection opened");
      try {
        const transport = new WebsocketTransport(ws);
        const serverOptions = () => {
          return Promise.resolve(transport);
        };
        const clientOptions: LanguageClientOptions = {
          documentSelector: [
            { language: "flinksql" },
            { scheme: "untitled", language: "flinksql" },
            { pattern: "**/*.flink.sql" },
          ],
          middleware: {
            didOpen: (document, next) => {
              return next(document);
            },
            didChange: (event, next) => {
              // Clear diagnostics when document changes, so user sees only latest issues
              const diagnostics = vscode.languages.getDiagnostics(event.document.uri);
              if (diagnostics.length > 0) {
                const diagnosticCollection =
                  vscode.languages.createDiagnosticCollection("flinksql");
                diagnosticCollection.delete(event.document.uri);
              }
              return next(event);
            },
            provideCompletionItem: async (document, position, context, token, next) => {
              const result: any = await next(document, position, context, token);
              if (result) {
                const items: any = result.items;
                items.forEach((element: vscode.CompletionItem) => {
                  // The server sends backticks in the filterText for all Resource completions, but vscode languageclient
                  // will filter out these items if the completion range doesn't start with a backtick, so we remove them
                  if (
                    element.filterText &&
                    element.filterText.startsWith("`") &&
                    element.filterText.endsWith("`")
                  ) {
                    element.filterText = element.filterText.substring(
                      1,
                      element.filterText.length - 1,
                    );
                  }
                });
                return result;
              }
              return [];
            },
            sendRequest: (type, params, token, next) => {
              // Server does not accept line positions > 0 for completions, so we need to convert them to single-line
              if (
                typeof type === "object" &&
                type.method &&
                type.method === "textDocument/completion"
              ) {
                if (params && (params as any).position && (params as any).textDocument?.uri) {
                  const uri = (params as any).textDocument.uri;
                  const document = vscode.workspace.textDocuments.find(
                    (doc) => doc.uri.toString() === uri,
                  );
                  if (document) {
                    const originalPosition = (params as any).position;
                    (params as any).position = convertToSingleLinePosition(
                      document,
                      new vscode.Position(originalPosition.line, originalPosition.character),
                    );
                  }
                }
              }

              return next(type, params, token);
            },
          },
          errorHandler: {
            error: (error: Error, message: Message): ErrorHandlerResult => {
              vscode.window.showErrorMessage(`Language server error: ${message}`); // FIXME do we want to show this to users?
              return {
                action: ErrorAction.Continue,
                message: `${message ?? error.message}`,
                handled: true,
              };
            },
            closed: () => {
              logger.warn("Language server connection closed by the client's error handler");
              onWebSocketDisconnect();
              return {
                action: CloseAction.Restart,
                handled: true,
              };
            },
          },
        };

        const languageClient = new LanguageClient(
          "confluent.flinksqlLanguageServer",
          "ConfluentFlinkSQL",
          serverOptions,
          clientOptions,
        );

        await languageClient.start();
        logger.debug("FlinkSQL Language Server started");
        languageClient.setTrace(Trace.Verbose);
        resolve(languageClient);
      } catch (e) {
        logger.error(`Error starting FlinkSQL language server: ${e}`);
        reject(e);
      }
    };
    ws.onclose = async (event) => {
      const reason = event.reason || "Unknown reason";
      const code = event.code;
      logger.warn(`WebSocket connection closed: Code ${code}, Reason: ${reason}`);
    };
  });
}

/** Helper to convert vscode.Position to always have {line: 0...},
 * since CCloud Flink Language Server does not support multi-line completions at this time */
function convertToSingleLinePosition(
  document: vscode.TextDocument,
  position: vscode.Position,
): vscode.Position {
  const text = document.getText();
  const lines = text.split("\n");
  let singleLinePosition = 0;

  for (let i = 0; i < position.line; i++) {
    singleLinePosition += lines[i].length + 1; // +1 for the newline character
  }
  singleLinePosition += position.character;
  return new vscode.Position(0, singleLinePosition);
}
