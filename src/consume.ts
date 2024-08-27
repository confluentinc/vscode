import { randomBytes } from "crypto";
import { EventEmitter, ExtensionContext, Uri, ViewColumn, window, workspace } from "vscode";
import { KafkaTopic } from "./models/topic";
import { type post } from "./webview/message-viewer";
import messageViewerTemplate from "./webview/message-viewer.html";

import {
  ResponseError,
  type PartitionOffset,
  type SimpleConsumeMultiPartitionRequest,
  type SimpleConsumeMultiPartitionResponse,
} from "./clients/sidecar";
import { registerCommandWithLogging } from "./commands";
import { Logger } from "./logging";
import { getSidecar } from "./sidecar";
import { BitSet, Stream } from "./stream/stream";
import { handleWebviewMessage } from "./webview/comms/comms";

export function activateMessageViewer(context: ExtensionContext) {
  // commands
  context.subscriptions.push(
    // the consume command is available in topic tree view's item actions
    registerCommandWithLogging("confluent.topic.consume", (topic: KafkaTopic) => {
      return messageViewerStartPollingCommand(context, topic);
    }),
  );
}

type TopicRecord = {
  uri: Uri;
  stream: Stream;
  actl: AbortController;
  full: boolean;
  mode: "beginning" | "latest" | "timestamp";
  state: "running" | "paused" | "errored";
  // TEMP tracking partition filter as just a property; will be removed later
  partition_filter: number[] | null;
  partitions: number[] | null;
  params: SimpleConsumeMultiPartitionRequest;
};

type MessageSender = OverloadUnion<typeof post>;
type MessageResponse<MessageType extends string> = Awaited<
  ReturnType<Extract<MessageSender, (type: MessageType, body: any) => any>>
>;

const DEFAULT_MAX_POLL_RECORDS = 250;

const DEFAULT_CONSUME_PARAMS = {
  max_poll_records: DEFAULT_MAX_POLL_RECORDS,
  message_max_bytes: 1 * 1024 * 1024,
  fetch_max_bytes: 40 * 1024 * 1024,
};

