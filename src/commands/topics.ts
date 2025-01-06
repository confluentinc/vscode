import * as Sentry from "@sentry/node";
import * as fs from "fs";
import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import {
  ProduceRecordRequest,
  ProduceRequest,
  ProduceRequestData,
  ProduceRequestHeader,
  ProduceResponse,
  ResponseError,
  type UpdateKafkaTopicConfigBatchRequest,
} from "../clients/kafkaRest";
import { MessageViewerConfig } from "../consume";
import { logResponseError } from "../errors";
import { Logger } from "../logging";
import { KafkaCluster } from "../models/kafkaCluster";
import { KafkaTopic } from "../models/topic";
import { getSidecar } from "../sidecar";
import { getTopicViewProvider } from "../viewProviders/topics";
import { WebviewPanelCache } from "../webview-cache";
import { handleWebviewMessage } from "../webview/comms/comms";
import { post } from "../webview/topic-config-form";
import topicFormTemplate from "../webview/topic-config-form.html";

const logger = new Logger("topics");

/** Copy the Kafka Cluster ID from the Topics tree provider nav action. */
async function copyKafkaClusterId() {
  const cluster: KafkaCluster | null = getTopicViewProvider().kafkaCluster;
  if (!cluster) {
    return;
  }
  await vscode.env.clipboard.writeText(cluster.id);
  vscode.window.showInformationMessage(`Copied "${cluster.id}" to clipboard.`);
}

/** Copy the Kafka Cluster name from the Topics tree provider nav action. */
async function copyKafkaClusterName() {
  const cluster: KafkaCluster | null = getTopicViewProvider().kafkaCluster;
  if (!cluster) {
    return;
  }
  await vscode.env.clipboard.writeText(cluster.name);
  vscode.window.showInformationMessage(`Copied "${cluster.name}" to clipboard.`);
}

/** Copy the Kafka Cluster bootstrap servers from the Topics tree provider nav action. */
async function copyKafkaClusterBootstrapUrl() {
  const cluster: KafkaCluster | null = getTopicViewProvider().kafkaCluster;
  if (!cluster) {
    return;
  }
  await vscode.env.clipboard.writeText(cluster.bootstrapServers);
  vscode.window.showInformationMessage(`Copied "${cluster.bootstrapServers}" to clipboard.`);
}

type MessageSender = OverloadUnion<typeof post>;
type MessageResponse<MessageType extends string> = Awaited<
  ReturnType<Extract<MessageSender, (type: MessageType, body: any) => any>>
>;
const topicWebviewCache = new WebviewPanelCache();
/** Launches & controls the webview form for updating topic configuration
 * @param topic The topic to edit, from the topic tree item where the "confluent.topics.edit" command was invoked
 */
