import { randomBytes } from "crypto";
import { utcTicks } from "d3-time";
import { Data } from "dataclass";
import { ObservableScope } from "inertial";
import { ExtensionContext, Uri, ViewColumn, window, workspace } from "vscode";
import { type KafkaTopic } from "./models/topic";
import { type post } from "./webview/message-viewer";
import messageViewerTemplate from "./webview/message-viewer.html";
import {
  canAccessSchemaForTopic,
  showNoSchemaAccessWarningNotification,
} from "./authz/schemaRegistry";
import {
  ResponseError,
  type PartitionConsumeRecord,
  type PartitionOffset,
  type SimpleConsumeMultiPartitionRequest,
  type SimpleConsumeMultiPartitionResponse,
} from "./clients/sidecar";
import { registerCommandWithLogging } from "./commands";
import { Logger } from "./logging";
import { getTelemetryLogger } from "./telemetry";
import { getSidecar, type SidecarHandle } from "./sidecar";
import { BitSet, Stream, includesSubstring } from "./stream/stream";
import { handleWebviewMessage } from "./webview/comms/comms";
import { kafkaClusterQuickPick } from "./quickpicks/kafkaClusters";
import { topicQuickPick } from "./quickpicks/topics";
import { scheduler } from "./scheduler";

export function activateMessageViewer(context: ExtensionContext) {
  /* All active message viewer instances share the same scheduler to perform API
  requests. The scheduler defines number of concurrent requests at a time and a
  minimum time interval for a single task to unblock a "thread". This all allows
  faster consumption of retained messages for a single message viewer and prevents
  rate limiting for multiple active message viewers. */
  const schedule = scheduler(4, 500);

  // commands
  context.subscriptions.push(
    // the consume command is available in topic tree view's item actions
    registerCommandWithLogging("confluent.topic.consume", async (topic?: KafkaTopic) => {
      if (topic == null) {
        const cluster = await kafkaClusterQuickPick(true, true);
        if (cluster == null) return;
        topic = await topicQuickPick(cluster);
        if (topic == null) return;
      }

      if (!(await canAccessSchemaForTopic(topic))) {
        showNoSchemaAccessWarningNotification();
      }
      const sidecar = await getSidecar();
      return messageViewerStartPollingCommand(context, topic, sidecar, schedule);
    }),
  );
}

type MessageSender = OverloadUnion<typeof post>;
type MessageResponse<MessageType extends string> = Awaited<
  ReturnType<Extract<MessageSender, (type: MessageType, body: any) => any>>
>;

const DEFAULT_MAX_POLL_RECORDS = 500;
const DEFAULT_RECORDS_CAPACITY = 100_000;

const DEFAULT_CONSUME_PARAMS = {
  max_poll_records: DEFAULT_MAX_POLL_RECORDS,
  message_max_bytes: 1 * 1024 * 1024,
  fetch_max_bytes: 40 * 1024 * 1024,
};