async function messageViewerStartPollingCommand(context: ExtensionContext, topic: KafkaTopic) {
  const topicName = topic.name;
  const clusterId = topic.clusterId;
  const id = `${clusterId}/${topicName}`;
  const uri = Uri.parse(`confluent:${topicName}.json?${JSON.stringify({ id })}`);
  const emitter = new EventEmitter<Uri>();

  const sidecar = await getSidecar();
  const service = sidecar.getKafkaConsumeApi(topic.connectionId);
  const partitionApi = sidecar.getPartitionV3Api(clusterId, topic.connectionId);

  const consume = async (
    SimpleConsumeMultiPartitionRequest: SimpleConsumeMultiPartitionRequest,
  ) => {
    const response =
      await service.gatewayV1ClustersClusterIdTopicsTopicNamePartitionsConsumePostRaw({
        cluster_id: clusterId,
        topic_name: topicName,
        x_connection_id: topic.connectionId,
        SimpleConsumeMultiPartitionRequest: SimpleConsumeMultiPartitionRequest,
      });
    return response.raw.json();
  };

  const actl = new AbortController();
  // TODO remove hardcoded limit, make sure array buffers are resizable
  const record: TopicRecord = {
    uri,
    stream: new Stream(100_000),
    actl,
    full: false,
    mode: "beginning",
    state: "running",
    partition_filter: null,
    partitions: null,
    params: {
      ...DEFAULT_CONSUME_PARAMS,
      from_beginning: true,
    },
  };

  const staticRoot = Uri.joinPath(context.extensionUri, "webview");
  const panel = window.createWebviewPanel("message-viewer", `Topic: ${topicName}`, ViewColumn.One, {
    enableScripts: true,
    localResourceRoots: [staticRoot],
  });

  panel.webview.html = messageViewerTemplate({
    cspSource: panel.webview.cspSource,
    nonce: randomBytes(16).toString("base64"),
    webviewUri: panel.webview.asWebviewUri(Uri.joinPath(staticRoot, "main.js")),
    webviewStylesheet: panel.webview.asWebviewUri(Uri.joinPath(staticRoot, "main.css")),
    messageViewerUri: panel.webview.asWebviewUri(Uri.joinPath(staticRoot, "message-viewer.js")),
  });

  function processMessage(...[type, body]: Parameters<MessageSender>) {
    switch (type) {
      case "GetMessages": {
        const offset = body.page * body.pageSize;
        const limit = body.pageSize;
        const { results, indices } = record.stream.slice(offset, limit);
        return {
          indices,
          messages: results.map(({ partition_id, offset, timestamp, key, value }) => {
            return { partition_id, offset, timestamp, key, value: truncate(value) };
          }),
        } satisfies MessageResponse<"GetMessages">;
      }
      case "GetMessagesCount": {
        return record.stream.count() satisfies MessageResponse<"GetMessagesCount">;
      }
      case "GetPartitionStats": {
        return partitionApi
          .listKafkaPartitions({ cluster_id: clusterId, topic_name: topicName })
          .then((v) => v.data) satisfies Promise<MessageResponse<"GetPartitionStats">>;
      }
      case "GetConsumedPartitions": {
        return record.partitions satisfies MessageResponse<"GetConsumedPartitions">;
      }
      case "GetFilteredPartitions": {
        return record.partition_filter satisfies MessageResponse<"GetFilteredPartitions">;
      }
      case "GetMaxSize": {
        return String(record.stream.capacity) satisfies MessageResponse<"GetMaxSize">;
      }
      case "GetStreamState": {
        return record.state satisfies MessageResponse<"GetStreamState">;
      }
      case "PreviewMessageByIndex": {
        workspace
          .openTextDocument({
            content:
              `// message ${record.stream.messages.at(body.index).key} from ${topicName}\n` +
              JSON.stringify(record.stream.messages.at(body.index), null, 2),
            language: "jsonc",
          })
          .then((preview) => {
            return window.showTextDocument(preview, {
              preview: false,
              viewColumn: ViewColumn.Beside,
              preserveFocus: false,
            });
          });
        return null;
      }
      case "SearchMessages": {
        return null satisfies MessageResponse<"SearchMessages">;
      }
      case "StreamPause": {
        record.state = "paused";
        emitter.fire(uri);
        return null satisfies MessageResponse<"StreamPause">;
      }
      case "StreamResume": {
        record.state = "running";
        emitter.fire(uri);
        return null satisfies MessageResponse<"StreamResume">;
      }
      case "ConsumeModeChange": {
        record.mode = body.mode;
        const maxPollRecords = Math.min(DEFAULT_MAX_POLL_RECORDS, record.stream.capacity);
        record.params = getParams(body.mode, body.timestamp, maxPollRecords);
        record.stream = new Stream(record.stream.capacity);
        record.state = "running";
        record.partition_filter = null;
        emitter.fire(uri);
        return null satisfies MessageResponse<"ConsumeModeChange">;
      }
      case "PartitionConsumeChange": {
        record.partitions = body.partitions;
        const maxPollRecords = Math.min(DEFAULT_MAX_POLL_RECORDS, record.stream.capacity);
        record.params = getParams(record.mode, record.params.timestamp, maxPollRecords);
        record.stream = new Stream(record.stream.capacity);
        record.state = "running";
        record.partition_filter = null;
        emitter.fire(uri);
        return null satisfies MessageResponse<"PartitionConsumeChange">;
      }
      case "PartitionFilterChange": {
        record.partition_filter = body.partitions;
        emitter.fire(uri);
        return null satisfies MessageResponse<"PartitionFilterChange">;
      }
      case "MessageLimitChange": {
        const maxPollRecords = Math.min(DEFAULT_MAX_POLL_RECORDS, body.limit);
        record.params = getParams(record.mode, record.params.timestamp, maxPollRecords);
        record.stream = new Stream(body.limit);
        record.state = "running";
        emitter.fire(uri);
        return null satisfies MessageResponse<"MessageLimitChange">;
      }
    }
  }

  context.subscriptions.push(
    // panel is closed, shut down the stream
    panel.onDidDispose(() => {
      record.actl.abort();
      emitter.dispose();
    }),

    handleWebviewMessage(panel.webview, processMessage),

    // send the message to webview whenever stream updates
    emitter.event(() => {
      // TEMP partition filter is the first filter to be implemented,
      // gonna live here for now, while Oleksii figures out the pipeline for multiple filters
      if (record.partition_filter != null) {
        let bitset = new BitSet(record.stream.capacity);
        for (const partitionId of record.partition_filter) {
          let range = record.stream.partition.range(partitionId, partitionId);
          if (range != null) {
            const next = record.stream.partition.next;
            let cursor = range[0];
            while (true) {
              bitset.set(cursor);
              if (cursor === range[1]) break;
              cursor = next[cursor];
            }
          }
        }
        record.stream.bitset = bitset;
      } else {
        record.stream.bitset = null;
      }
      // notify the webview only after flushing the rest of updates
      queueMicrotask(() => panel.webview.postMessage(["Timestamp", "Success", Date.now()]));
    }),
  );

  await startConsuming(record, emitter, consume);
}

const logger = new Logger("consume");

function getParams(
  mode: "beginning" | "latest" | "timestamp",
  timestamp: number | undefined,
  max_poll_records: number,
) {
  return mode === "beginning"
    ? { ...DEFAULT_CONSUME_PARAMS, max_poll_records, from_beginning: true }
    : mode === "timestamp"
      ? { ...DEFAULT_CONSUME_PARAMS, max_poll_records, timestamp }
      : { ...DEFAULT_CONSUME_PARAMS, max_poll_records };
}

