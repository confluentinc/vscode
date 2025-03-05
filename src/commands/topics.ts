import * as Sentry from "@sentry/node";
import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import {
  ProduceRecordRequest,
  ProduceRequest,
  ProduceRequestData,
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
import { DEFAULT_ERROR_NOTIFICATION_BUTTONS, showErrorNotificationWithButtons } from "../errors";
import { ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { KafkaCluster } from "../models/kafkaCluster";
import { isCCloud } from "../models/resource";
import { Schema, Subject } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { ALLOW_OLDER_SCHEMA_VERSIONS, USE_TOPIC_NAME_STRATEGY } from "../preferences/constants";
import {
  SchemaKindSelection,
  schemaSubjectQuickPick,
  schemaVersionQuickPick,
  subjectKindMultiSelect,
  subjectNameStrategyQuickPick,
} from "../quickpicks/schemas";
import { loadDocumentContent, LoadedDocumentContent, uriQuickpick } from "../quickpicks/uris";
import { JSON_DIAGNOSTIC_COLLECTION } from "../schemas/diagnosticCollection";
import {
  PRODUCE_MESSAGE_SCHEMA,
  SchemaInfo,
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
  const selectResult: SchemaKindSelection | undefined = await subjectKindMultiSelect(topic);
  if (!selectResult) {
    // user exited the quickpick, or the topic was associated with a schema and user deselected
    // key+value and did not confirm that they wanted to produce without schema(s)
    return;
  }

  const keySchemaSelected: boolean = selectResult.keySchema;
  const valueSchemaSelected: boolean = selectResult.valueSchema;

  // check if the topic is associated with any schemas, and if so, prompt for subject+version based
  // on user settings
  let keySchema: Schema | undefined;
  let valueSchema: Schema | undefined;
  try {
    keySchema = keySchemaSelected ? await promptForSchema(topic, "key") : undefined;
    valueSchema = valueSchemaSelected ? await promptForSchema(topic, "value") : undefined;
  } catch (err) {
    logger.debug("exiting produce-message flow early due to promptForSchema error:", err);
    return;
  }

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
    await produceMessages(contents, topic, messageUri, keySchema, valueSchema);
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
        await produceMessages(contents, topic, messageUri, keySchema, valueSchema, progress, token);
      },
    );
  }
}

/**
 * Produce multiple messages to a Kafka topic through a worker pool and display info and/or error
 * notifications depending on the {@link ExecutionResult}s.
 */
