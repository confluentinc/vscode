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
import {
  DEFAULT_ERROR_NOTIFICATION_BUTTONS,
  isResponseError,
  logError,
  showErrorNotificationWithButtons,
} from "../errors";
import { Logger } from "../logging";
import { KafkaCluster } from "../models/kafkaCluster";
import { isCCloud } from "../models/resource";
import { Schema } from "../models/schema";
import { KafkaTopic } from "../models/topic";
import { schemaKindMultiSelect, SchemaKindSelection } from "../quickpicks/schemas";
import { uriQuickpick } from "../quickpicks/uris";
import { promptForSchema } from "../quickpicks/utils/schemas";
import { getSubjectNameStrategy } from "../quickpicks/utils/schemaSubjects";
import { JSON_DIAGNOSTIC_COLLECTION } from "../schemas/diagnosticCollection";
import { getRangeForDocument } from "../schemas/parsing";
import {
  PRODUCE_MESSAGE_SCHEMA,
  ProduceMessage,
  SubjectNameStrategy,
} from "../schemas/produceMessageSchema";
import { validateDocument } from "../schemas/validateDocument";
import { getSidecar } from "../sidecar";
import { logUsage, UserEvent } from "../telemetry/events";
import { getEditorOrFileContents, LoadedDocumentContent } from "../utils/file";
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
  // Check this despite the type, since at runtime VSCode could pass the wrong selected item or undefined
  if (!topic || !(topic instanceof KafkaTopic)) {
    return;
  }
  // Retrieve the current topic configuration data
  let topicConfigRemoteItems = null;
  try {
    const client = (await getSidecar()).getConfigsV3Api(topic.clusterId, topic.connectionId);
    topicConfigRemoteItems = await client.listKafkaTopicConfigs({
      cluster_id: topic.clusterId,
      topic_name: topic.name,
    });
  } catch (err) {
    logError(err, "list topic configs", {}, true);
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
        logError(err, "update topic config", {}, true);
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

  const { content }: LoadedDocumentContent = await getEditorOrFileContents(messageUri);
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
    // send all results to the error diagnostics handler since we want the indices of the results
    // for any error diagnostics
    const diagnostics = await handleSchemaValidationErrors(results, messageUri);

    let buttons = DEFAULT_ERROR_NOTIFICATION_BUTTONS;
    if (diagnostics.length) {
      const suffix = plural ? `${plural} (${diagnostics.length.toLocaleString()})` : "";
      const buttonLabel = `Show Validation Error${suffix}`;
      buttons = {
        [buttonLabel]: () => {
          vscode.window.showTextDocument(messageUri, { preview: false }).then(() => {
            vscode.commands.executeCommand("workbench.action.showErrorsWarnings");
          });
        },
        ...DEFAULT_ERROR_NOTIFICATION_BUTTONS,
      };
    }

    // only display up to the top three non-validation errors and their counts
    const errorSummary: string = summarizeErrors(
      errorResults.map((result) => result.error),
      ["ProduceMessageBadRequestError"],
      3,
    );

    // if we only have validation errors, no summary will be shown, but we should provide the
    // "Show Validation Errors" button
    showErrorNotificationWithButtons(
      `Failed to produce ${errorResults.length.toLocaleString()}${ofTotal} message${plural} to topic "${topic.name}"${errorSummary ? `:\n${errorSummary}` : ""}`,
      buttons,
    );
  }
}

/**
 * Aggregates counts of error messages and returns a summary string.
 * - If a single error is provided, it returns the error message.
 * - For multiple error messages, this returns a string with the count of each unique error message
 * in descending order.
 *
 * @param errors - An array of Error objects.
 * @param ignoredTypes - An array of error types to exclude from the summary.
 * @param limit - The maximum number of unique error messages to include in the summary.
 */
export function summarizeErrors(
  errors: Error[],
  ignoredTypes: string[] = [],
  limit: number = 3,
): string {
  if (!errors.length) {
    return "";
  }
  if (errors.length === 1) {
    // only return the single message if it isn't excluded
    if (ignoredTypes.includes(errors[0].name)) {
      return "";
    }
    return errors[0].message;
  }
  // aggregate error message counts and show them in descending order by count
  const errorTypeCounts: { [key: string]: number } = {};
  errors.forEach((error) => {
    if (ignoredTypes.includes(error.name)) {
      return;
    }
    errorTypeCounts[error.message] = (errorTypeCounts[error.message] ?? 0) + 1;
  });
  const errorSummary: string = Object.entries(errorTypeCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([msg, count]) => `${msg} (x${count})`)
    .slice(0, limit)
    .join(", ");
  return errorSummary;
}

