import * as Sentry from "@sentry/node";
import { utcTicks } from "d3-time";
import { Data } from "dataclass";
import { ObservableScope } from "inertial";
import {
  commands,
  env,
  ExtensionContext,
  languages,
  Uri,
  ViewColumn,
  WebviewPanel,
  window,
} from "vscode";
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
import { LOCAL_CONNECTION_ID } from "./constants";
import { getExtensionContext } from "./context/extension";
import { MessageDocumentProvider } from "./documentProviders/message";
import {
  CCloudResourceLoader,
  DirectResourceLoader,
  LocalResourceLoader,
  ResourceLoader,
} from "./loaders";
import { Logger } from "./logging";
import { ConnectionId } from "./models/resource";
import { type KafkaTopic } from "./models/topic";
import { kafkaClusterQuickPick } from "./quickpicks/kafkaClusters";
import { topicQuickPick } from "./quickpicks/topics";
import { scheduler } from "./scheduler";
import { getSidecar, type SidecarHandle } from "./sidecar";
import { BitSet, includesSubstring, Stream } from "./stream/stream";
import { hashed, logUsage, UserEvent } from "./telemetry/events";
import { WebviewPanelCache } from "./webview-cache";
import { handleWebviewMessage } from "./webview/comms/comms";
import { type post } from "./webview/message-viewer";
import messageViewerTemplate from "./webview/message-viewer.html";

const logger = new Logger("consume");

