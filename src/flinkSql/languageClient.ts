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
import { logError } from "../errors";
import { Logger } from "../logging";
import { SecretStorageKeys } from "../storage/constants";
import { getSecretStorage } from "../storage/utils";
import { getFlinkSQLLanguageServerOutputChannel } from "./logging";
import { WebsocketTransport } from "./websocketTransport";

const logger = new Logger("flinkSql.languageClient.Client");
const FLINK_DIAGNOSTIC_COLLECTION_NAME = "confluent.flinkSql";

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
    let msg = "Failed to initialize Flink SQL language client: No access token found";
    logError(new Error(msg), "No token found in secret storage");
    return null;
  }
  return new Promise((resolve, reject) => {
    logger.debug(`WebSocket connection in progress`);

    const ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });

    ws.onopen = async () => {
      logger.debug("WebSocket connection opened");
    };

    /*
     * Sidecar sends an "OK" message once connection to Flink SQL language server is established
     * We wait for this message before proceeding to create the language client to avoid in-between state errors
     * This message handler is short-lived and gets cleared out after we start the client
     */
    ws.onmessage = async (event) => {
      if (event.data === "OK") {
        logger.debug("WebSocket connection established, creating language client");
        try {
          const client = await createLanguageClientFromWebsocket(ws, url, onWebSocketDisconnect);
          // Remove the message handler since we now have a language client that will handle the communication
          ws.onmessage = null;
          resolve(client);
        } catch (e) {
          let msg = "Error while creating FlinkSQL language server";
          logError(e, msg, {
            extra: {
              wsUrl: url,
            },
          });
          reject(e);
        }
      }
    };

    ws.onerror = (error) => {
      let msg = "WebSocket error connecting to Flink SQL language server.";
      logError(error, msg, {
        extra: {
          wsUrl: url,
        },
      });
      reject(error);
    };

    ws.onclose = async (event) => {
      const reason = event.reason || "Unknown reason";
      const code = event.code;
      logger.warn(`WebSocket connection closed: Code ${code}, Reason: ${reason}`);
      if (code !== 1000) {
        // 1000 is normal closure
        logError(
          new Error(`WebSocket closed unexpectedly: ${reason}`),
          "WebSocket onClose handler called",
          {
            extra: {
              code,
              reason,
              wsUrl: url,
            },
          },
        );
      }
    };
  });
}

/**
 * Creates and initializes a LanguageClient from an established WebSocket connection
 * @param ws The open WebSocket connection to the language server
 * @param url The URL of the language server (for error reporting)
 * @param onWebSocketDisconnect Callback for WebSocket disconnection events
 * @returns A promise that resolves to the initialized language client
 */
async function createLanguageClientFromWebsocket(
  ws: WebSocket,
  url: string,
  onWebSocketDisconnect: () => void,
): Promise<LanguageClient> {
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
    progressOnInitialization: true,
    diagnosticCollectionName: FLINK_DIAGNOSTIC_COLLECTION_NAME,
    middleware: {
      sendRequest: async (type, params, token, next) => {
        // CCloud Flink SQL Server does not support multiline completions atm, so we need to convert ranges to single-line & back
        if (typeof type === "object" && type.method && type.method === "textDocument/completion") {
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
              // 2. grab the completion items so we can adapt them
              const result: any = await next(type, params, token);
              return adaptCompletionItems(result, document);
            }
          }
        }

        return next(type, params, token);
      },
    },
    initializationFailedHandler: (error) => {
      let msg = "Language client initialization failed";
      logError(error, msg, {
        extra: {
          wsUrl: url,
        },
      });
      return true; // Don't send the user an error, we are handling it
    },
    errorHandler: {
      error: (error: Error, message: Message): ErrorHandlerResult => {
        let msg = "Language client error handler invoked.";
        logError(error, msg, {
          extra: {
            wsUrl: url,
          },
        });
        return {
          action: ErrorAction.Continue,
          message: `${message ?? error.message}`,
          handled: true, // Don't send the user an error, we are handling it
        };
      },
      closed: () => {
        let msg = "Language client connection closed by the client's error handler";
        logger.warn(msg);
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
  return languageClient;
}

/** Helper to convert vscode.Position to always have {line: 0...},
 * since CCloud Flink Language Server does not support multi-line completions at this time */
export function convertToSingleLinePosition(
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
export function convertToMultiLineRange(
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

/**
 * Manipulates completion items returned from the Flink SQL language server to align with VS Code's expectations.
 * 1. Converts single-line ranges from the server back to multi-line ranges for correct display in the editor.
 * 2. Removes backticks from `filterText` for resource completions if the editor text does not contain them.
 *
 * @param result The completion list from the language server response.
 * @param document The text document for which the completions were requested.
 * @returns The updated completion list.
 */
export function adaptCompletionItems(result: any, document: vscode.TextDocument): any {
  if (result) {
    const items: any = result.items;
    items.forEach((element: vscode.CompletionItem) => {
      // To show correct completion position, translate result back to multi-line
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
        const editTicks = editorRangeText.startsWith("`") && editorRangeText.endsWith("`");
        if (filterTicks && !editTicks) {
          element.filterText = undefined;
        }
      }
    });
  }
  return result;
}