function messageViewerStartPollingCommand(
  context: ExtensionContext,
  topic: KafkaTopic,
  sidecar: SidecarHandle,
  schedule: <T>(cb: () => Promise<T>, signal?: AbortSignal) => Promise<T>,
) {
  const staticRoot = Uri.joinPath(context.extensionUri, "webview");
  const panel = window.createWebviewPanel(
    "message-viewer",
    `Topic: ${topic.name}`,
    ViewColumn.One,
    { enableScripts: true, localResourceRoots: [staticRoot] },
  );

  panel.webview.html = messageViewerTemplate({
    cspSource: panel.webview.cspSource,
    nonce: randomBytes(16).toString("base64"),
    webviewUri: panel.webview.asWebviewUri(Uri.joinPath(staticRoot, "main.js")),
    webviewStylesheet: panel.webview.asWebviewUri(Uri.joinPath(staticRoot, "main.css")),
    messageViewerUri: panel.webview.asWebviewUri(Uri.joinPath(staticRoot, "message-viewer.js")),
  });

  const service = sidecar.getKafkaConsumeApi(topic.connectionId);
  const partitionApi = sidecar.getPartitionV3Api(topic.clusterId, topic.connectionId);

  const consume = async (
    request: SimpleConsumeMultiPartitionRequest,
    signal: AbortSignal,
  ): Promise<SimpleConsumeMultiPartitionResponse> => {
    const response =
      await service.gatewayV1ClustersClusterIdTopicsTopicNamePartitionsConsumePostRaw(
        {
          cluster_id: topic.clusterId,
          topic_name: topic.name,
          x_connection_id: topic.connectionId,
          SimpleConsumeMultiPartitionRequest: request,
        },
        { signal },
      );
    return response.raw.json();
  };

  const os = ObservableScope();

  /** Is stream currently running or being paused?  */
  const state = os.signal<"running" | "paused">("running");
  const timer = os.signal(Timer.create());
  /** Consume mode: are we consuming from the beginning, expecting the newest messages, or targeting a timestamp. */
  const mode = os.signal<"beginning" | "latest" | "timestamp">("beginning");
  /** Parameters used by Consume API. */
  const params = os.signal<SimpleConsumeMultiPartitionRequest>({
    ...DEFAULT_CONSUME_PARAMS,
    from_beginning: true,
  });
  /** List of currently consumed partitions. `null` for all partitions. */
  const partitionConsumed = os.signal<number[] | null>(null);
  /** List of currently filtered partitions. `null` for all consumed partitions. */
  const partitionFilter = os.signal<number[] | null>(null);
  /** Filter by range of timestamps. `null` for all consumed messages. */
  const timestampFilter = os.signal<[number, number] | null>(null);
  /** Filter by substring text query. Persists bitset instead of computing it. */
  const textFilter = os.signal<{ bitset: BitSet; regexp: RegExp; query: string } | null>(null);
  /** The stream instance that holds consumed messages and index them by timestamp and partition. */
  const stream = os.signal(new Stream(DEFAULT_RECORDS_CAPACITY));
  /**
   * A boolean that indicates if the stream reached its capacity.
   * Continuing consumption after this means overriding oldest messages.
   */
  const isStreamFull = os.signal(false);

  /** Most recent response payload from Consume API. */
  const latestResult = os.signal<SimpleConsumeMultiPartitionResponse | null>(null);
  /** Most recent failure info */
  const latestError = os.signal<{ message: string } | null>(null);

  /** Notify an active webview only after flushing the rest of updates. */
  const notifyUI = () => {
    queueMicrotask(() => {
      try {
        if (panel.visible) {
          panel.webview.postMessage(["Timestamp", "Success", Date.now()]);
        }
      } catch {
        // panel might be disposed which causes `panel.visible` getter to throw
      }
    });
  };

  /** Provides partition filter bitset based on the most recent consumed result. */
  const partitionBitset = os.derive<BitSet | null>(() => {
    const result = latestResult();
    const { capacity, partition } = stream();
    const ids = partitionFilter();
    if (ids == null || result == null) return null;
    const bitset = new BitSet(capacity);
    for (const partitionId of ids) {
      let range = partition.range(partitionId, partitionId);
      if (range == null) continue;
      const next = partition.next;
      let cursor = range[0];
      while (true) {
        bitset.set(cursor);
        if (cursor === range[1]) break;
        cursor = next[cursor];
      }
    }
    return bitset;
  });

  /** Provides timestamp range filter bitset based on the most recent consumed result. */
  const timestampBitset = os.derive<BitSet | null>(() => {
    const result = latestResult();
    const { capacity, timestamp } = stream();
    const ts = timestampFilter();
    if (ts == null || result == null) return null;
    const bitset = new BitSet(capacity);
    const [lo, hi] = ts;
    let range = timestamp.range(lo, hi);
    if (range == null) return bitset;
    const next = timestamp.next;
    let cursor = range[0];
    while (true) {
      bitset.set(cursor);
      if (cursor === range[1]) break;
      cursor = next[cursor];
    }
    return bitset;
  });

  /** Used in derive below. Search bitset retains reference but internal value keeps changing */
  const alwaysNotEqual = () => false;
  const searchBitset = os.derive<BitSet | null>(() => textFilter()?.bitset ?? null, alwaysNotEqual);

  /** Single bitset that represents the intersection of all currently applied filters. */
  const bitset = os.derive(() => {
    const partition = partitionBitset();
    const timestamp = timestampBitset();
    const search = searchBitset();
    let result: BitSet | null = null;
    for (const bitset of [partition, timestamp, search]) {
      if (bitset == null) continue;
      result = result == null ? bitset.copy() : result.intersection(bitset);
    }
    return result;
  });

  const histogram = os.derive(() => {
    // update this derivative after new batch of messages is consumed
    latestResult();
    const ts = stream().timestamp;
    if (ts.size === 0) return null;

    // domain is defined by earliest and latest dates that are conveniently accessible via skiplist
    const d0 = ts.getValue(ts.tail)!;
    const d1 = ts.getValue(ts.head)!;
    // following generates uniform ticks that are always between the domain extent
    const uniformTicks = utcTicks(new Date(d0), new Date(d1), 70).map((v) => v.valueOf());
    let left = 0;
    let right = uniformTicks.length;
    while (uniformTicks.length > 0 && uniformTicks.at(left)! <= d0) left++;
    while (uniformTicks.length > 0 && uniformTicks.at(right - 1)! > d1) right--;
    let ticks = left < right ? uniformTicks.slice(left, right) : uniformTicks;
    if (ticks.length === 0) return null;

    /* Following algorithm counts number of records per each bin (aka histogram).
    Bins are formed by uniformly distributed ticks which are timestamps between
    oldest and newest timestamps:
        lo • tick • • • tick • • • tick • • • tick • • hi
    Bins have inclusive left boundary and right exclusive boundary. The last bin has
    right inclusive. For each bin we need to count total number of records along
    with number of records that satisfy currently applied filter.
    Timestamp skiplist has descending order, so `head` means newest and `tail` means
    oldest. Iterating from `head`, for each tick we find the insertion point (like
    bisect left) in the skiplist and count number of records between the point and
    the one we used in previous iteration. */
    const bits = bitset();
    const includes = bits != null ? bits.predicate() : () => false;
    const bins: { x0: number; x1: number; total: number; filter: number | null }[] = [];
    const limit = ticks.length;
    let ahead = ts.head;
    for (let i = limit; i >= 0; i--) {
      const tick = i === 0 ? 0 : ticks[i - 1];
      const curr = i === 0 ? ts.tail : ts.find((p) => ts.getValue(p)! <= tick)!;
      const notEmptyBin = ts.getValue(curr)! <= (ticks[i] ?? d1.valueOf());
      let total = 0;
      let filter = 0;
      if (notEmptyBin) {
        let next = ahead;
        // account for inclusive final bin
        if (i === limit) {
          total++;
          if (includes(next)) filter++;
        }
        if (next !== curr) {
          do {
            total++;
            // avoid counting the right bin boundary, it is covered by the next bin
            if (next !== ahead && includes(next)) filter++;
            next = ts.next[next];
          } while (next !== curr);
          // make sure to count the left bin boundary
          if (includes(curr)) filter++;
        }
      }
      ahead = curr;
      const x0 = i === 0 ? d0 : ticks[i - 1];
      const x1 = i === limit ? d1 : ticks[i];
      bins.unshift({ x0, x1, total, filter: bits != null ? filter : null });
    }

    return bins;
  });

  let queue: PartitionConsumeRecord[] = [];
  function flushMessages(stream: Stream) {
    const search = os.peek(textFilter);
    while (queue.length > 0) {
      /* Pick messages from the queue one by one since we may stop putting 
      them into stream but we don't want to drop the rest. */
      const message = queue.shift()!;

      /* New messages inserted into the stream instance and its index is
      stored for further processing by existing filters. */
      const index = stream.insert(message);

      if (search != null) {
        if (includesSubstring(message, search.regexp)) {
          search.bitset.set(index);
        } else {
          search.bitset.unset(index);
        }
        searchBitset(search.bitset);
      }

      /* For the first time when the stream reaches defined capacity, we pause 
      consumption so the user can work with exact data they expected to consume.
      They still can resume the stream back to get into "windowed" mode. */
      if (!os.peek(isStreamFull) && stream.size >= stream.capacity) {
        isStreamFull(true);
        state("paused");
        timer((timer) => timer.pause());
        break;
      }
    }
  }
  function dropQueue() {
    queue = [];
  }

  os.watch(async (signal) => {
    /* Cannot proceed any further if state got paused by the user or other
    events. If the state changes, this watcher is notified once again. */
    if (state() !== "running") return;

    try {
      const currentStream = stream();
      const partitions = partitionConsumed();
      /* If current parameters were already used for successful request, the
      following request should consider offsets provided in previous results. */
      const requestParams = getOffsets(params(), latestResult(), partitions);
      /* Delegate an API call to shared scheduler. */
      const result = await schedule(() => consume(requestParams, signal), signal);

      const datalist = result.partition_data_list ?? [];
      for (const partition of datalist) {
        /* The very first request always going to include messages from all
        partitions. If we consume a subset of partitions, some messages need
        to be dropped. */
        if (partitions != null && !partitions.includes(partition.partition_id!)) continue;
        /* The messages that we _do_ process, are pushed to the queue, which
        then processes messages and puts them to the stream on its own pace. */
        const records = partition.records ?? [];
        for (const message of records) queue.push(message);
      }

      /* Update the state and notify the UI about another successful request processed. */
      os.batch(() => {
        flushMessages(currentStream);
        latestResult(result);
        latestError(null);
        notifyUI();
      });
    } catch (error) {
      let reportable: { message: string } | null = null;
      let shouldPause = false;
      /* Async operations can be aborted by provided AbortController that is
      controlled by the watcher. Nothing to log in this case. */
      if (error instanceof Error && error.name === "AbortError") return;
      /* In case of network issue, the current assumption is that the user is
      going to see auth related error alerts. Logging and error displays is WIP. */
      if (error instanceof ResponseError) {
        const payload = await error.response.json();
        // FIXME: this response error coming from the middleware that has to be present to avoid openapi error about missing middlewares
        if (!payload?.aborted) {
          const status = error.response.status;
          shouldPause = status >= 400;
          switch (status) {
            case 401: {
              reportable = { message: "Authentication required." };
              break;
            }
            case 403: {
              reportable = { message: "Insufficient permissions to read from topic." };
              break;
            }
            case 404: {
              if (String(payload?.title).startsWith("Error fetching the messages")) {
                reportable = { message: "Topic not found." };
              } else {
                reportable = { message: "Unable to connect to the server." };
              }
              break;
            }
            case 429: {
              reportable = { message: "Too many requests. Try again later." };
              break;
            }
            default: {
              reportable = { message: "Something went wrong." };
              break;
            }
          }
          logger.error(
            `An error occurred during messages consumption. Status ${error.response.status}`,
          );
        }
      } else if (error instanceof Error) {
        logger.error(error.message);
        reportable = { message: "An internal error occurred." };
        shouldPause = true;
      }

      os.batch(() => {
        // in case of 4xx error pause the stream since we most likely won't be able to continue consuming
        if (shouldPause) {
          state("paused");
          timer((timer) => timer.pause());
        }
        if (reportable != null) {
          latestError(reportable);
        }
        notifyUI();
      });
    }
  });

  function processMessage(...[type, body]: Parameters<MessageSender>) {
    switch (type) {
      case "GetMessages": {
        const offset = body.page * body.pageSize;
        const limit = body.pageSize;
        const includes = bitset()?.predicate() ?? (() => true);
        const { results, indices } = stream().slice(offset, limit, includes);
        const messages = results.map(({ partition_id, offset, timestamp, key, value }) => {
          key = truncate(key);
          value = truncate(value);
          return { partition_id, offset, timestamp, key, value };
        });
        return { indices, messages } satisfies MessageResponse<"GetMessages">;
      }
      case "GetMessagesCount": {
        return {
          total: stream().messages.size,
          filter: bitset()?.count() ?? null,
        } satisfies MessageResponse<"GetMessagesCount">;
      }
      case "GetMessagesExtent": {
        const { timestamp } = stream();
        return (
          timestamp.size > 0
            ? [timestamp.getValue(timestamp.tail)!, timestamp.getValue(timestamp.head)!]
            : null
        ) satisfies MessageResponse<"GetMessagesExtent">;
      }
      case "GetPartitionStats": {
        return partitionApi
          .listKafkaPartitions({ cluster_id: topic.clusterId, topic_name: topic.name })
          .then((v) => v.data) satisfies Promise<MessageResponse<"GetPartitionStats">>;
      }
      case "GetConsumedPartitions": {
        return partitionConsumed() satisfies MessageResponse<"GetConsumedPartitions">;
      }
      case "GetFilteredPartitions": {
        return partitionFilter() satisfies MessageResponse<"GetFilteredPartitions">;
      }
      case "GetMaxSize": {
        return String(stream().capacity) satisfies MessageResponse<"GetMaxSize">;
      }
      case "GetStreamState": {
        return state() satisfies MessageResponse<"GetStreamState">;
      }
      case "GetStreamError": {
        return latestError() satisfies MessageResponse<"GetStreamError">;
      }
      case "GetStreamTimer": {
        return timer() satisfies MessageResponse<"GetStreamTimer">;
      }
      case "GetHistogram": {
        return histogram() satisfies MessageResponse<"GetHistogram">;
      }
      case "GetSelection": {
        return timestampFilter() satisfies MessageResponse<"GetSelection">;
      }
      case "GetSearchSource": {
        const search = textFilter();
        return (search?.regexp.source ?? null) satisfies MessageResponse<"GetSearchSource">;
      }
      case "GetSearchQuery": {
        const search = textFilter();
        return (search?.query ?? "") satisfies MessageResponse<"GetSearchQuery">;
      }
      case "PreviewMessageByIndex": {
        track({ action: "preview-message" });
        const { messages, serialized } = stream();
        const index = body.index;
        const message = messages.at(index);
        const payload = prepare(
          message,
          serialized.key.includes(index),
          serialized.value.includes(index),
        );

        // i want to drop the comment in favor of filename and possibly do a preview tab
        workspace
          .openTextDocument({
            content: `// message ${message.key} from ${topic.name}\n${JSON.stringify(payload, null, 2)}`,
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
      case "PreviewJSON": {
        track({ action: "preview-snapshot" });
        const {
          timestamp,
          messages: { values },
          serialized,
        } = stream();
        const includes = bitset()?.predicate() ?? (() => true);
        const records: string[] = [];
        for (
          let i = 0, p = timestamp.head, payload;
          i < timestamp.size;
          i++, p = timestamp.next[p]
        ) {
          if (includes(p)) {
            payload = prepare(values[p], serialized.key.includes(p), serialized.value.includes(p));
            records.push("\t" + JSON.stringify(payload));
          }
        }
        const content = `[\n${records.join(",\n")}\n]`;
        workspace.openTextDocument({ content, language: "jsonc" }).then((preview) => {
          return window.showTextDocument(preview, {
            preview: false,
            viewColumn: ViewColumn.Beside,
            preserveFocus: false,
          });
        });
        return null satisfies MessageResponse<"PreviewJSON">;
      }
      case "SearchMessages": {
        track({ action: "search" });
        if (body.search != null) {
          const { capacity, messages } = stream();
          const values = messages.values;
          const bitset = new BitSet(capacity);
          const escaped = body.search
            .trim()
            // escape characters used by regexp itself
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            // 1. make existing whitespaces in query optional
            // 2. add optional whitespaces at word boundaries
            .replace(/\s+|\b/g, "\\s*");
          const regexp = new RegExp(escaped, "i");
          for (let i = 0; i < values.length; i++) {
            if (includesSubstring(values[i], regexp)) {
              bitset.set(i);
            }
          }
          textFilter({ bitset, regexp, query: body.search });
        } else {
          textFilter(null);
        }
        notifyUI();
        return null satisfies MessageResponse<"SearchMessages">;
      }
      case "StreamPause": {
        state("paused");
        timer((timer) => timer.pause());
        notifyUI();
        return null satisfies MessageResponse<"StreamPause">;
      }
      case "StreamResume": {
        state("running");
        timer((timer) => timer.resume());
        notifyUI();
        return null satisfies MessageResponse<"StreamResume">;
      }
      case "ConsumeModeChange": {
        track({ action: "consume-mode-change" });
        mode(body.mode);
        const maxPollRecords = Math.min(DEFAULT_MAX_POLL_RECORDS, os.peek(stream).capacity);
        params(getParams(body.mode, body.timestamp, maxPollRecords));
        stream((value) => new Stream(value.capacity));
        isStreamFull(false);
        textFilter((value) => {
          return value != null ? { ...value, bitset: new BitSet(value.bitset.capacity) } : null;
        });
        state("running");
        timer((timer) => timer.reset());
        latestResult(null);
        partitionFilter(null);
        timestampFilter(null);
        dropQueue();
        notifyUI();
        return null satisfies MessageResponse<"ConsumeModeChange">;
      }
      case "PartitionConsumeChange": {
        track({ action: "consume-partition-change" });
        partitionConsumed(body.partitions);
        const maxPollRecords = Math.min(DEFAULT_MAX_POLL_RECORDS, os.peek(stream).capacity);
        params((value) => getParams(os.peek(mode), value.timestamp, maxPollRecords));
        stream((value) => new Stream(value.capacity));
        isStreamFull(false);
        textFilter((value) => {
          return value != null ? { ...value, bitset: new BitSet(value.bitset.capacity) } : null;
        });
        state("running");
        timer((timer) => timer.reset());
        latestResult(null);
        partitionFilter(null);
        timestampFilter(null);
        dropQueue();
        notifyUI();
        return null satisfies MessageResponse<"PartitionConsumeChange">;
      }
      case "PartitionFilterChange": {
        track({ action: "filter-partition-change" });
        partitionFilter(body.partitions);
        notifyUI();
        return null satisfies MessageResponse<"PartitionFilterChange">;
      }
      case "TimestampFilterChange": {
        debouncedTrack({ action: "filter-timestamp-change" });
        timestampFilter(body.timestamps);
        notifyUI();
        return null satisfies MessageResponse<"TimestampFilterChange">;
      }
      case "MessageLimitChange": {
        track({ action: "consume-message-limit-change" });
        const maxPollRecords = Math.min(DEFAULT_MAX_POLL_RECORDS, body.limit);
        params((value) => getParams(os.peek(mode), value.timestamp, maxPollRecords));
        stream(new Stream(body.limit));
        isStreamFull(false);
        textFilter((value) => {
          return value != null ? { ...value, bitset: new BitSet(body.limit) } : null;
        });
        state("running");
        timer((timer) => timer.reset());
        latestResult(null);
        partitionFilter(null);
        timestampFilter(null);
        dropQueue();
        notifyUI();
        return null satisfies MessageResponse<"MessageLimitChange">;
      }
    }
  }

  const handler = handleWebviewMessage(panel.webview, (...args) => {
    let result;
    os.batch(() => (result = processMessage(...args)));
    return result;
  });

  panel.onDidDispose(() => {
    handler.dispose();
    os.dispose();
  });
}

const logger = new Logger("consume");

/** Define basic consume params based on desired consume mode. */
function getParams(
  mode: "beginning" | "latest" | "timestamp",
  timestamp: number | undefined,
  max_poll_records: number,
): SimpleConsumeMultiPartitionRequest {
  return mode === "beginning"
    ? { ...DEFAULT_CONSUME_PARAMS, max_poll_records, from_beginning: true }
    : mode === "timestamp"
      ? { ...DEFAULT_CONSUME_PARAMS, max_poll_records, timestamp }
      : { ...DEFAULT_CONSUME_PARAMS, max_poll_records };
}

/** Compute partition offsets for the next consume request, based on response of the previous one. */
function getOffsets(
  params: SimpleConsumeMultiPartitionRequest,
  results: SimpleConsumeMultiPartitionResponse | null,
  partitions: number[] | null,
): SimpleConsumeMultiPartitionRequest {
  if (results?.partition_data_list != null) {
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

/** Compress any valid json value into smaller payload for preview purpose. */
function truncate(value: any): any {
  if (value == null) return null;
  if (typeof value === "object") {
    value = JSON.stringify(value, null, " ");
  }
  if (typeof value === "string" && value.length > 1024) {
    return value.slice(0, 256) + " ... " + value.slice(-256);
  }
  return value;
}

function prepare(
  message: PartitionConsumeRecord,
  keySerialized: boolean,
  valueSerialized: boolean,
) {
  let key, value;

  try {
    key = keySerialized ? JSON.parse(message.key as any) : message.key;
  } catch {
    key = message.key;
  }

  try {
    value = valueSerialized ? JSON.parse(message.value as any) : message.value;
  } catch {
    value = message.value;
  }
  const { partition_id, offset, timestamp, headers } = message;

  return { partition_id, offset, timestamp, headers, key, value };
}

/**
 * Basic timer structure with pause/resume functionality.
 * Uses `Date.now()` for time tracking.
 */
class Timer extends Data {
  start = Date.now();
  offset = 0;
  pause(this: Timer) {
    const now = Date.now();
    return this.copy({ start: now, offset: now - this.start + this.offset });
  }
  resume(this: Timer) {
    return this.copy({ start: Date.now() });
  }
  reset(this: Timer) {
    return this.copy({ start: Date.now(), offset: 0 });
  }
}

function track(details: object) {
  getTelemetryLogger().logUsage("Message Viewer Action", details);
}

let timer: ReturnType<typeof setTimeout>;
function debouncedTrack(details: object) {
  clearTimeout(timer);
  timer = setTimeout(track, 200, details);
}