export function activateMessageViewer(context: ExtensionContext) {
  /* All active message viewer instances share the same scheduler to perform API
  requests. The scheduler defines number of concurrent requests at a time and a
  minimum time interval for a single task to unblock a "thread". This all allows
  faster consumption of retained messages for a single message viewer and prevents
  rate limiting for multiple active message viewers. */
  const schedule = scheduler(4, 500);

  /* We track active topic as a kafka topic of a webview panel that is currently
  visible on the screen. When the user clicks on Duplicate Message Browser action
  at the top of the window, we can use the topic entity to start another message
  viewer with the same topic. Otherwise, we use webview panel cache to only keep
  a single active message browser per topic. */
  let activeTopic: KafkaTopic | null = null;
  let activeConfig: MessageViewerConfig | null = null;
  const cache = new WebviewPanelCache();

  // commands
  context.subscriptions.push(
    // the consume command is available in topic tree view's item actions
    registerCommandWithLogging(
      "confluent.topic.consume",
      async (topic?: KafkaTopic, duplicate = false, config = MessageViewerConfig.create()) => {
        if (topic == null) {
          const cluster = await kafkaClusterQuickPick();
          if (cluster == null) return;
          topic = await topicQuickPick(cluster);
          if (topic == null) return;
        }

        if (!(await canAccessSchemaForTopic(topic))) {
          showNoSchemaAccessWarningNotification();
        }
        const sidecar = await getSidecar();

        // this panel going to be active, so setting its topic to the currently active
        activeTopic = topic;
        activeConfig = config;
        const [panel, cached] = cache.findOrCreate(
          {
            id: `${topic.clusterId}/${topic.name}`,
            multiple: duplicate,
            template: messageViewerTemplate,
          },
          "message-viewer",
          `Topic: ${topic.name}`,
          ViewColumn.One,
          { enableScripts: true },
        );

        if (cached) {
          panel.reveal();
        } else {
          panel.onDidChangeViewState((e) => {
            // whenever we switch between panels, override active topic and config
            if (e.webviewPanel.active) {
              activeTopic = topic;
              activeConfig = config;
            }
          });

          messageViewerStartPollingCommand(
            panel,
            config,
            (value) => (activeConfig = config = value),
            topic,
            sidecar,
            schedule,
          );
        }
      },
    ),
    registerCommandWithLogging("confluent.topic.consume.duplicate", async () => {
      if (activeTopic != null) {
        commands.executeCommand("confluent.topic.consume", activeTopic, true);
      }
    }),
    registerCommandWithLogging("confluent.topic.consume.getUri", async () => {
      if (activeTopic == null || activeConfig == null) return;
      const query = activeConfig.toQuery();
      query.set("origin", activeTopic.connectionType.toLowerCase());
      // CCloud will have unique env IDs; local and direct will use their connection IDs
      query.set("envId", activeTopic.environmentId);
      query.set("clusterId", activeTopic.clusterId);
      query.set("topicName", activeTopic.name);
      const context = getExtensionContext();
      const uri = Uri.from({
        scheme: "vscode",
        authority: context.extension.id,
        path: "/consume",
        query: query.toString(),
      });
      await env.clipboard.writeText(uri.toString());
    }),
    registerCommandWithLogging("confluent.topic.consume.fromUri", async (uri: Uri) => {
      const params = new URLSearchParams(uri.query);
      const origin = params.get("origin");
      let envId = params.get("envId");
      const clusterId = params.get("clusterId");
      const topicName = params.get("topicName");
      if (clusterId == null || topicName == null) {
        return window.showErrorMessage("Unable to open Message Viewer: URI is malformed");
      }
      if (origin === "local" && !envId) {
        // backwards compatibility for old URIs before we started using local env IDs
        envId = LOCAL_CONNECTION_ID;
      }

      // we need to look up which ResourceLoader is responsible for the resources, whether they were
      // cached or need to be fetched from the sidecar
      let loader: ResourceLoader;
      switch (origin) {
        case "ccloud":
          loader = CCloudResourceLoader.getInstance();
          break;
        case "local":
          loader = LocalResourceLoader.getInstance();
          break;
        case "direct":
          // direct connections' env IDs are the same as their connection IDs
          if (envId == null) {
            return window.showErrorMessage("Unable to open Message Viewer: URI is malformed");
          }
          loader = DirectResourceLoader.getInstance(envId! as ConnectionId);
          break;
        default:
          return window.showErrorMessage("Unable to open Message Viewer: URI is malformed");
      }

      if (envId == null) {
        return window.showErrorMessage("Unable to open Message Viewer: URI is malformed");
      }
      const cluster = (await loader.getKafkaClustersForEnvironmentId(envId)).find(
        (cluster) => cluster.id === clusterId,
      );
      if (cluster == null) {
        return window.showErrorMessage("Unable to open Message Viewer: cluster not found");
      }
      const topics = await loader.getTopicsForCluster(cluster);
      if (topics == null) {
        return window.showErrorMessage("Unable to open Message Viewer: can't load topics");
      }
      const topic = topics.find((topic) => topic.name === topicName);
      if (topic == null) {
        return window.showErrorMessage("Unable to open Message Viewer: topic not found");
      }
      const config = MessageViewerConfig.fromQuery(params);
      commands.executeCommand("confluent.topic.consume", topic, true, config);
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
  panel: WebviewPanel,
  config: MessageViewerConfig,
  onConfigChange: (config: MessageViewerConfig) => void,
  topic: KafkaTopic,
  sidecar: SidecarHandle,
  schedule: <T>(cb: () => Promise<T>, signal?: AbortSignal) => Promise<T>,
) {
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
  const mode = os.signal<"beginning" | "latest" | "timestamp">(config.consumeMode);

  // TODO build params object from config
  /** Parameters used by Consume API. */
  const params = os.signal<SimpleConsumeMultiPartitionRequest>(
    config.consumeMode === "latest"
      ? DEFAULT_CONSUME_PARAMS
      : config.consumeMode === "timestamp" && config.consumeTimestamp != null
        ? { ...DEFAULT_CONSUME_PARAMS, timestamp: config.consumeTimestamp }
        : { ...DEFAULT_CONSUME_PARAMS, from_beginning: true },
  );
  /** List of currently consumed partitions. `null` for all partitions. */
  const partitionConsumed = os.signal<number[] | null>(config.partitionConsumed);
  /** List of currently filtered partitions. `null` for all consumed partitions. */
  const partitionFilter = os.signal<number[] | null>(config.partitionFilter);
  /** Filter by range of timestamps. `null` for all consumed messages. */
  const timestampFilter = os.signal<[number, number] | null>(config.timestampFilter);
  /** Filter by substring text query. Persists bitset instead of computing it. */
  const textFilter = os.signal<{ bitset: BitSet; regexp: RegExp; query: string } | null>(
    config.textFilter != null ? getTextFilterParams(config.textFilter, config.messageLimit) : null,
  );
  /** The stream instance that holds consumed messages and index them by timestamp and partition. */
  const stream = os.signal(new Stream(config.messageLimit));
  /**
   * A boolean that indicates if the stream reached its capacity.
   * Continuing consumption after this means overriding oldest messages.
   */
  const isStreamFull = os.signal(false);

  /** Most recent response payload from Consume API. */
  const latestResult = os.signal<SimpleConsumeMultiPartitionResponse | null>(null);
  /** Most recent failure info */
  const latestError = os.signal<{ message: string } | null>(null);

  /** Wrapper for `panel.visible` that gracefully switches to `false` when panel is disposed. */
  const panelActive = os.produce(true, (value, signal) => {
    const disposed = panel.onDidDispose(() => value(false));
    const changedState = panel.onDidChangeViewState(() => value(panel.visible));
    signal.onabort = () => (disposed.dispose(), changedState.dispose());
  });

  /** Notify an active webview only after flushing the rest of updates. */
  const notifyUI = () => {
    queueMicrotask(() => {
      if (panelActive()) panel.webview.postMessage(["Timestamp", "Success", Date.now()]);
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
      const curr = i === 0 ? ts.tail : ts.find((p) => ts.getValue(p)! <= tick);
      const notEmptyBin = curr != null && ts.getValue(curr)! <= (ticks[i] ?? d1.valueOf());
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
          let max = ts.size;
          do {
            total++;
            // avoid counting the right bin boundary, it is covered by the next bin
            if (next !== ahead && includes(next)) filter++;
            next = ts.next[next];
          } while (max-- > 0 && next !== curr);
          // make sure to count the left bin boundary
          if (includes(curr)) filter++;
        }
      }
      if (curr != null) ahead = curr;
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

  os.watch(() => {
    // update config structure and send it back to the parent scope
    onConfigChange(
      config.copy({
        consumeMode: mode(),
        consumeTimestamp: params().timestamp,
        messageLimit: stream().capacity,
        partitionConsumed: partitionConsumed(),
        partitionFilter: partitionFilter(),
        timestampFilter: timestampFilter(),
        textFilter: textFilter()?.query ?? null,
      }),
    );
  });

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
              Sentry.captureException(error, { extra: { status, payload } });
              window
                .showErrorMessage("Error response while consuming messages.", "Open Logs")
                .then((action) => {
                  if (action === "Open Logs") {
                    commands.executeCommand("confluent.showSidecarOutputChannel");
                  }
                });
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
        const messages = results.map(
          ({ partition_id, offset, timestamp, key, value, metadata }) => {
            key = truncate(key);
            value = truncate(value);
            return { partition_id, offset, timestamp, key, value, metadata };
          },
        );
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
      case "GetConsumeMode": {
        return mode() satisfies MessageResponse<"GetConsumeMode">;
      }
      case "GetConsumeModeTimestamp": {
        return (params().timestamp ?? null) satisfies MessageResponse<"GetConsumeModeTimestamp">;
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

        // use a single-instance provider to display a read-only document buffer with the message
        // content
        const filename = `${topic.name}-message-${index}.json`;
        const provider = new MessageDocumentProvider();
        MessageDocumentProvider.message = JSON.stringify(payload, null, 2);
        // this is really only used for the filename:
        const uri: Uri = provider.resourceToUri(
          { partition: payload.partition_id, offset: payload.offset },
          filename,
        );
        window
          .showTextDocument(uri, {
            preview: true,
            viewColumn: ViewColumn.Beside,
            preserveFocus: false,
          })
          .then((editor) => {
            languages.setTextDocumentLanguage(editor.document, "json");
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
        // use a single-instance provider to display a read-only document buffer with the messages
        // at the given timestamp, so the document isn't reused across multiple previews
        const filename = `${topic.name}-messages-${new Date().getTime()}.json`;
        const provider = new MessageDocumentProvider();
        MessageDocumentProvider.message = `[\n${records.join(",\n")}\n]`;
        // this is really only used for the filename:
        const uri: Uri = provider.resourceToUri({ partition: -1, offset: -1 }, filename);
        window
          .showTextDocument(uri, {
            preview: true,
            viewColumn: ViewColumn.Beside,
            preserveFocus: false,
          })
          .then((editor) => {
            languages.setTextDocumentLanguage(editor.document, "json");
          });
        return null satisfies MessageResponse<"PreviewJSON">;
      }
      case "SearchMessages": {
        track({ action: "search" });
        if (body.search != null) {
          const { capacity, messages } = stream();
          const values = messages.values;
          const filter = getTextFilterParams(body.search, capacity);
          for (let i = 0; i < values.length; i++) {
            if (includesSubstring(values[i], filter.regexp)) {
              filter.bitset.set(i);
            }
          }
          textFilter(filter);
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

  type TrackAction = {
    action: string;
  };

  /** Send a telemetry event. Will implicily include information about the topic/cluster. */
  function track(details: TrackAction) {
    const augmentedDetails = {
      action: details.action,
      connection_type: topic.connectionType,
      connection_id: topic.connectionId,
      environment_id: topic.environmentId,
      cluster_id: topic.clusterId,
      topic_hash: hashed(topic.name),
    };

    logUsage(UserEvent.MessageViewerAction, augmentedDetails);
  }

  let debounceTimer: ReturnType<typeof setTimeout>;

  /** 200ms debounced sending a telemetry event. */
  function debouncedTrack(details: TrackAction) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(track, 200, details);
  }

  // End of new message viewer setup. Send a telemetry event when the message viewer is opened!
  track({
    action: "message-viewer-open",
  });
}

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

function getTextFilterParams(query: string, capacity: number) {
  const bitset = new BitSet(capacity);
  const escaped = query
    .trim()
    // escape characters used by regexp itself
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    // 1. make existing whitespaces in query optional
    // 2. add optional whitespaces at word boundaries
    .replace(/\s+|\b/g, "\\s*");
  const regexp = new RegExp(escaped, "i");
  return { bitset, regexp, query };
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
  const { partition_id, offset, timestamp, headers, metadata } = message;

  return { partition_id, offset, timestamp, headers, key, value, metadata };
}

/**
 * Represents static snapshot of message viewer state that can be serialized.
 * Provides static method to deserialize the snapshot from a URI's query.
 */
export class MessageViewerConfig extends Data {
  consumeMode: "beginning" | "latest" | "timestamp" = "beginning";
  consumeTimestamp: number | null = null;
  partitionConsumed: number[] | null = null;
  messageLimit: number = DEFAULT_RECORDS_CAPACITY;
  partitionFilter: number[] | null = null;
  timestampFilter: [number, number] | null = null;
  textFilter: string | null = null;

  static fromQuery(params: URLSearchParams) {
    let value: string | null;
    let config: Partial<MessageViewerConfig> = {};

    value = params.get("consumeMode");
    if (value != null && ["beginning", "latest", "timestamp"].includes(value)) {
      config.consumeMode = value as "beginning" | "latest" | "timestamp";
    }

    value = params.get("consumeTimestamp");
    if (value != null) {
      const parsed = parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        config.consumeTimestamp = parsed;
      }
    }

    value = params.get("partitionConsumed");
    if (value != null) {
      try {
        const parsed = JSON.parse(`[${value}]`) as unknown[];
        if (parsed.every((v): v is number => typeof v === "number")) {
          config.partitionConsumed = parsed;
        }
      } catch {
        // do nothing, fallback to default
      }
    }

    value = params.get("messageLimit");
    if (value != null) {
      const parsed = parseInt(value, 10);
      if (!Number.isNaN(parsed) && [1_000_000, 100_000, 10_000, 1_000, 100].includes(parsed)) {
        config.messageLimit = parsed;
      }
    }

    value = params.get("partitionFilter");
    if (value != null) {
      try {
        const parsed = JSON.parse(`[${value}]`) as unknown[];
        if (parsed.every((v): v is number => typeof v === "number")) {
          config.partitionFilter = parsed;
        }
      } catch {
        // do nothing, fallback to default
      }
    }

    value = params.get("timestampFilter");
    if (value != null) {
      try {
        const parsed = JSON.parse(`[${value}]`) as unknown[];
        if (parsed.length === 2 && parsed.every((v): v is number => typeof v === "number")) {
          config.timestampFilter = parsed as [number, number];
        }
      } catch {
        // do nothing, fallback to default
      }
    }

    value = params.get("textFilter");
    if (value != null) {
      config.textFilter = value;
    }

    return MessageViewerConfig.create(config);
  }

  toQuery(): URLSearchParams {
    const params = new URLSearchParams();

    for (let key in this) {
      const value = this[key];
      if (value != null) {
        params.set(key, value.toString());
      }
    }

    return params;
  }
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
