import * as Sentry from "@sentry/node";
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
import { MESSAGE_URI_SCHEME } from "../documentProviders/message";
import { logError, showErrorNotificationWithButtons } from "../errors";
import { Logger } from "../logging";
import { KafkaCluster } from "../models/kafkaCluster";
import { isCCloud, isDirect } from "../models/resource";
import { KafkaTopic } from "../models/topic";
import { loadDocumentContent, LoadedDocumentContent, uriQuickpick } from "../quickpicks/uris";
import { JSON_DIAGNOSTIC_COLLECTION } from "../schemas/diagnosticCollection";
import { PRODUCE_MESSAGE_SCHEMA } from "../schemas/produceMessageSchema";
import { validateDocument } from "../schemas/validateDocument";
import { getSidecar } from "../sidecar";
import { CustomConnectionSpec, getResourceManager } from "../storage/resourceManager";
import { executeInWorkerPool, isErrorResult, isSuccessResult } from "../utils/queue";
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

export async function produceMessagesFromDocument(topic: KafkaTopic) {
  if (!topic) {
    vscode.window.showErrorMessage("No topic selected.");
    return;
  }

  // prompt for the editor/file first via the URI quickpick, only allowing a subset of URI schemes
  const uriSchemes = ["file", "untitled", MESSAGE_URI_SCHEME];
  const languageIds = ["json"];
  const fileFilters = {
    "JSON files": ["json"],
  };
  const messageUri: vscode.Uri | undefined = await uriQuickpick(
    uriSchemes,
    languageIds,
    fileFilters,
  );
  if (!messageUri) {
    return;
  }

  const { content }: LoadedDocumentContent = await loadDocumentContent(messageUri);
  if (!content) {
    vscode.window.showErrorMessage("No content found in the selected file.");
    return;
  }

  // load the produce-message schema and validate the incoming document
  const docListeners: vscode.Disposable[] = await validateDocument(
    messageUri,
    PRODUCE_MESSAGE_SCHEMA,
  );
  const diagnostics: readonly vscode.Diagnostic[] =
    JSON_DIAGNOSTIC_COLLECTION.get(messageUri) ?? [];
  if (diagnostics.length) {
    showErrorNotificationWithButtons(
      "Unable to produce message(s): JSON schema validation failed.",
      {
        "Show Validation Errors": () => {
          vscode.commands.executeCommand("workbench.action.showErrorsWarnings");
        },
      },
    );
    return;
  }
  // document is valid, discard the listeners for that document
  docListeners.forEach((l) => l.dispose());

  // always treat producing as a "bulk" action, even if there's only one message
  const contents: any[] = [];
  const msgContent: any = JSON.parse(content);
  if (Array.isArray(msgContent)) {
    contents.push(...msgContent);
  } else {
    contents.push(msgContent);
  }

  // TODO: bump this number up?
  if (contents.length === 1) {
    await produceMessages(contents, topic);
  } else {
    // show progress notification for batch produce
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Producing ${contents.length} message${contents.length > 1 ? "s" : ""} to topic "${topic.name}"...`,
        cancellable: false,
      },
      async (
        progress: vscode.Progress<{
          message?: string;
          increment?: number;
        }>,
        token: vscode.CancellationToken,
      ) => {
        progress.report({ increment: 0 });
        await produceMessages(contents, topic, progress, token);
      },
    );
  }
}

async function produceMessages(
  contents: any[],
  topic: KafkaTopic,
  progress?: vscode.Progress<{
    message?: string;
    increment?: number;
  }>,
  token?: vscode.CancellationToken,
) {
  const results = await executeInWorkerPool(
    contents,
    (content) => produceMessage(content, topic),
    20, // max workers/requests
    true, // return errors
    progress,
    token,
  );

  const successResults = results.filter(isSuccessResult);
  const errorResults = results.filter(isErrorResult);

  const plural = contents.length > 1 ? "s" : "";
  logger.debug(
    `produced ${successResults.length}/${results.length} message${plural} produced to topic "${topic.name}"`,
  );
  const ofTotal = plural ? ` of ${results.length}` : "";

  if (successResults.length) {
    // set up a time window around the produced message(s) for message viewer
    const bufferMs = 500;
    const firstMessageTime = successResults[0].result!.timestamp.getTime() - bufferMs;
    const lastMessageTime =
      successResults[successResults.length - 1].result.timestamp.getTime() + bufferMs;
    // aggregate all unique partitions from the produce responses
    const uniquePartitions: Set<number> = new Set();
    successResults.forEach(({ result }) => {
      if (result.response?.partition_id) {
        uniquePartitions.add(result.response.partition_id);
      }
    });
    // if there was only one message, we can also filter by key (if it exists)
    let textFilter: string | undefined;
    if (successResults.length === 1 && contents[0].key) {
      textFilter = String(contents[0].key);
    }

    const buttonLabel = `View Message${plural}`;
    vscode.window
      .showInformationMessage(
        `Successfully produced ${successResults.length}${ofTotal} message${plural} to topic "${topic.name}".`,
        buttonLabel,
      )
      .then((selection) => {
        if (selection) {
          // open the message viewer to show a ~1sec window around the produced message(s)
          // ...with the message key and/or partition filtered if available
          const messageViewerConfig = MessageViewerConfig.create({
            // don't change the consume query params, just filter to show this last message
            timestampFilter: [firstMessageTime, lastMessageTime],
            partitionFilter: uniquePartitions.size === 1 ? Array.from(uniquePartitions) : undefined,
            textFilter,
          });
          vscode.commands.executeCommand(
            "confluent.topic.consume",
            topic,
            true, // duplicate MV to show updated filters
            messageViewerConfig,
          );
        }
      });
  }

  if (errorResults.length) {
    const errorMessages = errorResults.map((result) => result.error).join("\n");
    // this format isn't great if there are multiple errors, but it's better than nothing
    showErrorNotificationWithButtons(
      `Failed to produce ${errorResults.length}${ofTotal} message${plural} to topic "${topic.name}":\n${errorMessages}`,
    );
  }
}

interface ProduceResult {
  timestamp: Date;
  response: ProduceResponse | undefined;
  error: string | undefined;
}

/** Produce a single message to a Kafka topic. */
export async function produceMessage(content: any, topic: KafkaTopic): Promise<ProduceResult> {
  const sidecar = await getSidecar();
  const recordsApi = sidecar.getRecordsV3Api(topic.clusterId, topic.connectionId);

  // convert any provided headers to the correct format, ensuring the `value` is base64-encoded
  const headers: ProduceRequestHeader[] = (content.headers ?? []).map(
    (header: any): ProduceRequestHeader => ({
      name: header.key ? header.key : header.name,
      value: Buffer.from(header.value).toString("base64"),
    }),
  );
  // dig up any schema-related information we may need in the request body
  const { keyData, valueData } = await createProduceRequestData(topic, content.key, content.value);

  const produceRequest: ProduceRequest = {
    headers,
    key: keyData,
    value: valueData,
    // if these made it through the validation step, no other handling is needed
    partition_id: content.partition_id,
    timestamp: content.timestamp ? new Date(content.timestamp) : undefined,
  };
  const request: ProduceRecordRequest = {
    topic_name: topic.name,
    cluster_id: topic.clusterId,
    ProduceRequest: produceRequest,
  };

  let response: ProduceResponse | undefined;
  let errorBody: string | undefined;
  let timestamp = new Date();
  try {
    response = await recordsApi.produceRecord(request);
    // we may get a misleading `status: 200` with a nested `error_code` in the response body
    // ...but we may also get `error_code: 200` with a successful message
    if (response.error_code >= 400) {
      throw new ResponseError(
        new Response("", {
          status: response.error_code,
          statusText: response.message,
        }),
      );
    }
    timestamp = response.timestamp ? new Date(response.timestamp) : timestamp;
  } catch (error) {
    logError(error, "topic message produce", { connectionId: topic.connectionId }, true);
    if (error instanceof ResponseError) {
      const body = await error.response.clone().text();
      errorBody = `${error.response.status} ${error.response.statusText} ${body}`;
    } else if (error instanceof Error) {
      errorBody = error.message;
    }
  }
  return { timestamp, response, error: errorBody };
}

export async function createProduceRequestData(
  topic: KafkaTopic,
  key: any,
  value: any,
): Promise<{ keyData: ProduceRequestData; valueData: ProduceRequestData }> {
  // TODO: add schema information here for key and/or value once we have it

  const schemaless = "JSON";
  // determine if we have to provide `type` based on whether this is a CCloud-flavored topic or not
  const schemaType: { type?: string } = {};
  if (isCCloud(topic)) {
    schemaType.type = schemaless;
  } else if (isDirect(topic)) {
    // look up the formConnectionType for this topic's connection
    const spec: CustomConnectionSpec | null = await getResourceManager().getDirectConnection(
      topic.connectionId,
    );
    if (spec?.formConnectionType === "Confluent Cloud") {
      schemaType.type = schemaless;
    }
  }

  const keyData: ProduceRequestData = {
    ...schemaType,
    data: key,
    // schema_version: null,
    // subject: null,
    // subject_name_strategy: null,
  };
  const valueData: ProduceRequestData = {
    ...schemaType,
    data: value,
    // schema_version: null,
    // subject: null,
    // subject_name_strategy: null,
  };
  return { keyData, valueData };
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
    registerCommandWithLogging("confluent.topic.produce.fromDocument", produceMessagesFromDocument),
  ];
}
