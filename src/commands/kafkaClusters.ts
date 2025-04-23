import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { fetchTopicAuthorizedOperations } from "../authz/topics";
import { ResponseError, TopicV3Api } from "../clients/kafkaRest";
import { currentKafkaClusterChanged } from "../emitters";
import { Logger } from "../logging";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { isCCloud, isLocal } from "../models/resource";
import { KafkaTopic } from "../models/topic";
import {
  kafkaClusterQuickPick,
  kafkaClusterQuickPickWithViewProgress,
} from "../quickpicks/kafkaClusters";
import { getSidecar } from "../sidecar";
import { removeProtocolPrefix } from "../utils/bootstrapServers";
import { getTopicViewProvider } from "../viewProviders/topics";

const logger = new Logger("commands.kafkaClusters");

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function renameKafkaClusterCommand(item?: CCloudKafkaCluster | undefined) {
  // TODO: implement this once the sidecar supports mutations via GraphQL
}

async function selectKafkaClusterCommand(cluster?: KafkaCluster) {
  // ensure whatever was passed in is some form of KafkaCluster; if not, prompt the user to pick one
  const kafkaCluster: KafkaCluster | undefined =
    cluster instanceof KafkaCluster ? cluster : await kafkaClusterQuickPickWithViewProgress();
  if (!kafkaCluster) {
    return;
  }

  // only called when clicking a Kafka cluster in the Resources view; not a dedicated view
  // action or command palette option
  currentKafkaClusterChanged.fire(kafkaCluster);
  vscode.commands.executeCommand("confluent-topics.focus");
}

async function deleteTopicCommand(topic: KafkaTopic) {
  if (!(topic instanceof KafkaTopic)) {
    return;
  }
  // We won't have even gotten here if we didn't think the user has DELETE permissions on the topic.
  // BUT that was at the time we fetched the topic list, so we should check again before proceeding.
  const authorizedOperations = await fetchTopicAuthorizedOperations(topic);
  if (!authorizedOperations.includes("DELETE")) {
    const errorMessage = `You do not have permission to delete the topic "${topic.name}"`;
    logger.error(errorMessage);
    vscode.window.showErrorMessage(errorMessage);
    return;
  }

  logger.info(`Deleting topic "${topic.name}" from cluster ${topic.clusterId}...`);
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

  const client: TopicV3Api = (await getSidecar()).getTopicV3Api(
    topic.clusterId,
    topic.connectionId,
  );

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Deleting topic "${topic.name}"...`,
    },
    async (progress) => {
      try {
        await client.deleteKafkaTopic({
          cluster_id: topic.clusterId,
          topic_name: topic.name,
        });
        // indicate progress done 33 % now.
        progress.report({ increment: 33 });

        await waitForTopicToBeDeleted(client, topic.clusterId, topic.name, isLocal(topic));
        // Another 1/3 way done now.
        progress.report({ increment: 33 });

        // explicitly deep refresh the topics view after deleting a topic, so that repainting
        // ommitting the newly deleted topic is a foreground task we block on before
        // closing the progress window.
        getTopicViewProvider().refresh(true, topic.clusterId);
      } catch (error) {
        const errorMessage = `Failed to delete topic: ${error}`;
        logger.error(errorMessage);
        vscode.window.showErrorMessage(errorMessage);
      }
    },
  );
}

async function createTopicCommand(item?: KafkaCluster) {
  const topicsViewCluster = getTopicViewProvider().kafkaCluster;

  let cluster: KafkaCluster | undefined;
  // we'll need to know which Kafka cluster to create the topic in, which happens one of three ways:
  if (item instanceof KafkaCluster) {
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

  // TODO: add RBAC check here once we can get the user's permissions for the cluster

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
  const defaultReplicationFactor = isCCloud(cluster) ? "3" : "1";
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

        await waitForTopicToExist(client, cluster.id, topicName, isLocal(cluster));
        progress.report({ increment: 33 });

        // Refresh in the foreground after creating a topic, so that the new topic is visible
        // immediately after the progress window closes (assuming topics view is showing this cluster).

        getTopicViewProvider().refresh(true, cluster.id);
      } catch (error) {
        if (!(error instanceof ResponseError)) {
          // generic error handling
          const errorMessage = `Error creating topic in "${cluster.name}": ${error}`;
          logger.error(errorMessage);
          vscode.window.showErrorMessage(errorMessage);
          return;
        }

        // try to parse the error response to provide a more specific error message to the user,
        // whether it was a 403/permissions error, some flavor of network error, or something else
        try {
          const body = await error.response.json();
          logger.error("error response while trying to create cluster:", body);
          // {"error_code":40301,"message":"Authorization failed."}
          if (body.error_code === 40301) {
            vscode.window.showErrorMessage(
              `You do not have permission to create topics in "${cluster.name}".`,
            );
          } else {
            vscode.window.showErrorMessage(
              `Error creating topic in "${cluster.name}": ${JSON.stringify(body)}`,
            );
          }
        } catch (parseError) {
          logger.error("error parsing response from createKafkaTopic():", { error, parseError });
        }
      }
    },
  );
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

export async function copyBootstrapServers(item: KafkaCluster) {
  const bootstrapServers = item.bootstrapServers;
  if (!bootstrapServers) {
    return;
  }

  // Strip away any protocol:// prefix from each comma separated bootstrap server
  const stripped = removeProtocolPrefix(bootstrapServers);

  await vscode.env.clipboard.writeText(stripped);
  vscode.window.showInformationMessage(`Copied "${stripped}" to clipboard.`);
}

export function registerKafkaClusterCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.kafka-clusters.item.rename", renameKafkaClusterCommand),
    registerCommandWithLogging(
      "confluent.resources.kafka-cluster.select",
      selectKafkaClusterCommand,
    ),
    registerCommandWithLogging("confluent.topics.create", createTopicCommand),
    registerCommandWithLogging("confluent.topics.delete", deleteTopicCommand),
    registerCommandWithLogging(
      "confluent.resources.kafka-cluster.copyBootstrapServers",
      copyBootstrapServers,
    ),
  ];
}