async function produceMessages(
  contents: any[],
  topic: KafkaTopic,
  messageUri: vscode.Uri,
  keySchema: Schema | undefined,
  valueSchema: Schema | undefined,
  progress?: vscode.Progress<{
    message?: string;
    increment?: number;
  }>,
  token?: vscode.CancellationToken,
) {
  const forCCloudTopic = isCCloud(topic);
  // TODO: make maxWorkers a user setting?
  const results: ExecutionResult<ProduceResult>[] = await executeInWorkerPool(
    (content) => produceMessage(content, topic, keySchema, valueSchema, forCCloudTopic),
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
    // if there was only one message, we can also filter by key (if it exists)
    let textFilter: string | undefined;
    if (successResults.length === 1 && contents[0].key) {
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
  content: any,
  topic: KafkaTopic,
  keySchema: Schema | undefined,
  valueSchema: Schema | undefined,
  forCCloudTopic: boolean,
): Promise<ProduceResult> {
  // convert any provided headers to the correct format, ensuring the `value` is base64-encoded
  const headers: ProduceRequestHeader[] = (content.headers ?? []).map(
    (header: any): ProduceRequestHeader => ({
      name: header.key ? header.key : header.name,
      value: Buffer.from(header.value).toString("base64"),
    }),
  );
  // dig up any schema-related information we may need in the request body
  const { keyData, valueData } = await createProduceRequestData(
    topic,
    content.key,
    content.value,
    forCCloudTopic,
    keySchema,
    valueSchema,
    content.key_schema,
    content.value_schema,
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

/** Create the {@link ProduceRequestData} objects for the `key` and `value` of a produce request. */
export async function createProduceRequestData(
  topic: KafkaTopic,
  key: any,
  value: any,
  forCCloudTopic: boolean,
  keySchema?: Schema | undefined,
  valueSchema?: Schema | undefined,
  keySchemaInfo?: any,
  valueSchemaInfo?: any,
): Promise<{ keyData: ProduceRequestData; valueData: ProduceRequestData }> {
  // determine if we have to provide `type` based on whether this is a CCloud-flavored topic or not
  const schemaless = "JSON";
  const schemaType: { type?: string } = {};
  if (forCCloudTopic && !(keySchema || keySchemaInfo || valueSchema || valueSchemaInfo)) {
    schemaType.type = schemaless;
  }

  // message-provided schema information takes precedence over quickpicked schema
  const keySchemaData: SchemaInfo | undefined = extractSchemaInfo(keySchemaInfo, keySchema);
  const keyData: ProduceRequestData = {
    ...schemaType,
    ...(keySchemaData ?? {}),
    data: key,
  };
  const valueSchemaData: SchemaInfo | undefined = extractSchemaInfo(valueSchemaInfo, valueSchema);
  const valueData: ProduceRequestData = {
    ...schemaType,
    ...(valueSchemaData ?? {}),
    data: value,
  };
  return { keyData, valueData };
}

/**
 * Extract schema information from provided produce-message content, or a {@link Schema}. Returns
 * the necessary {@link SchemaInfo} object for the produce request.
 */
export function extractSchemaInfo(
  schemaInfo: any,
  schema: Schema | undefined,
): SchemaInfo | undefined {
  if (!(schemaInfo || schema)) {
    return;
  }
  const schema_version = schemaInfo?.schema_version ?? schema?.version;
  const subject = schemaInfo?.subject ?? schema?.subject;
  const subject_name_strategy = schemaInfo?.subject_name_strategy ?? "TOPIC_NAME";

  // drop type since the sidecar rejects this with a 400
  return { schema_version, subject, subject_name_strategy, type: undefined };
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

/**
 * Prompt the user to select a schema subject+version to use when producing messages to a topic.
 * @param topic The Kafka topic to produce messages to
 * @param kind Whether this is for a 'key' or 'value' schema
 * @returns The selected {@link Schema}, or `undefined` if user cancelled
 */
export async function promptForSchema(topic: KafkaTopic, kind: "key" | "value"): Promise<Schema> {
  // look up the associated SR instance for this topic
  const loader = ResourceLoader.getInstance(topic.connectionId);
  const schemaRegistries: SchemaRegistry[] = await loader.getSchemaRegistries();
  const registry: SchemaRegistry | undefined = schemaRegistries.find(
    (registry) => registry.environmentId === topic.environmentId,
  );
  if (!registry) {
    const noRegistryMsg = `No Schema Registry available for topic "${topic.name}".`;
    showErrorNotificationWithButtons(noRegistryMsg);
    throw new Error(noRegistryMsg);
  }

  const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();

  const useTopicNameStrategy: boolean = config.get(USE_TOPIC_NAME_STRATEGY) ?? true;
  let strategy: SubjectNameStrategy | undefined;
  if (!useTopicNameStrategy) {
    // if the user has disabled the topic name strategy, we need to prompt for the subject name
    // strategy first, which will help narrow down subjects
    strategy = await subjectNameStrategyQuickPick(topic, kind);
  } else {
    strategy = SubjectNameStrategy.TOPIC_NAME;
  }
  if (!strategy) {
    // setting is enabled but the user left the quickpick; throw an error so we don't assume
    // the user wants to produce without a schema
    throw new Error("User cancelled subject name strategy quickpick");
  }

  let schemaSubject: string | undefined = await getSubjectForStrategy(
    strategy,
    topic,
    kind,
    registry,
    loader,
  );
  if (!schemaSubject) {
    throw new Error(`"${kind}" schema subject not found/set for topic "${topic.name}".`);
  }

  const allowOlderSchemaVersions: boolean = config.get(ALLOW_OLDER_SCHEMA_VERSIONS, false);
  if (allowOlderSchemaVersions) {
    // allow the user to select a specific schema version if they enabled the setting
    const schemaVersion: Schema | undefined = await schemaVersionQuickPick(registry, schemaSubject);
    if (!schemaVersion) {
      throw new Error("Schema version not chosen.");
    }
    return schemaVersion;
  }

  // look up the latest schema version for the given subject
  const schemaVersions: Schema[] = await loader.getSchemasForEnvironmentId(registry.environmentId);
  const latestSchema: Schema | undefined = schemaVersions
    .filter((schema) => schema.subject === schemaSubject)
    .sort((a, b) => b.version - a.version)[0];
  if (!latestSchema) {
    const noVersionsMsg = `No schema versions found for subject "${schemaSubject}".`;
    showErrorNotificationWithButtons(noVersionsMsg);
    throw new Error(noVersionsMsg);
  }
  return latestSchema;
}

async function getSubjectForStrategy(
  strategy: SubjectNameStrategy,
  topic: KafkaTopic,
  kind: string,
  registry: SchemaRegistry,
  loader: ResourceLoader,
) {
  let schemaSubject: string | undefined;

  switch (strategy) {
    case SubjectNameStrategy.TOPIC_NAME:
      {
        // we have the topic name and the kind, so we just need to make sure the subject exists and
        // fast-track to getting the schema version
        schemaSubject = `${topic.name}-${kind}`;
        const schemaSubjects: Subject[] = await loader.getSubjects(registry);
        const subjectExists = schemaSubjects.some((s) => s.name === schemaSubject);
        if (!subjectExists) {
          const noSubjectMsg = `No "${kind}" schema subject found for topic "${topic.name}" using the ${strategy} strategy.`;
          showErrorNotificationWithButtons(noSubjectMsg, {
            "Open Settings": () => {
              vscode.commands.executeCommand(
                "workbench.action.openSettings",
                `@id:confluent.topic.produceMessages.schemas.useTopicNameStrategy`,
              );
            },
            ...DEFAULT_ERROR_NOTIFICATION_BUTTONS,
          });
          throw new Error(noSubjectMsg);
        }
      }
      break;
    case SubjectNameStrategy.TOPIC_RECORD_NAME:
      // filter the subject quickpick based on the topic name
      schemaSubject = await schemaSubjectQuickPick(
        registry,
        false,
        `Producing to ${topic.name}: ${kind} schema`,
        (s) => s.name.startsWith(topic.name),
      );
      break;
    case SubjectNameStrategy.RECORD_NAME:
      schemaSubject = await schemaSubjectQuickPick(
        registry,
        false,
        `Producing to ${topic.name}: ${kind} schema`,
      );
      break;
  }

  return schemaSubject;
}
