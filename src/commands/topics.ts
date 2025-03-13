import * as Sentry from "@sentry/node";
import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import {
  ProduceRecordRequest,
  ProduceRequest,
  ProduceRequestHeader,
  ProduceResponse,
  RecordsV3Api,
  ResponseError,
  type UpdateKafkaTopicConfigBatchRequest,
} from "../clients/kafkaRest";
import {
  ProduceRequest as CCloudProduceRequest,
  ConfluentCloudProduceRecordsResourceApi,
} from "../clients/sidecar";
import { MessageViewerConfig } from "../consume";
import { MESSAGE_URI_SCHEME } from "../documentProviders/message";
import { showErrorNotificationWithButtons } from "../errors";
import { Logger } from "../logging";
import { KafkaCluster } from "../models/kafkaCluster";
import { isCCloud } from "../models/resource";
import { Schema } from "../models/schema";
import { KafkaTopic } from "../models/topic";
import { schemaKindMultiSelect, SchemaKindSelection } from "../quickpicks/schemas";
import { loadDocumentContent, LoadedDocumentContent, uriQuickpick } from "../quickpicks/uris";
import { promptForSchema } from "../quickpicks/utils/schemas";
import { getSubjectNameStrategy } from "../quickpicks/utils/schemaSubjects";
import { JSON_DIAGNOSTIC_COLLECTION } from "../schemas/diagnosticCollection";
import {
  PRODUCE_MESSAGE_SCHEMA,
  ProduceMessage,
  SubjectNameStrategy,
} from "../schemas/produceMessageSchema";
import { validateDocument } from "../schemas/validateDocument";
import { getSidecar } from "../sidecar";
import { logUsage, UserEvent } from "../telemetry/events";
import {
  executeInWorkerPool,
  ExecutionResult,
  isErrorResult,
  isSuccessResult,
} from "../utils/workerPool";
import { getTopicViewProvider } from "../viewProviders/topics";
import { WebviewPanelCache } from "../webview-cache";
import { handleWebviewMessage } from "../webview/comms/comms";
import { post } from "../webview/topic-config-form";
import topicFormTemplate from "../webview/topic-config-form.html";
import { createProduceRequestData } from "./utils/produceMessage";
import { ProduceMessageSchemaOptions } from "./utils/types";

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
  logUsage(UserEvent.MessageProduceAction, { status: "started" });

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
    logUsage(UserEvent.MessageProduceAction, {
      status: "exited early from file/document quickpick",
    });
    return;
  }
  logUsage(UserEvent.MessageProduceAction, {
    status: "picked file/document",
    uriScheme: messageUri.scheme, // untitled, file, or confluent.topic.message
  });

  const { content }: LoadedDocumentContent = await loadDocumentContent(messageUri);
  if (!content) {
    logUsage(UserEvent.MessageProduceAction, {
      status: "failed to load message content",
      uriScheme: messageUri.scheme,
    });
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
    logUsage(UserEvent.MessageProduceAction, {
      status: "failed base JSON validation",
      uriScheme: messageUri.scheme,
      problemCount: diagnostics.length,
    });
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

  logUsage(UserEvent.MessageProduceAction, {
    status: "passed base JSON validation",
    uriScheme: messageUri.scheme,
  });

  // ask the user if they want to use a schema for the key and/or value
  const selectResult: SchemaKindSelection | undefined = await schemaKindMultiSelect(topic);
  if (!selectResult) {
    // user exited the quickpick, or the topic was associated with a schema and user deselected
    // key+value and did not confirm that they wanted to produce without schema(s)
    return;
  }

  // if key and/or value schemas are selected, we need to determine the subject name strategy
  // to use before trying to look up the subject
  const keySubjectNameStrategy: SubjectNameStrategy | undefined = selectResult.keySchema
    ? await getSubjectNameStrategy(topic, "key")
    : undefined;
  const valueSubjectNameStrategy: SubjectNameStrategy | undefined = selectResult.valueSchema
    ? await getSubjectNameStrategy(topic, "value")
    : undefined;

  // check if the topic is associated with any schemas, and if so, prompt for subject+version based
  // on user settings
  let keySchema: Schema | undefined;
  let valueSchema: Schema | undefined;
  try {
    keySchema = keySubjectNameStrategy
      ? await promptForSchema(topic, "key", keySubjectNameStrategy)
      : undefined;
    valueSchema = valueSubjectNameStrategy
      ? await promptForSchema(topic, "value", valueSubjectNameStrategy)
      : undefined;
  } catch (err) {
    logger.debug("exiting produce-message flow early due to promptForSchema error:", err);
    return;
  }

  const schemaOptions: ProduceMessageSchemaOptions = {
    keySchema,
    valueSchema,
    keySubjectNameStrategy,
    valueSubjectNameStrategy: valueSubjectNameStrategy,
  };

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
    await produceMessages(contents, topic, messageUri, schemaOptions);
  } else {
    // show progress notification for batch produce
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Producing ${contents.length.toLocaleString()} message${contents.length > 1 ? "s" : ""} to topic "${topic.name}"...`,
        cancellable: true,
      },
      async (
        progress: vscode.Progress<{
          message?: string;
          increment?: number;
        }>,
        token: vscode.CancellationToken,
      ) => {
        progress.report({ increment: 0 });
        await produceMessages(contents, topic, messageUri, schemaOptions, progress, token);
      },
    );
  }
}

/**
 * Produce multiple messages to a Kafka topic through a worker pool and display info and/or error
 * notifications depending on the {@link ExecutionResult}s.
 */
async function produceMessages(
  contents: ProduceMessage[],
  topic: KafkaTopic,
  messageUri: vscode.Uri,
  schemaOptions: ProduceMessageSchemaOptions,
  progress?: vscode.Progress<{
    message?: string;
    increment?: number;
  }>,
  token?: vscode.CancellationToken,
) {
  // TODO: make maxWorkers a user setting?
  const results: ExecutionResult<ProduceResult>[] = await executeInWorkerPool(
    (content) => produceMessage(content, topic, schemaOptions),
    contents,
    { maxWorkers: 20, taskName: "produceMessage" },
    progress,
    token,
  );

  const successResults = results.filter(isSuccessResult);
  const errorResults = results.filter(isErrorResult);
  logUsage(UserEvent.MessageProduceAction, {
    status: "completed",
    uriScheme: messageUri.scheme,
    originalMessageCount: contents.length,
    successResultCount: successResults.length,
    errorResultCount: errorResults.length,
  });

  const plural = contents.length > 1 ? "s" : "";
  logger.debug(
    `produced ${successResults.length}/${contents.length} message${plural} produced to topic "${topic.name}"`,
  );
  const ofTotal = plural ? ` of ${contents.length.toLocaleString()}` : "";

  if (successResults.length) {
    // set up a time window around the produced message(s) for message viewer
    const bufferMs = 500;
    const firstMessageTime = successResults[0].result.timestamp.getTime() - bufferMs;
    const lastMessageTime =
      successResults[successResults.length - 1].result.timestamp.getTime() + bufferMs;
    // aggregate all unique partitions from the produce responses
    const uniquePartitions: Set<number> = new Set();
    successResults.forEach(({ result }) => {
      if (result.response?.partition_id) {
        uniquePartitions.add(result.response.partition_id);
      }
    });
    // if there was only one message, we can also filter by key (if it exists) as long as it's a
    // primitive type and can be easily converted to a string
    let textFilter: string | undefined;
    if (successResults.length === 1 && contents[0].key && typeof contents[0].key !== "object") {
      textFilter = String(contents[0].key);
    }

    const buttonLabel = `View Message${plural}`;
    vscode.window
      .showInformationMessage(
        `Successfully produced ${successResults.length.toLocaleString()}${ofTotal} message${plural} to topic "${topic.name}".`,
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
          logUsage(UserEvent.MessageProduceAction, {
            status: "opened message viewer",
            uriScheme: messageUri.scheme,
            originalMessageCount: contents.length,
            successResultCount: successResults.length,
            errorResultCount: errorResults.length,
          });
        }
      });
  }

  if (errorResults.length) {
    const errorMessages = errorResults.map(({ error }) => error).join("\n");
    // this format isn't great if there are multiple errors, but it's better than nothing
    showErrorNotificationWithButtons(
      `Failed to produce ${errorResults.length.toLocaleString()}${ofTotal} message${plural} to topic "${topic.name}":\n${errorMessages}`,
    );
  }
}

interface ProduceResult {
  timestamp: Date;
  response: ProduceResponse;
}

/** Produce a single message to a Kafka topic. */
export async function produceMessage(
  content: ProduceMessage,
  topic: KafkaTopic,
  schemaOptions: ProduceMessageSchemaOptions,
): Promise<ProduceResult> {
  const forCCloudTopic = isCCloud(topic);
  // convert any provided headers to the correct format, ensuring the `value` is base64-encoded
  const headers: ProduceRequestHeader[] = (content.headers ?? []).map(
    (header: any): ProduceRequestHeader => ({
      name: header.key ? header.key : header.name,
      value: Buffer.from(header.value).toString("base64"),
    }),
  );
  // dig up any schema-related information we may need in the request body
  const { keyData, valueData } = await createProduceRequestData(
    content,
    schemaOptions,
    forCCloudTopic,
  );

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
  };

  let response: ProduceResponse | undefined;
  let timestamp = new Date();

  const sidecar = await getSidecar();

  if (forCCloudTopic) {
    const ccloudClient: ConfluentCloudProduceRecordsResourceApi =
      sidecar.getConfluentCloudProduceRecordsResourceApi(topic.connectionId);
    const ccloudResponse = await ccloudClient.gatewayV1ClustersClusterIdTopicsTopicNameRecordsPost({
      ...request,
      x_connection_id: topic.connectionId,
      dry_run: false,
      ProduceRequest: produceRequest as CCloudProduceRequest,
    });
    response = ccloudResponse as ProduceResponse;
  } else {
    // non-CCloud topic route:
    const client: RecordsV3Api = sidecar.getRecordsV3Api(topic.clusterId, topic.connectionId);
    response = await client.produceRecord({ ...request, ProduceRequest: produceRequest });
  }

  timestamp = response.timestamp ? new Date(response.timestamp) : timestamp;

  return { timestamp, response };
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