async function startConsuming(
  record: TopicRecord,
  emitter: EventEmitter<Uri>,
  consume: (
    state: SimpleConsumeMultiPartitionRequest,
  ) => Promise<SimpleConsumeMultiPartitionResponse>,
) {
  consume: while (!record.actl.signal.aborted) {
    try {
      let params = record.params;
      let result = await consume(params);
      if (record.state === "paused") {
        // consumption was paused while we were waiting for the result
        // let's wait for the user to resume, before we show the result on the screen
        await waitForState(record, emitter, "running");
      }
      if (params !== record.params) {
        // the params were changed while we were waiting for the result
        // so we need to dismiss this result and start with fresh params
        continue;
      }
      if (record.actl.signal.aborted) {
        // the consumption was aborted while we were waiting for the result
        return;
      }
      for (const partition of result.partition_data_list ?? []) {
        if (record.partitions != null && !record.partitions.includes(partition.partition_id!)) {
          // the first request always going to include messages from all partitions
          // if we consume a subset of partitions, some messages need to be dropped
          continue;
        }
        for (const message of partition.records ?? []) {
          record.stream.insert(message);
          // the first time when the stream size reaches message limit, we pause it until the user resumes it
          if (!record.full && record.stream.size >= record.stream.capacity) {
            record.full = true;
            record.state = "paused";
            emitter.fire(record.uri);
            await waitForState(record, emitter, "running");
            if (params !== record.params) {
              // the params were changed while we were waiting for resume
              // any leftover messages should be dismissed
              // and we need to start consuming using the new params
              continue consume;
            }
          }
        }
      }
      // if record includes a list of partition ids, I can pass it here for filtering
      record.params = nextOffsets(record.params, result, record.partitions);
      emitter.fire(record.uri);
      await sleep();
    } catch (error) {
      // do nothing, for now. if it was a network issue,
      // the user going to see auth related error alert
      if (error instanceof ResponseError) {
        logger.error(
          `An error occurred during messages consumption. Status ${error.response.status}, ${error.response.statusText}`,
        );
      } else if (error instanceof Error) {
        logger.error(error.message);
      }
      // still need to wait for some time before making next request
      await sleep();
    }
  }
}

function waitForState(
  record: TopicRecord,
  emitter: EventEmitter<Uri>,
  state: "running" | "paused" | "errored",
) {
  return new Promise<void>((resolve) => {
    let listener = emitter.event(() => {
      if (record.state === state) {
        listener.dispose();
        resolve();
      }
    });
    record.actl.signal.addEventListener("abort", () => {
      listener.dispose();
      resolve();
    });
  });
}

function nextOffsets(
  params: SimpleConsumeMultiPartitionRequest,
  results: SimpleConsumeMultiPartitionResponse,
  partitions: number[] | null,
): SimpleConsumeMultiPartitionRequest {
  if (results.partition_data_list != null) {
    const { max_poll_records, message_max_bytes, fetch_max_bytes } = params;
    const offsets = results.partition_data_list.reduce((list, { partition_id, next_offset }) => {
      return partitions == null || (partition_id != null && partitions.includes(partition_id))
        ? list.concat({ partition_id: partition_id, offset: next_offset })
        : list;
    }, [] as PartitionOffset[]);
    return { max_poll_records, message_max_bytes, fetch_max_bytes, offsets };
  }
  return params;
}

const MIN_POLLING_INTERVAL_MS = 2 * 1000;
const THRESHOLD_POLLING_INTERVAL_MS = 1 * 1000;

function sleep() {
  const delay = MIN_POLLING_INTERVAL_MS + THRESHOLD_POLLING_INTERVAL_MS * Math.random();
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Compress any valid json value into smaller payload for preview purpose.
 * Following rules applied recursively:
 *
 * 1. Strings with length >1024 appear as 256 leading + "..." + 256 trailing symbols
 * 2. Arrays capped at 512 elements with "truncated array" string at the end
 *    2.1. Each array's item is truncated recursively
 * 3. Objects capped at 64 keys with extra empty key saying "truncated object"
 *    3.1. Each object property's value is truncated recursively
 *    3.2. Total number of object keys across the whole structure cannot exceed 1024
 * 4. If recursion depth exceeds 8 levels and the input is not a string, "truncated" is returned
 */
function truncate(value: any, depth = 0, cap = 0): any {
  if (typeof value === "string") {
    return value.length > 1024 ? value.slice(0, 256) + " ... " + value.slice(-256) : value;
  }
  if (Array.isArray(value)) {
    if (depth >= 8) return " truncated ";
    depth++;
    return value.length > 512
      ? value
          .slice(0, 512)
          .map((item) => truncate(item, depth, cap))
          .concat(" truncated ")
      : value.map((item) => truncate(item, depth, cap));
  }
  if (typeof value === "object" && value !== null) {
    if (depth >= 8) return " truncated ";
    const truncated: Record<string, any> = {};
    let count = 0;
    for (const key in value) {
      if (++cap >= 1024 || ++count >= 64) {
        truncated[" "] = " truncated ";
        break;
      }
      truncated[key] = truncate(value[key], depth + 1, cap);
    }
    return truncated;
  }
  return value;
}
