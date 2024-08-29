import { randomBytes } from "crypto";
import * as vscode from "vscode";
import { Uri } from "vscode";
import { registerCommandWithLogging } from ".";
import {
  ResponseError,
  TopicV3Api,
  UpdateKafkaTopicConfigBatchRequest,
} from "../clients/kafkaRest";
import { currentKafkaClusterChanged } from "../emitters";
import { Logger } from "../logging";
import { CCloudKafkaCluster, KafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import { KafkaTopic } from "../models/topic";
import { kafkaClusterQuickPick } from "../quickpicks/kafkaClusters";
import { getSidecar } from "../sidecar";
import { getResourceManager } from "../storage/resourceManager";
import { getTopicViewProvider } from "../viewProviders/topics";
import { WebviewPanelCache } from "../webview-cache";
import topicConfigTemplate from "../webview/topic-config.html";

const logger = new Logger("commands.kafkaClusters");

async function renameKafkaClusterCommand(item?: CCloudKafkaCluster | undefined) {
  // TEMPORARY: remove this info message and un-comment the lines below once the sidecar supports
  // mutations via GraphQL to update the KafkaCluster name
  vscode.window.showInformationMessage(
    "COMING SOON: Renaming Kafka clusters is not yet supported.",
  );
  return;

  // // If the command was triggered through the command palette, `item` will be undefined, so we
  // // need to prompt the user for the CCloud Kafka cluster.
  // const kafkaCluster: CCloudKafkaCluster | undefined =
  //   item instanceof CCloudKafkaCluster ? item : await kafkaClusterQuickPick(false, true);
  // if (!kafkaCluster) {
  //   return;
  // }

  // // LocalKafkaClusters aren't returned above, so we can safely assume it's a CCloudKafkaCluster
  // const cloudKafkaCluster = kafkaCluster as CCloudKafkaCluster;

  // const newName: string | undefined = await vscode.window.showInputBox({
  //   prompt: "Enter new name",
  //   ignoreFocusOut: true,
  //   placeHolder: cloudKafkaCluster.name,
  // });
  // if (!newName) {
  //   return;
  // }

  // await vscode.window.withProgress(
  //   {
  //     location: vscode.ProgressLocation.Notification,
  //     title: `Renaming Kafka cluster "${cloudKafkaCluster.name}" to "${newName}"...`,
  //   },
  //   async () => {
  //     // TODO: add sidecar support for renaming Kafka clusters
  //     vscode.commands.executeCommand("confluent.resources.refresh");
  //   },
  // );
}

async function selectKafkaClusterCommand(cluster?: KafkaCluster) {
  const kafkaCluster: KafkaCluster | undefined = cluster || (await kafkaClusterQuickPick());
  if (!kafkaCluster) {
    return;
  }

  // only called when clicking a Kafka cluster in the Resources view; not a dedicated view
  // action or command palette option
  currentKafkaClusterChanged.fire(kafkaCluster);
  vscode.commands.executeCommand("confluent-topics.focus");
}

async function createTopicCommand(item?: KafkaCluster) {
  const topicsViewCluster = getTopicViewProvider().kafkaCluster;

  let cluster: KafkaCluster | undefined;
  // we'll need to know which Kafka cluster to create the topic in, which happens one of three ways:
  if (item instanceof CCloudKafkaCluster || item instanceof LocalKafkaCluster) {
    // 1) the user right-clicked a Kafka cluster in the Resources view and we get the associated
    // Kafka cluster as the argument by default
    cluster = item;
  } else if (topicsViewCluster != null) {
    // 2) the user clicked a Kafka cluster to populate the Topics view, so we'll use that cluster
    cluster = topicsViewCluster;
  } else {
    // 3) the command wasn't triggered from a Kafka cluster in the resources view, and nothing is
    // set in the Topics view provider, so have the user pick which one they want
    cluster = await kafkaClusterQuickPick();
  }

  if (!cluster) {
    return;
  }

  // TODO: change all of these inputs to a webview (form), especially to support `config` input
  const title = `Create a new topic in "${cluster.name}"`;
  const topicName: string | undefined = await vscode.window.showInputBox({
    title: title,
    prompt: "New topic name",
    ignoreFocusOut: true,
  });
  if (!topicName) {
    return;
  }

  const partitionsCount: string | undefined = await vscode.window.showInputBox({
    title: title,
    prompt: "Enter partition count",
    ignoreFocusOut: true,
    value: "1",
  });

  // CCloud Kafka clusters will return an error if replication factor is less than 3
  const defaultReplicationFactor = cluster.isLocal ? "1" : "3";
  const replicationFactor: string | undefined = await vscode.window.showInputBox({
    title: title,
    prompt: "Enter replication factor",
    ignoreFocusOut: true,
    value: defaultReplicationFactor,
  });

  const client: TopicV3Api = (await getSidecar()).getTopicV3Api(cluster.id, cluster.connectionId);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Creating topic "${topicName}"...`,
    },
    async (progress) => {
      try {
        await client.createKafkaTopic({
          cluster_id: cluster.id,
          CreateTopicRequestData: {
            topic_name: topicName,
            partitions_count: partitionsCount ? parseInt(partitionsCount, 10) : undefined,
            replication_factor: replicationFactor ? parseInt(replicationFactor, 10) : undefined,
            // TODO: add support for `configs` & `validate_only`?
          },
        });
        progress.report({ increment: 33 });

        await waitForTopicToExist(client, cluster.id, topicName, cluster.isLocal);
        progress.report({ increment: 33 });

        // Refresh in the foreground after creating a topic, so that the new topic is visible
        // immediately after the progress window closes.

        getTopicViewProvider().refresh();
      } catch (error) {
        const errorMessage = `Failed to create topic: ${error}`;
        logger.error(errorMessage);
        vscode.window.showErrorMessage(errorMessage);
        return;
      }
    },
  );
}

async function deleteTopicCommand(topic: KafkaTopic) {
  const cluster = await getResourceManager().getClusterForTopic(topic);
  if (!cluster) {
    logger.error(`Failed to find cluster for topic "${topic.name}"`);
    vscode.window.showErrorMessage(`Failed to find cluster for topic "${topic.name}"`);
    return;
  }
  logger.info(`Deleting topic "${topic.name}" from cluster ${cluster.name}...`);

  const confirmMessage = `Are you sure you want to delete the topic "${topic.name}"?`;

  const topicName: string | undefined = await vscode.window.showInputBox({
    title: confirmMessage,
    prompt: "Enter the name of the topic to confirm",
    ignoreFocusOut: true,
  });
  if (!topicName) {
    return;
  }

  if (topicName !== topic.name) {
    const errorMessage = `Topic name "${topicName}" does not match "${topic.name}"`;
    logger.error(errorMessage);
    vscode.window.showErrorMessage(errorMessage);
    return;
  }

  const client: TopicV3Api = (await getSidecar()).getTopicV3Api(cluster.id, cluster.connectionId);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Deleting topic "${topic.name}"...`,
    },
    async (progress) => {
      try {
        await client.deleteKafkaTopic({
          cluster_id: cluster.id,
          topic_name: topic.name,
        });
        // indicate progress done 33 % now.
        progress.report({ increment: 33 });

        await waitForTopicToBeDeleted(client, cluster.id, topic.name, cluster.isLocal);
        // Another 1/3 way done now.
        progress.report({ increment: 33 });

        // explicitly refresh the topics view after deleting a topic, so that repainting
        // ommitting the newly deleted topic is a foreground task we block on before
        // closing the progress window.
        getTopicViewProvider().refresh();
      } catch (error) {
        const errorMessage = `Failed to delete topic: ${error}`;
        logger.error(errorMessage);
        vscode.window.showErrorMessage(errorMessage);
      }
    },
  );
}

