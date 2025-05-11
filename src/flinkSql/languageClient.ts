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
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { getStorageManager } from "../storage";
import { SecretStorageKeys } from "../storage/constants";
import { WebsocketTransport } from "./websocketTransport";

const logger = new Logger("flinkSql.languageClient");

let languageClient: LanguageClient | null = null;
let reconnectCounter = 0;
const MAX_RECONNECT_ATTEMPTS = 2;

/** Initialize the FlinkSQL language client and connect to the language server websocket
 * @returns A promise that resolves to the language client, or null if initialization failed
 * Prerequisites:
 * - User is authenticated with CCloud
 * - User has selected a compute pool
 */
export async function initializeLanguageClient(url: string): Promise<LanguageClient | null> {
  // Reset reconnect counter on new initialization
  reconnectCounter = 0;

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
    const ws = new WebSocket(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    ws.onerror = (error) => {
      logger.error(`WebSocket connection error: ${error}`);
      reject(new Error("Failed to connect to Flink SQL language server"));
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
            { scheme: "file", language: "flinksql" },
            { scheme: "untitled", language: "flinksql" },
          ],
          middleware: {
            didOpen: (document, next) => {
              logger.info(`FlinkSQL document opened: ${document.uri}`);
              return next(document);
            },
            didChange: (event, next) => {
              // Clear diagnostics when document changes, so user sees only latest issues
              const diagnostics = languageClient?.diagnostics;
              if (diagnostics) {
                diagnostics.delete(event.document.uri);
              }
              return next(event);
            },
            provideCompletionItem: (document, position, context, token, next) => {
              // Server adds backticks to all Entity completions, but this isn't expected by LSP
              // so if the character before the word range is a backtick, adjust the position
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
              logger.warn("Language server connection closed by the client's error handler");
              handleWebSocketDisconnect(url);
              return {
                action: CloseAction.Restart,
                handled: true,
              };
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

/**
 * Try to reconnect to the language server
 * @param url The WebSocket URL to reconnect to
 */
async function handleWebSocketDisconnect(url: string): Promise<void> {
  // Skip reconnection attempts if we're not authenticated
  if (!hasCCloudAuthSession()) {
    logger.warn("Not attempting reconnection: User not authenticated with CCloud");
    return;
  }

  // If we've reached max attempts, show a notification to the user
  if (reconnectCounter >= MAX_RECONNECT_ATTEMPTS) {
    logger.error(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts`);
    return;
  }

  reconnectCounter++;
  restartLanguageClient(url);
}

/**
 * Restarts the language client
 * @param url The WebSocket URL to connect to
 */
async function restartLanguageClient(url: string): Promise<void> {
  // Dispose of the existing client if it exists
  //  && languageClient.state === 2 // Maybe & is running state to prevent error
  if (languageClient) {
    logger.info("Disposing existing language client");
    try {
      await languageClient.dispose();
      // Make sure the client is nullified even if there's an error
      languageClient = null;
    } catch (e) {
      logger.error(`Error stopping language client: ${e}`);
      // Still set to null to avoid keeping references to a potentially broken client
      languageClient = null;
    }
  }

  // Try to initialize a new client
  try {
    logger.info("Attempting to initialize new language client");
    await initializeLanguageClient(url);
    // Reset counter on successful reconnection
    reconnectCounter = 0;
  } catch (e) {
    logger.error(`Failed to reconnect: ${e}`);
    // The next reconnection attempt will happen through handleWebSocketDisconnect
    handleWebSocketDisconnect(url);
  }
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
 * Checks if the language client is currently connected and healthy
 * @returns True if the client is connected, false otherwise
 */
export function isLanguageClientConnected(): boolean {
  return languageClient !== null && languageClient.needsStart() === false;
}
