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
import { SecretStorageKeys } from "../storage/constants";
import { getSecretStorage } from "../storage/utils";
import { getFlinkSQLLanguageServerOutputChannel } from "./logging";
import { WebsocketTransport } from "./websocketTransport";

const logger = new Logger("flinkSql.languageClient.Client");

/** Initialize the FlinkSQL language client and connect to the language server websocket.
 * Creates a WebSocket (ws), then on ws.onopen makes the WebsocketTransport class for server, and then creates the Client.
 * Provides middleware for completions and diagnostics in ClientOptions
 * @param url The URL of the language server websocket
 * @param onWebSocketDisconnect Callback for WebSocket disconnection events
 * @returns A promise that resolves to the language client, or null if initialization failed
 */
export async function initializeLanguageClient(
  url: string,
  onWebSocketDisconnect: () => void,
): Promise<LanguageClient | null> {
  let accessToken: string | undefined = await getSecretStorage().get(
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
          outputChannel: getFlinkSQLLanguageServerOutputChannel(),
          synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher("**/*.flink.sql"),
          },
          progressOnInitialization: true,
          middleware: {
            sendRequest: async (type, params, token, next) => {
              // CCloud Flink SQL Server does not support multiline completions atm, so we need to convert ranges to single-line & back
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
                    // 1. on the way out, convert position to {line: 0}
                    (params as any).position = convertToSingleLinePosition(
                      document,
                      new vscode.Position(originalPosition.line, originalPosition.character),
                    );
                    // 2. get the completion items
                    const result: any = await next(type, params, token);
                    if (result) {
                      const items: any = result.items;
                      items.forEach((element: vscode.CompletionItem) => {
                        // 3. to show correct completion position, translate result back to multi-line
                        if (element.textEdit) {
                          let newRange = convertToMultiLineRange(document, element.textEdit.range);
                          element.textEdit.range = newRange;
                        }
                        // CCloud Flink SQL Server adds backticks for all Resource completions even if not typed in the editor doc
                        // To align with vscode's expectations we remove the filterText if the editor's range does not already begin or end with backtick
                        // ...causing it to fall back on the label for filtering
                        if (element.textEdit) {
                          const editorRangeText = document.getText(element.textEdit.range);
                          const filter = element.filterText;
                          const filterTicks = filter?.startsWith("`") && filter?.endsWith("`");
                          const editTicks =
                            editorRangeText.startsWith("`") && editorRangeText.endsWith("`");
                          if (filterTicks && !editTicks) {
                            element.filterText = undefined;
                          }
                        }
                      });
                    }
                    return result;
                  }
                }
              }

              return next(type, params, token);
            },
          },
          initializationFailedHandler: (error) => {
            logger.error(`Language server initialization failed: ${error}`);
            return true; // Don't send the user an error, we are handling it
          },
          errorHandler: {
            error: (error: Error, message: Message): ErrorHandlerResult => {
              logger.error(`Language server error: ${message}`);
              return {
                action: ErrorAction.Continue,
                message: `${message ?? error.message}`,
                handled: true, // Don't send the user an error, we are handling it
              };
            },
            closed: () => {
              logger.warn("Language server connection closed by the client's error handler");
              onWebSocketDisconnect();
              return {
                action: CloseAction.Restart,
                handled: true, // Don't send the user an error, we are handling it
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
        languageClient.setTrace(Trace.Compact);
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

/**
 * Helper to convert a single-line range (line: 0, character: X) back to a multi-line range.
 * Reverses the effect of convertToSingleLinePosition.
 */
function convertToMultiLineRange(
  document: vscode.TextDocument,
  singleLineRange: vscode.Range,
): vscode.Range {
  const text = document.getText();
  const lines = text.split("\n");

  function offsetToPosition(offset: number): vscode.Position {
    let runningOffset = 0;
    for (let line = 0; line < lines.length; line++) {
      const lineLength = lines[line].length + 1; // +1 for newline
      if (offset < runningOffset + lineLength) {
        return new vscode.Position(line, offset - runningOffset);
      }
      runningOffset += lineLength;
    }
    // Fallback = last position
    return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
  }

  const startOffset = singleLineRange.start.character;
  const endOffset = singleLineRange.end.character;
  const start = offsetToPosition(startOffset);
  const end = offsetToPosition(endOffset);
  return new vscode.Range(start, end);
}