/** Cache of open "configure topic" webviews */
const configTopicPanelCache = new WebviewPanelCache();

async function configureTopicCommand(topic: KafkaTopic, context: vscode.ExtensionContext) {
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

async function waitForTopicToExist(
  client: TopicV3Api,
  clusterId: string,
  topicName: string,
  isLocal: boolean,
  timeoutMs: number = 3000,
) {
  const startTime = Date.now();
  const topicKind = isLocal ? "local" : "CCloud";
  while (Date.now() - startTime < timeoutMs) {
    try {
      // will raise an error with a 404 status code if the topic doesn't exist
      await client.getKafkaTopic({
        cluster_id: clusterId,
        topic_name: topicName,
      });
      const elapsedMs = Date.now() - startTime;
      logger.info(`${topicKind} topic "${topicName}" was created in ${elapsedMs}ms`);
      return;
    } catch (error) {
      // is an expected 404 error, the topic creation hasn't completed yet.
      logger.warn(`${topicKind} topic "${topicName}" not available yet: ${error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${topicKind} topic "${topicName}" was not created within ${timeoutMs}ms`);
}

async function waitForTopicToBeDeleted(
  client: TopicV3Api,
  clusterId: string,
  topicName: string,
  isLocal: boolean,
  // It may be that deleting topics that had a lot of data takes longer than creating them, so
  // be generous with the default timeout
  timeoutMs: number = 10000,
) {
  const startTime = Date.now();
  const topicKind = isLocal ? "local" : "CCloud";
  while (Date.now() - startTime < timeoutMs) {
    try {
      // will raise an error with a 404 status code if the topic doesn't exist.
      await client.getKafkaTopic({
        cluster_id: clusterId,
        topic_name: topicName,
      });
      logger.warn(`${topicKind} topic "${topicName}" still exists`);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      // topic is no longer found, yay, deletion complete.
      const elapsedMs = Date.now() - startTime;
      logger.info(`${topicKind} topic "${topicName}" was deleted in ${elapsedMs}ms`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${topicKind} topic "${topicName}" was not deleted within ${timeoutMs}ms`);
}

async function copyBootstrapServers(item: KafkaCluster) {
  const bootstrapServers = item.bootstrapServers;
  if (!bootstrapServers) {
    return;
  }

  await vscode.env.clipboard.writeText(bootstrapServers);
  vscode.window.showInformationMessage(`Copied "${bootstrapServers}" to clipboard.`);
}

export const commands = [
  registerCommandWithLogging("confluent.kafka-clusters.item.rename", renameKafkaClusterCommand),
  registerCommandWithLogging("confluent.resources.kafka-cluster.select", selectKafkaClusterCommand),
  registerCommandWithLogging("confluent.topics.create", createTopicCommand),
  registerCommandWithLogging("confluent.topics.delete", deleteTopicCommand),
  registerCommandWithLogging("confluent.topics.configure", configureTopicCommand),
  registerCommandWithLogging(
    "confluent.resources.kafka-cluster.copyBootstrapServers",
    copyBootstrapServers,
  ),
];
