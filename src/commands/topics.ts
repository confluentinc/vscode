import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { KafkaCluster } from "../models/kafkaCluster";
import { getTopicViewProvider } from "../viewProviders/topics";
import { WebviewPanelCache } from "../webview-cache";
import { KafkaTopic } from "../models/topic";
import topicFormTemplate from "../webview/topic-config-form.html";
import { getSidecar } from "../sidecar";
import { handleWebviewMessage } from "../webview/comms/comms";
import { post } from "../webview/topic-config-form";
import { ResponseError, type UpdateKafkaTopicConfigBatchRequest } from "../clients/kafkaRest";

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
    // FIXME better errors
    console.error("Failed to retrieve topic configs list", err);
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
  let formError: string | null = null;
  let submitSuccess: boolean = false;
  async function validateOrUpdateConfig(
    topic: KafkaTopic,
    data: { [key: string]: unknown },
    validateOnly: boolean = true,
  ) {
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
      // if (!validateOnly) submitSuccess = true;
      formError = "hello there was a problem";
      console.log("formErrors", formError);
    } catch (err) {
      if (err instanceof ResponseError) {
        const errorBody: { message: string } = await err.response.json();
        console.error("MAde it ERROR = ", typeof err, errorBody.message);
        formError = errorBody.message;
        console.log("formError", formError);
      }
      submitSuccess = false;
    }
  }

  // Message processing to communicate with the webview
  const processMessage = (...[type, body]: Parameters<MessageSender>) => {
    switch (type) {
      case "GetSubmitSuccess":
        return submitSuccess satisfies MessageResponse<"GetSubmitSuccess">;
      case "GetConfig": {
        const config = topicConfigRemoteItems;
        console.log("GetConfig", config);
        return config satisfies MessageResponse<"GetConfig">;
      }
      case "GetCleanupPolicy": {
        console.log(
          "GetCleanupPolicy",
          topicConfigRemoteItems.data.find((item) => item.name === "cleanup.policy")?.value,
        );
        return (topicConfigRemoteItems.data.find((item) => item.name === "cleanup.policy")?.value ??
          "delete") satisfies MessageResponse<"GetCleanupPolicy">;
      }
      case "GetRetentionSize": {
        console.log(
          "GetRetentionSize",
          topicConfigRemoteItems.data.find((item) => item.name === "retention.bytes")?.value,
        );
        return (topicConfigRemoteItems.data.find((item) => item.name === "retention.bytes")
          ?.value ?? "-1") satisfies MessageResponse<"GetRetentionSize">;
      }
      case "GetRetentionMs": {
        console.log(
          "GetRetentionMs",
          topicConfigRemoteItems.data.find((item) => item.name === "retention.ms")?.value,
        );
        return (topicConfigRemoteItems.data.find((item) => item.name === "retention.ms")?.value ??
          "-1") satisfies MessageResponse<"GetRetentionMs">;
      }
      case "GetMaxMessageBytes": {
        console.log(
          "GetMaxMessageBytes",
          topicConfigRemoteItems.data.find((item) => item.name === "max.message.bytes")?.value,
        );
        return (topicConfigRemoteItems.data.find((item) => item.name === "max.message.bytes")
          ?.value ?? "1000") satisfies MessageResponse<"GetMaxMessageBytes">;
      }
      case "ValidateConfigValue": {
        console.log("ValidateConfigValue", body);
        validateOrUpdateConfig(topic, body);
        return null satisfies MessageResponse<"ValidateConfigValue">;
      }
      case "GetFormError":
        console.log("GetFormError", body);
        return formError satisfies MessageResponse<"GetFormError">;
      case "Submit":
        console.log("Submit", body);
        validateOrUpdateConfig(topic, body.data, body.validateOnly);
        return null satisfies MessageResponse<"Submit">;
    }
  };
  const disposable = handleWebviewMessage(editConfigForm.webview, processMessage);
  editConfigForm.onDidDispose(() => disposable.dispose());
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
  ];
}
