import * as vscode from "vscode";
import {
  CloseAction,
  ErrorAction,
  ErrorHandlerResult,
  LanguageClient,
  LanguageClientOptions,
  Message,
} from "vscode-languageclient/node";
import { WebSocket } from "ws";
import { Logger } from "../logging";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { getStorageManager } from "../storage";
import { SecretStorageKeys } from "../storage/constants";
import { WebsocketTransport } from "./websocketTransport";

const logger = new Logger("flinkSql.languageClient");

let languageClient: LanguageClient | null = null;

/** Initialize the FlinkSQL language client and connect to the language server websocket
 * @returns A promise that resolves to the language client, or null if initialization failed
 * Prerequisites:
 * - User is authenticated with CCloud
 * - User has selected a compute pool
 */
export async function initializeLanguageClient(url: string): Promise<LanguageClient | null> {
  if (!hasCCloudAuthSession()) {
    logger.warn("Cannot initialize language client: User not authenticated with CCloud");
    return null;
  }

  if (languageClient) {
    logger.info("Language client already initialized");
    return languageClient;
  }

  let accessToken: string | undefined = await getStorageManager().getSecret(
    SecretStorageKeys.SIDECAR_AUTH_TOKEN,
  );
  if (!accessToken) {
    logger.error("No access token found");
    vscode.window.showErrorMessage(
      "Failed to initialize Flink SQL language client: No access token found",
    );
    return null;
  }
  return new Promise((resolve, reject) => {
    const conn = new WebSocket(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    conn.onerror = (error) => {
      logger.error(`WebSocket connection error: ${error}`);
      reject(new Error("Failed to connect to Flink SQL language server"));
    };
    conn.onopen = async () => {
      logger.info("FlinkSQL WebSocket connection opened");
      try {
        const transport = new WebsocketTransport(conn);
        const serverOptions = () => {
          return Promise.resolve(transport);
        };
        const clientOptions: LanguageClientOptions = {
          documentSelector: [
            { scheme: "file", language: "flinksql" },
            { scheme: "untitled", language: "flinksql" }, // TODO NC: We may want to use a different file extension
          ],
          middleware: {
            didOpen: (document, next) => {
              logger.info(`FlinkSQL document opened: ${document.uri}`);
              return next(document);
            },
            didChange: (event, next) => {
              // Clear diagnostics when document changes, so user sees only relevant (new) issues
              const diagnostics = languageClient?.diagnostics;
              if (diagnostics) {
                diagnostics.delete(event.document.uri);
              }
              return next(event);
            },
            provideCompletionItem: (document, position, context, token, next) => {
              // Server adds backticks to all Entity completions, so we check
              // if the character before the word range start is a backtick & if so, adjust the position
              const range = document.getWordRangeAtPosition(position);
              const line = document.lineAt(position.line).text;
              let positionToUse = position;
              if (range) {
                const charBeforeWordStart =
                  range.start.character > 0 ? line.charAt(range.start.character - 1) : "";
                if (charBeforeWordStart === "`") {
                  positionToUse = new vscode.Position(position.line, range.start.character - 1);
                }
              }
              return next(document, positionToUse, context, token);
            },
            sendRequest: (type, params, token, next) => {
              // Server does not accept line positions > 0, so we need to convert them to single-line
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

              return next(type, params, token);
            },
          },
          errorHandler: {
            error: (error: Error, message: Message): ErrorHandlerResult => {
              vscode.window.showErrorMessage(`Language server error: ${message}`);
              return { action: ErrorAction.Continue, message: `${message ?? error.message}` };
            },
            closed: () => {
              vscode.window.showWarningMessage("Language server connection closed");
              return { action: CloseAction.Restart };
            },
          },
        };

        languageClient = new LanguageClient(
          "confluent.flinksqlLanguageServer",
          "ConfluentFlinkSQL",
          serverOptions,
          clientOptions,
        );

        await languageClient.start();
        logger.info("FlinkSQL Language Server started");
        resolve(languageClient);
      } catch (e) {
        logger.error(`Error starting FlinkSQL language server: ${e}`);
        reject(e);
      }
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
