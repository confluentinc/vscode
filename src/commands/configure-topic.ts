import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { Uri } from "vscode";
import { ResponseError, UpdateKafkaTopicConfigBatchRequest } from "../clients/kafkaRest";
import { Logger } from "../logging";
import { KafkaTopic } from "../models/topic";
import { getSidecar } from "../sidecar";
import { getResourceManager } from "../storage/resourceManager";
import { WebviewPanelCache } from "../webview-cache";
import topicConfigTemplate from "../webview/topic-config.html";

const logger = new Logger("configure-topic");
const configTopicPanelCache = new WebviewPanelCache();

export async function configureTopicCommand(topic: KafkaTopic, context: vscode.ExtensionContext) {
  const cluster = await getResourceManager().getClusterForTopic(topic);
  if (!cluster) {
    logger.error(`Failed to find cluster for topic "${topic.name}"`);
    vscode.window.showErrorMessage(`Failed to find cluster for topic "${topic.name}"`);
    return;
  }
  logger.info(`Configuring topic "${topic.name}" in cluster "${cluster.name}"...`);

  const panel_id = topic.uniqueId;

  const [panel, wasExisting] = configTopicPanelCache.findOrCreate(
    panel_id,
    "topic-config",
    `Configure Topic ${topic.name}`,
    vscode.ViewColumn.One,
    { enableScripts: true },
  );
  if (wasExisting) {
    // Panel exists already, show it and bail.
    panel.reveal();
    return;
  }

  // Fetch the topic's current configuration
  const configClient = (await getSidecar()).getConfigsV3Api(cluster.id, cluster.connectionId);
  const topicConfig = await configClient.listKafkaTopicConfigs({
    cluster_id: cluster.id,
    topic_name: topic.name,
  });

  logger.info(`Fetched topic configuration for "${topic.name}" in cluster "${cluster.name}.`);

  // collect all non-read-only config name + value pairs into a map
  const topicConfigMap: Record<string, string> = topicConfig.data
    .filter((config) => !config.is_read_only)
    .reduce((acc: Record<string, string>, config) => {
      acc[config.name] = config.value!;
      return acc;
    }, {});

  logger.info(
    `Configurable topic configuration for "${topic.name}": ${JSON.stringify(topicConfigMap)}`,
  );

  const staticRoot = Uri.joinPath(context.extensionUri, "webview");
  const webview = panel.webview;

  // Set the webview's HTML content with the expansion of the templated HTML ...
  // (gulp creates this function from the HTML file)
  webview.html = topicConfigTemplate({
    cspSource: webview.cspSource,
    nonce: randomBytes(16).toString("base64"),
    webviewUri: webview.asWebviewUri(Uri.joinPath(staticRoot, "main.js")),
    topicConfigUri: webview.asWebviewUri(Uri.joinPath(staticRoot, "topic-config.js")),
  });

  // Wire up event listeners to handle messages from the webview.
  webview.onDidReceiveMessage(async (event) => {
    const [id, message] = event;
    switch (message.type) {
      case "GetTopic": {
        // Webview has requested the main bits about the topic, namely the name.
        webview.postMessage([id, "Success", topic]);
        break;
      }

      case "GetInitialConfig": {
        // Webview has requested the topic's initial/current configuration
        webview.postMessage([id, "Success", topicConfigMap]);
        break;
      }

      case "UpdateTopic": {
        logger.info(`Posted form results from webview: ${JSON.stringify(message)}`);

        // Update the topic configuration with the new values.
        const configClient = (await getSidecar()).getConfigsV3Api(cluster.id, cluster.connectionId);
        try {
          await configClient.updateKafkaTopicConfigBatch({
            cluster_id: cluster.id,
            topic_name: topic.name,
            AlterConfigBatchRequestData: message,
          } as UpdateKafkaTopicConfigBatchRequest);

          logger.info("Successfully updated topic configuration!");
          webview.postMessage([id, "Success", "Topic configuration updated successfully."]);
          // webview.html = "<h1>Topic reset</h1>";
        } catch (error) {
          logger.error(`Failed to update topic configuration: ${error}`, { error });
          if (error instanceof ResponseError) {
            logger.error("Is indeed a ResponseError");
            const errorBody: { message: string } = await error.response.json();
            webview.postMessage([id, "Failure", errorBody.message]);
          }
        }
      }
    }
  });
}
