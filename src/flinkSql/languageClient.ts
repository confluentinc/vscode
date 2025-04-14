import * as vscode from "vscode";
import { LanguageClient, LanguageClientOptions, Trace } from "vscode-languageclient/node";
import { WebSocket } from "ws";
import { Logger } from "../logging";
import { WebsocketTransport } from "../sidecar/websocketTransport";
import { CCLOUD_CONNECTION_ID } from "../constants";

const logger = new Logger("flinkSql.languageClient");

export async function initializeLanguageClient(): Promise<vscode.Disposable> {
  const addr = `ws://127.0.0.1:26636/flsp?connectionId=${CCLOUD_CONNECTION_ID}&region=us-east1&provider=gcp&environmentId=env-x7727g&organizationId=f551c50b-0397-4f31-802d-d5371a49d3bf`;

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
            { scheme: "file", language: "plaintext" },
            { scheme: "file", language: "flinksql" },
          ],
          outputChannelName: "FlinkSQL Language Server",
        };

        const client = new LanguageClient(
          "flinksqlLanguageServer",
          "FlinkSQL Language Server",
          serverOptions,
          clientOptions,
        );

        client.setTrace(Trace.Verbose);
        await client.start();
        logger.info("FlinkSQL Language Server started");
        resolve(client);
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
