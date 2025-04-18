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
import { WebsocketTransport } from "../sidecar/websocketTransport";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { getStorageManager } from "../storage";
import { SecretStorageKeys } from "../storage/constants";
import { SIDECAR_PORT } from "../sidecar/constants";

const logger = new Logger("flinkSql.languageClient");

let languageClient: LanguageClient | null = null;
export interface FlinkSqlSettings {
  catalog: string;
  database: string;
  computePoolId: string;
  region: string;
  provider: string;
}
export function getFlinkSqlSettings(): FlinkSqlSettings {
  // POC: Settings stored in VSCode, which can be edited with JSON or UI handler "confluent.flink.configureLanguageServer"
  const config = vscode.workspace.getConfiguration("confluent.flink");
  return {
    catalog: config.get<string>("catalog", ""),
    database: config.get<string>("database", ""),
    computePoolId: config.get<string>("computePoolId", ""),
    region: config.get<string>("region", "us-east1"),
    provider: config.get<string>("provider", "gcp"),
  };
}

/**
 * Builds the WebSocket URL for the Flink SQL Language Server based on current settings
 */
export function buildFlinkSqlWebSocketUrl(): string {
  // In final implementation, could listen to onDidChangeConfiguration, currentFlinkStatementsResourceChanged,
  // and/or could infer defaults from auth, env, catalog selection
  // const settings = getFlinkSqlSettings();
  // POC: Hard-coded settings.
  const environmentId = "env-x7727g"; // DTX a-main-test? TODO:  Get this from active environment
  const organizationId = "f551c50b-0397-4f31-802d-d5371a49d3bf"; // DTX Org TODO: Get from active org
  const settings = { region: "us-east1", provider: "gcp", environmentId, organizationId }; // TODO: Get these from user-specified settings
  return `ws://localhost:${SIDECAR_PORT}/flsp?connectionId=${CCLOUD_CONNECTION_ID}&region=${settings.region}&provider=${settings.provider}&environmentId=${environmentId}&organizationId=${organizationId}`;
}
export async function initializeLanguageClient(): Promise<vscode.Disposable> {
  if (languageClient) {
    logger.info("Language client already initialized");
    return languageClient;
  }
  const addr = buildFlinkSqlWebSocketUrl();
  let accessToken: string | undefined = await getStorageManager().getSecret(
    SecretStorageKeys.SIDECAR_AUTH_TOKEN,
  );
  if (!accessToken) {
    logger.error("No access token found");
    throw new Error("No access token found");
  }
  return new Promise((resolve, reject) => {
    const conn = new WebSocket(addr, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
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
            { scheme: "untitled", language: "flinksql" }, // POC: We may want to use a different file extension
          ],
          middleware: {
            didOpen: (document, next) => {
              logger.debug(`Document opened: ${document.uri}`);
              // TODO send config when document opens. Must handle empty values to avoid closing connection. (See UI)
              // const settings = getFlinkSqlSettings();
              languageClient?.sendNotification("workspace/didChangeConfiguration", {
                settings: {
                  AuthToken: "{{ ccloud.data_plane_token }}",
                  Catalog: "Flinkfodder",
                  Database: "Realworld Data",
                  ComputePoolId: "lfcp-rz2p09",
                },
              });
              return next(document);
            },
            didChange: (event, next) => {
              logger.debug(`Document changed: ${event.document.uri}`);
              // TODO clear diagnostics when document is changed? Needs investigation
              return next(event);
            },
            provideCompletionItem: (document, position, context, token, next) => {
              // TODO we need to manually handle some quirks in multiple lines, backticks, completion position, etc. (see UI)
              logger.debug(`Providing completion item for: ${document.uri} at ${position}`);
              return next(document, position, context, token);
            },
            sendRequest: (type, params, token, next) => {
              // logger.debug(`Sending request: ${type}`, params);
              if (type === "textDocument/completion") {
                logger.debug(`Requesting completion items with params: ${params}`);
                // TODO we need to manually handle some quirks in multiple lines, backticks, completion position, etc. (see UI)
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

export function registerFlinkSqlConfigListener(): vscode.Disposable {
  // POC: This is one option for updating the server when settings change.
  // The CCloud UI defaults to the currently selected catalog and database from the dropdown
  // & waits until all settings are updated, instead of sending intermittent updates (i.e. catalog changes, then db)
  return vscode.workspace.onDidChangeConfiguration(async (event) => {
    if (event.affectsConfiguration("confluent.flink")) {
      logger.info("Flink SQL configuration changed");
      try {
        const settings = getFlinkSqlSettings();
        languageClient?.sendNotification("workspace/didChangeConfiguration", {
          settings: {
            workspaceSettings: {
              AuthToken: "{{ ccloud.data_plane_token }}",
              Catalog: settings.catalog,
              Database: settings.database,
              ComputePoolId: settings.computePoolId,
            },
          },
        });
        logger.info(
          "Sent workspace/didChangeConfiguration notification with updated settings",
          settings,
        );
      } catch (error) {
        logger.error(`Failed to send configuration update to language server: ${error}`);
      }

      /** We need special handling for region/provider/env/org changes, which affect the WebSocket URL
       * These would require a full client/socket restart
       * */
      // if (
      //   event.affectsConfiguration("confluent.flink.region") ||
      //   event.affectsConfiguration("confluent.flink.provider")
      // ) {
      //   logger.info("Region or provider changed - restarting language client");
      //   try {
      //     await startOrRestartLanguageClient(context, CCLOUD_CONNECTION_ID);
      //   } catch (error) {
      //     logger.error(`Failed to restart Flink SQL language client: ${error}`);
      //   }
      // } else {
      //   // For any other settings, just send log or notification, e.g.
      //   updateLanguageServerSettings();
      // }
    }
  });
}
