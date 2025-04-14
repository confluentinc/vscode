import * as vscode from "vscode";
import { LanguageClient, LanguageClientOptions, Trace } from "vscode-languageclient/node";
import { WebSocket } from "ws";
import { Logger } from "../logging";
import { WebsocketTransport } from "../sidecar/websocketTransport";
import { CCLOUD_CONNECTION_ID } from "../constants";

const logger = new Logger("flinkSql.languageClient");

let languageClient: LanguageClient | null = null;

/**
 * Builds the WebSocket URL for the Flink SQL Language Server based on current settings
 */
export function buildFlinkSqlWebSocketUrl(): string {
  const settings = { region: "us-east1", provider: "gcp" }; // TODO: Get these from user-specified settings
  const environmentId = "env-x7727g"; // TODO: Get this from active environment
  const organizationId = "f551c50b-0397-4f31-802d-d5371a49d3bf"; // TODO: Get from active org
  // PREV: const addr = `ws://127.0.0.1:26636/flsp?connectionId=${CCLOUD_CONNECTION_ID}&region=us-east1&provider=gcp&environmentId=env-x7727g&organizationId=f551c50b-0397-4f31-802d-d5371a49d3bf`;
  return `ws://127.0.0.1:26636/flsp?connectionId=${CCLOUD_CONNECTION_ID}&region=${settings.region}&provider=${settings.provider}&environmentId=${environmentId}&organizationId=${organizationId}`;
}
export async function initializeLanguageClient(): Promise<vscode.Disposable> {
  if (languageClient) {
    logger.info("Language client already initialized");
    return languageClient;
  }
  const addr = buildFlinkSqlWebSocketUrl();
  return new Promise((resolve, reject) => {
    const conn = new WebSocket(addr);

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
            { scheme: "untitled", language: "flinksql" },
          ],
          synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher("**/*.flinksql"),
          },
          outputChannel: vscode.window.createOutputChannel("Confluent FlinkSQL Language Server"),
        };

        languageClient = new LanguageClient(
          "flinksqlLanguageServer",
          "FlinkSQL Language Server",
          serverOptions,
          clientOptions,
        );

        languageClient.setTrace(Trace.Verbose);
        await languageClient.start();
        logger.info("FlinkSQL Language Server started");
        resolve(languageClient);
      } catch (e) {
        logger.error(`Error starting FlinkSQL language server: ${e}`);
        reject(e);
      }
    };

    conn.onerror = (error) => {
      logger.error(`FlinkSQL WebSocket connection error: ${error.message}`);
      reject(error);
    };
  });
}
