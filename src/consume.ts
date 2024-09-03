import { randomBytes } from "crypto";
import { ObservableScope } from "inertial";
import { ExtensionContext, Uri, ViewColumn, window, workspace } from "vscode";
import { type KafkaTopic } from "./models/topic";
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
import { type SidecarHandle, getSidecar } from "./sidecar";
import { BitSet, Stream, includesSubstring } from "./stream/stream";
import { handleWebviewMessage } from "./webview/comms/comms";

export function activateMessageViewer(context: ExtensionContext) {
  // commands
  context.subscriptions.push(
    // the consume command is available in topic tree view's item actions
    registerCommandWithLogging("confluent.topic.consume", async (topic: KafkaTopic) => {
      const sidecar = await getSidecar();
      return messageViewerStartPollingCommand(context, topic, sidecar);
    }),
  );
}

type MessageSender = OverloadUnion<typeof post>;
type MessageResponse<MessageType extends string> = Awaited<
  ReturnType<Extract<MessageSender, (type: MessageType, body: any) => any>>
>;

const DEFAULT_MAX_POLL_RECORDS = 250;
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
  const textFilter = os.signal<{ bitset: BitSet; regexp: RegExp } | null>(null);
  /** The stream instance that holds consumed messages and index them by timestamp and partition. */
  const stream = os.signal(new Stream(DEFAULT_RECORDS_CAPACITY));
  /**
   * A boolean that indicates if the stream reached its capacity.
   * Continuing consumption after this means overriding oldest messages.
   */
  const isStreamFull = os.signal(false);

  /** Index of the latest inserted message in the stream. */
  const latestInsert = os.signal<number>(-1);
  /** Most recent response payload from Consume API. */
  const latestResult = os.signal<SimpleConsumeMultiPartitionResponse | null>(null);
  /** Most recent failure info */
  const latestError = os.signal<string[] | null>(null);
  /** Timestamp of the most recent successful consumption request. */
  const latestFetch = os.signal<number>(0);

  /** Notify the webview only after flushing the rest of updates. */
  const notifyUI = () => {
    queueMicrotask(() => panel.webview.postMessage(["Timestamp", "Success", Date.now()]));
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
  /** Unlike partition and timestamp filter, keeps updating previously created bitset with latest messages added. */
  const searchBitset = os.derive<BitSet | null>(() => {
    // can i catch up here? maybe if I can track the cursor in the search object and compare to the stream size?
    const messageStream = stream();
    const search = textFilter();
    const index = latestInsert();
    if (search == null) return null;
    const { bitset, regexp } = search;
    const value = messageStream.messages.values[index];
    if (includesSubstring(value, regexp)) {
      bitset.set(index);
    } else {
      bitset.unset(index);
    }
    return bitset;
  }, alwaysNotEqual);

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

  os.watch(() => {
    /* This is the main consumption cycle. Every time input parameters change,
    any in-flight requests should be aborted. See this controller's references,
    it has to be passed to any async calls happening below. */
    const ctl = new AbortController();

    /* This functions is IIFE because os.watch() needs a sync function. Input
    parameters are all read in the same place to make sure no branches affect
    this watchers dependency list. */
    (async (streamParams, streamState, stream, partitions, prevResult, _timestamp) => {
      /* Cannot proceed any further if state got paused by the user or other
      events. If the state changes, this watcher is notified once again. */
      if (streamState !== "running") return;
      try {
        const now = Date.now();
        const old = os.peek(latestFetch);
        /* Ensure to wait at least some time before following polling request
        if at least one was already made. The condition below should allow for
        faster requests when the stream was resumed. */
        if (now - old < MIN_POLLING_INTERVAL_MS) await sleep(ctl.signal);

        /* If current parameters were already used for successful request, the
        following request should consider offsets provided in previous results. */
        const params = getOffsets(streamParams, prevResult, partitions);
        const result = await consume(params, ctl.signal);

        const datalist = result.partition_data_list ?? [];
        outer: for (const partition of datalist) {
          /* The very first request always going to include messages from all
          partitions. If we consume a subset of partitions, some messages need
          to be dropped. */
          if (partitions != null && !partitions.includes(partition.partition_id!)) continue;

          const records = partition.records ?? [];
          for (const message of records) {
            /* New messages inserted into the stream instance and its index is
            stored for further processing by existing filters. */
            const index = stream.insert(message);
            latestInsert(index);
            /* For the first time when the stream reaches defined capacity, we
            pause consumption so the user can work exactly with the batch they
            expected to consume.

            They still can resume the stream back to get into "windowed" mode. */
            if (!os.peek(isStreamFull) && stream.size >= stream.capacity) {
              os.batch(() => {
                isStreamFull(true);
                state("paused");
              });
              break outer;
            }
          }
        }

        /* After successful tracking of all new messages, store the payload and
        notify UI side to start re-rendering necessary pieces. */
        os.batch(() => {
          latestResult(result);
          latestFetch(Date.now());
          notifyUI();
        });
      } catch (error) {
        let reportable: any = null;
        /* Async operations can be aborted by provided AbortController that is
        controlled by the watcher. Nothing to log in this case. */
        if (error instanceof Error && error.name === "AbortError") return;
        /* In case of network issue, the current assumption is that the user is
        going to see auth related error alerts. Logging and error displays is WIP. */
        if (error instanceof ResponseError) {
          const payload = await error.response.json();
          // FIXME: this response error coming from the middleware that has to be present to avoid openapi error about missing middlewares
          if (!payload?.aborted) {
            reportable = JSON.stringify(payload);
            logger.error(
              `An error occurred during messages consumption. Status ${error.response.status}`,
            );
          }
        } else if (error instanceof Error) {
          logger.error(error.message);
          reportable = error.message;
        }

        os.batch(() => {
          latestFetch(Date.now());
          if (reportable != null) {
            latestError((errors) => {
              return errors == null ? [reportable] : [reportable].concat(errors).slice(0, 10);
            });
          }
          notifyUI();
        });
      }
    })(params(), state(), stream(), partitionConsumed(), latestResult(), latestFetch());

    return () => ctl.abort();
  });

  function processMessage(...[type, body]: Parameters<MessageSender>) {
    switch (type) {
      case "GetMessages": {
        const offset = body.page * body.pageSize;
        const limit = body.pageSize;
        const includes = bitset()?.predicate() ?? ((_: number) => true);
        const { results, indices } = stream().slice(offset, limit, includes);
        return {
          indices,
          messages: results.map(({ partition_id, offset, timestamp, key, value }) => {
            return { partition_id, offset, timestamp, key, value: truncate(value) };
          }),
        } satisfies MessageResponse<"GetMessages">;
      }
      case "GetMessagesCount": {
        return {
          total: stream().messages.size,
          filter: bitset()?.count() ?? null,
        } satisfies MessageResponse<"GetMessagesCount">;
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
      case "GetSearchSource": {
        const search = textFilter();
        return (search?.regexp.source ?? null) satisfies MessageResponse<"GetSearchSource">;
      }
      case "PreviewMessageByIndex": {
        const { messages } = stream();
        workspace
          .openTextDocument({
            content:
              `// message ${messages.at(body.index).key} from ${topic.name}\n` +
              JSON.stringify(messages.at(body.index), null, 2),
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
        const {
          timestamp,
          messages: { values },
        } = stream();
        const includes = bitset()?.predicate() ?? ((_: number) => true);
        const records: string[] = [];
        for (
          let i = 0, p = timestamp.head, payload;
          i < timestamp.size;
          i++, p = timestamp.next[p]
        ) {
          if (includes(p)) {
            payload = values[p];
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
          textFilter({ bitset, regexp });
        } else {
          textFilter(null);
        }
        notifyUI();
        return null satisfies MessageResponse<"SearchMessages">;
      }
      case "StreamPause": {
        state("paused");
        notifyUI();
        return null satisfies MessageResponse<"StreamPause">;
      }
      case "StreamResume": {
        state("running");
        notifyUI();
        return null satisfies MessageResponse<"StreamResume">;
      }
      case "ConsumeModeChange": {
        mode(body.mode);
        const maxPollRecords = Math.min(DEFAULT_MAX_POLL_RECORDS, os.peek(stream).capacity);
        params(getParams(body.mode, body.timestamp, maxPollRecords));
        stream((value) => new Stream(value.capacity));
        state("running");
        latestResult(null);
        partitionFilter(null);
        notifyUI();
        return null satisfies MessageResponse<"ConsumeModeChange">;
      }
      case "PartitionConsumeChange": {
        partitionConsumed(body.partitions);
        const maxPollRecords = Math.min(DEFAULT_MAX_POLL_RECORDS, os.peek(stream).capacity);
        params((value) => getParams(os.peek(mode), value.timestamp, maxPollRecords));
        stream((value) => new Stream(value.capacity));
        state("running");
        latestResult(null);
        partitionFilter(null);
        notifyUI();
        return null satisfies MessageResponse<"PartitionConsumeChange">;
      }
      case "PartitionFilterChange": {
        partitionFilter(body.partitions);
        notifyUI();
        return null satisfies MessageResponse<"PartitionFilterChange">;
      }
      case "MessageLimitChange": {
        const maxPollRecords = Math.min(DEFAULT_MAX_POLL_RECORDS, body.limit);
        params((value) => getParams(os.peek(mode), value.timestamp, maxPollRecords));
        stream(new Stream(body.limit));
        state("running");
        latestResult(null);
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

const MIN_POLLING_INTERVAL_MS = 2 * 1000;
const THRESHOLD_POLLING_INTERVAL_MS = 1 * 1000;

/**
 * Await for a variable time. A random threshold added to avoid syncing with
 * other consumers running in parallel. AbortSignal can be provided to abort
 * the timer, in case the following procedure should not be executed anyway.
 */
function sleep(signal: AbortSignal) {
  const delay = MIN_POLLING_INTERVAL_MS + THRESHOLD_POLLING_INTERVAL_MS * Math.random();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const abort = () => {
      clearTimeout(timer);
      const error = Object.assign(new Error(signal.reason), { name: "AbortError" });
      reject(error);
    };
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve(null);
    }, delay);
  });
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
