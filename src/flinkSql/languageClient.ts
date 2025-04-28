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
import { WebsocketTransport } from "./websocketTransport";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { getStorageManager } from "../storage";
import { SecretStorageKeys } from "../storage/constants";
import { SIDECAR_PORT } from "../sidecar/constants";
import { getResourceManager } from "../storage/resourceManager";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { getCurrentOrganization } from "../graphql/organizations";

const logger = new Logger("flinkSql.languageClient");

let languageClient: LanguageClient | null = null;
export interface FlinkSqlSettings {
  database: string;
  computePoolId: string;
}
export function getFlinkSqlSettings(): FlinkSqlSettings {
  const config = vscode.workspace.getConfiguration("confluent.flink");
  return {
    database: config.get<string>("database", ""),
    computePoolId: config.get<string>("computePoolId", ""),
  };
}

/**
 * Builds the WebSocket URL for the Flink SQL Language Server based on current settings
 * @param computePoolId - The ID of the compute pool used to determine URL query params
 * @returns The WebSocket URL for the Flink SQL Language Server
 * @throws Error if the environment or organization ID cannot be found
 * @throws Error if the compute pool ID is not found in any environment
 */
export async function buildFlinkSqlWebSocketUrl(computePoolId: string): Promise<string> {
  let organizationId = "";
  let environmentId = "";
  let region = "";
  let provider = "";
  // Get the current org
  const currentOrg = await getCurrentOrganization();
  organizationId = currentOrg?.id ?? "";
  // Find the environment containing this compute pool
  const resourceManager = getResourceManager();
  const environments = await resourceManager.getCCloudEnvironments();
  for (const env of environments) {
    const foundPool = env.flinkComputePools.find(
      (pool: CCloudFlinkComputePool) => pool.id === computePoolId,
    );
    if (foundPool) {
      environmentId = env.id;
      region = foundPool.region;
      provider = foundPool.provider;
      break;
    }
  }
  if (!environmentId || !organizationId) {
    throw new Error(`Could not find environment containing compute pool ${computePoolId}`);
  }
  return `ws://localhost:${SIDECAR_PORT}/flsp?connectionId=${CCLOUD_CONNECTION_ID}&region=${region}&provider=${provider}&environmentId=${environmentId}&organizationId=${organizationId}`;
}

/** Initialize the FlinkSQL language client and connect to the language server websocket
 * @returns A promise that resolves to the language client, or null if initialization failed
 * Prerequisites:
 * - User is authenticated with CCloud
 * - User has selected a compute pool
 */
export async function initializeLanguageClient(): Promise<vscode.Disposable | null> {
  if (!hasCCloudAuthSession()) {
    logger.warn("Cannot initialize language client: User not authenticated with CCloud");
    return null;
  }

  if (languageClient) {
    logger.info("Language client already initialized");
    return languageClient;
  }

  const settings = getFlinkSqlSettings();
  if (!settings.computePoolId) {
    logger.warn("Cannot initialize language client: No compute pool configured");
    return null;
  }

  let addr: string;
  try {
    addr = await buildFlinkSqlWebSocketUrl(settings.computePoolId);
  } catch (error) {
    logger.error("Failed to build WebSocket URL:", error);
    vscode.window.showErrorMessage(
      `Failed to initialize Flink SQL language client: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
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
    const conn = new WebSocket(addr, {
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
              // TODO NC send config when document opens. Must handle empty values to avoid closing connection. (See UI)
              // Maybe in flinkConfigManager.ts?
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
              // Server adds backticks to all Entities, so we need to see
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
              if (type === "textDocument/completion") {
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

// TODO NC Maybe move to flinkConfigManager.ts
// export async function registerFlinkSqlConfigListener(): Promise<vscode.Disposable> {
//   // The CCloud UI defaults to the currently selected catalog and database from the dropdown
//   // & waits until all settings are updated, instead of sending intermittent updates (i.e. catalog changes, then db)
//   return vscode.workspace.onDidChangeConfiguration(async (event) => {
//     if (event.affectsConfiguration("confluent.flink")) {
//       logger.info("Flink SQL configuration changed");
//       try {
//         const settings = getFlinkSqlSettings();
//         languageClient?.sendNotification("workspace/didChangeConfiguration", {
//           settings: {
//             workspaceSettings: {
//               AuthToken: "{{ ccloud.data_plane_token }}",
//               Catalog: settings.catalog,
//               Database: settings.database,
//               ComputePoolId: settings.computePoolId,
//             },
//           },
//         });
//       } catch (error) {
//         logger.error(`Failed to send configuration update to language server: ${error}`);
//       }

//       /** We need special handling for region/provider/env/org changes, which affect the WebSocket URL
//        * These would require a full client/socket restart
//        * */
//       // if (
//       //   event.affectsConfiguration("confluent.flink.region") ||
//       //   event.affectsConfiguration("confluent.flink.provider")
//       // ) {
//       //   logger.info("Region or provider changed - restarting language client");
//       //   try {
//       //     await startOrRestartLanguageClient(context, CCLOUD_CONNECTION_ID);
//       //   } catch (error) {
//       //     logger.error(`Failed to restart Flink SQL language client: ${error}`);
//       //   }
//       // } else {
//       //   // For any other settings, just send log or notification, e.g.
//       //   updateLanguageServerSettings();
//       // }
//     }
//   });
// }

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