/**
 * Handles schema validation errors by mapping them to the corresponding ranges in the document.
 * This function collects all errors and their range promises while maintaining the index mapping,
 * and then applies the validation-related error diagnostics to the document.
 *
 * @param results - An array of ExecutionResult objects containing ProduceResult.
 * @param messageUri - The URI of the message document.
 * @returns An array of vscode.Diagnostic objects representing the validation errors.
 */
export async function handleSchemaValidationErrors(
  results: ExecutionResult<ProduceResult>[],
  messageUri: vscode.Uri,
) {
  // map the original error position, the error itself, and the promise for looking up the range
  interface ErrorMapping {
    resultIndex: number;
    error: Error;
    rangePromise: Promise<vscode.Range>;
  }

  const errorMappings: ErrorMapping[] = [];

  // collect all errors and their range promises while maintaining the index mapping
  results.forEach((result, idx) => {
    if (result.error instanceof ProduceMessageBadRequestError) {
      // check if the validation error was caused by the key and/or the value by looking at the
      // request, which may create multiple ranges for a single message
      // TODO(shoup): this is a workaround for the fact that we don't get more information from the
      // serializer errors, but we should revisit this once we're able to get more information like
      // key/value and specific field(s) or paths
      const forKey = typeof result.error.request.key?.subject_name_strategy === "string";
      const forValue = typeof result.error.request.value?.subject_name_strategy === "string";
      if (forKey) {
        errorMappings.push({
          resultIndex: idx,
          error: result.error,
          rangePromise: getRangeForDocument(messageUri, PRODUCE_MESSAGE_SCHEMA, idx, "key"),
        });
      }
      if (forValue) {
        errorMappings.push({
          resultIndex: idx,
          error: result.error,
          rangePromise: getRangeForDocument(messageUri, PRODUCE_MESSAGE_SCHEMA, idx, "value"),
        });
      }
    }
  });
  const resolvedMappings = await Promise.all(
    errorMappings.map(async (mapping) => ({
      ...mapping,
      range: await mapping.rangePromise,
    })),
  );

  const messageDiagnostics: vscode.Diagnostic[] = [];
  if (resolvedMappings.length > 0) {
    // apply the validation-related error diagnostics to the document
    resolvedMappings.forEach((mapping) => {
      messageDiagnostics.push(
        new vscode.Diagnostic(
          mapping.range,
          mapping.error.message,
          vscode.DiagnosticSeverity.Error,
        ),
      );
    });
    JSON_DIAGNOSTIC_COLLECTION.set(messageUri, messageDiagnostics);
  }
  return messageDiagnostics;
}

export interface ProduceResult {
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
  const { keyData, valueData } = await createProduceRequestData(content, schemaOptions);

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

  try {
    if (forCCloudTopic) {
      const ccloudClient: ConfluentCloudProduceRecordsResourceApi =
        sidecar.getConfluentCloudProduceRecordsResourceApi(topic.connectionId);
      const ccloudResponse =
        await ccloudClient.gatewayV1ClustersClusterIdTopicsTopicNameRecordsPost({
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
  } catch (err) {
    // only attempt to catch schema validation errors
    if (isResponseError(err) && err.response.status === 400) {
      let errBody: string | undefined;
      try {
        // should be {"message":"Failed to parse data: ... ","error_code":400}
        const respJson = await err.response.clone().json();
        if (respJson && typeof respJson === "object" && respJson.message) {
          errBody = respJson.message;
        }
      } catch {
        errBody = await err.response.clone().text();
      }
      if (errBody !== undefined)
        throw new ProduceMessageBadRequestError(errBody, produceRequest, err.response);
    }
    throw err;
  }

  timestamp = response.timestamp ? new Date(response.timestamp) : timestamp;

  return { timestamp, response };
}

export class ProduceMessageBadRequestError extends Error {
  request: ProduceRequest;
  response: Response;
  constructor(message: string, request: ProduceRequest, response: Response) {
    super(message);
    this.name = "ProduceMessageBadRequestError";
    this.request = request;
    this.response = response;
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
    registerCommandWithLogging("confluent.topic.produce.fromDocument", produceMessagesFromDocument),
  ];
}