async function editTopicConfig(topic: KafkaTopic): Promise<void> {
  // Retrieve the current topic configuration data
  let topicConfigRemoteItems = null;
  try {
    const client = (await getSidecar()).getConfigsV3Api(topic.clusterId, topic.connectionId);
    topicConfigRemoteItems = await client.listKafkaTopicConfigs({
      cluster_id: topic.clusterId,
      topic_name: topic.name,
    });
  } catch (err) {
    logger.error("Failed to retrieve topic configs list", err);
    Sentry.captureException(err);
    vscode.window.showErrorMessage("Failed to retrieve topic configs");
    return;
  }

  // Set up the webview, checking for existing form for this topic
  const [editConfigForm, formExists] = topicWebviewCache.findOrCreate(
    { id: topic.name, multiple: false, template: topicFormTemplate },
    "topic-config-form",
    `Configure ${topic.name}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
    },
  );
  if (formExists) {
    editConfigForm.reveal();
    return;
  }

  // Form validation and submission logic
  async function validateOrUpdateConfig(
    topic: KafkaTopic,
    data: { [key: string]: unknown },
    validateOnly: boolean = true,
  ): Promise<{ success: boolean; message: string | null }> {
    const client = (await getSidecar()).getConfigsV3Api(topic.clusterId, topic.connectionId);
    const configArray = Object.entries(data).map(([name, value]) => ({
      name,
      value,
      operation: "SET",
    }));
    try {
      await client.updateKafkaTopicConfigBatch({
        cluster_id: topic.clusterId,
        topic_name: topic.name,
        AlterConfigBatchRequestData: {
          data: configArray,
          validate_only: validateOnly,
        },
      } as UpdateKafkaTopicConfigBatchRequest);
      return { success: true, message: validateOnly ? null : "Success!" };
    } catch (err) {
      let formError = "An unknown error occurred";
      if (err instanceof ResponseError && err.response.status === 400) {
        const errorBody = await err.response.json();
        formError = errorBody.message;
      } else {
        logger.error("Failed to update topic config", err);
        Sentry.captureException(err);
        if (err instanceof Error && err.message) formError = err.message;
      }
      return { success: false, message: formError };
    }
  }

  // Message processing to communicate with the webview
  const processMessage = async (...[type, body]: Parameters<MessageSender>) => {
    switch (type) {
      case "GetTopicName": {
        return topic.name satisfies MessageResponse<"GetTopicName">;
      }
      case "GetCCloudLink": {
        return topic.ccloudUrl satisfies MessageResponse<"GetCCloudLink">;
      }
      case "GetCleanupPolicy": {
        // cc default: "delete"
        return (topicConfigRemoteItems.data.find((item) => item.name === "cleanup.policy")?.value ??
          "delete") satisfies MessageResponse<"GetCleanupPolicy">;
      }
      case "GetRetentionSize": {
        // cc default: -1
        return (topicConfigRemoteItems.data.find((item) => item.name === "retention.bytes")
          ?.value ?? "-1") satisfies MessageResponse<"GetRetentionSize">;
      }
      case "GetRetentionMs": {
        // cc default: (7, 'days').asMilliseconds(),
        return (topicConfigRemoteItems.data.find((item) => item.name === "retention.ms")?.value ??
          "-1") satisfies MessageResponse<"GetRetentionMs">;
      }
      case "GetMaxMessageBytes": {
        // cc default: 1 * 1000
        return (topicConfigRemoteItems.data.find((item) => item.name === "max.message.bytes")
          ?.value ?? "1000") satisfies MessageResponse<"GetMaxMessageBytes">;
      }
      case "ValidateConfigValue": {
        return (await validateOrUpdateConfig(
          topic,
          body,
        )) satisfies MessageResponse<"ValidateConfigValue">;
      }
      case "Submit":
        return (await validateOrUpdateConfig(
          topic,
          body,
          false, // validateOnly
        )) satisfies MessageResponse<"Submit">;
    }
  };
  const disposable = handleWebviewMessage(editConfigForm.webview, processMessage);
  editConfigForm.onDidDispose(() => disposable.dispose());
}

async function produceMessageFromFile(topic: KafkaTopic) {
  if (!topic) {
    vscode.window.showErrorMessage("No topic selected.");
    return;
  }
  const options: vscode.OpenDialogOptions = {
    canSelectMany: false,
    openLabel: "Select JSON file",
    filters: {
      "JSON files": ["json"],
    },
  };

  const fileUri = await vscode.window.showOpenDialog(options);
  if (fileUri && fileUri[0]) {
    const filePath = fileUri[0].fsPath;
    const message = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    if (!message.key || !message.value || !Array.isArray(message.headers)) {
      vscode.window.showErrorMessage(`Message must have a key, value, and headers.`);
      return;
    }

    const sidecar = await getSidecar();
    const recordsApi = sidecar.getRecordsV3Api(topic.clusterId, topic.connectionId);

    // convert headers to the correct format, ensuring the value is base64-encoded
    const headers: ProduceRequestHeader[] = message.headers.map(
      (header: any): ProduceRequestHeader => ({
        name: header.key ? header.key : header.name,
        value: Buffer.from(header.value).toString("base64"),
      }),
    );

    // TODO: add schema information here once we have it
    const key: ProduceRequestData = { data: message.key };
    const value: ProduceRequestData = { data: message.value };

    const produceRequest: ProduceRequest = {
      headers,
      key,
      value,
    };
    const request: ProduceRecordRequest = {
      topic_name: topic.name,
      cluster_id: topic.clusterId,
      ProduceRequest: produceRequest,
    };

    try {
      const resp: ProduceResponse = await recordsApi.produceRecord(request);
      vscode.window
        .showInformationMessage(
          `Success: Produced message to topic "${topic.name}".`,
          "View in Topic Messages",
        )
        .then((selection) => {
          if (selection) {
            // open the message viewer to show a ~1sec window around the produced message
            const msgTime = resp.timestamp ? resp.timestamp.getTime() : Date.now() - 500;
            // ...with the message key used to search, and partition filtered if available
            const messageViewerConfig = MessageViewerConfig.create({
              // don't change the consume query params, just filter to show this last message
              timestampFilter: [msgTime, msgTime + 500],
              partitionFilter: resp.partition_id ? [resp.partition_id] : undefined,
              textFilter: String(message.key),
            });
            vscode.commands.executeCommand(
              "confluent.topic.consume",
              topic,
              true, // duplicate MV to show updated filters
              messageViewerConfig,
            );
          }
        });
    } catch (error: any) {
      logResponseError(error, "topic produce from file"); // not sending to Sentry by default
      if (error instanceof ResponseError) {
        const body = await error.response.clone().text();
        vscode.window.showErrorMessage(
          `Error response while trying to produce message: ${error.response.status} ${error.response.statusText}: ${body}`,
        );
      } else {
        vscode.window.showErrorMessage(`Failed to produce message: ${error.message}`);
      }
    }
  }
}

export function registerTopicCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.topics.copyKafkaClusterId", copyKafkaClusterId),
    registerCommandWithLogging("confluent.topics.copyKafkaClusterName", copyKafkaClusterName),
    registerCommandWithLogging(
      "confluent.topics.copyKafkaClusterBootstrapServers",
      copyKafkaClusterBootstrapUrl,
    ),
    registerCommandWithLogging("confluent.topics.edit", editTopicConfig),
    registerCommandWithLogging("confluent.topic.produce.fromFile", produceMessageFromFile),
  ];
}
