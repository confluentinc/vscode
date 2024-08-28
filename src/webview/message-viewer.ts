import { ObservableScope } from "inertial";
import { type PartitionData } from "../clients/kafkaRest";
import { type PartitionConsumeRecord } from "../clients/sidecar";
import { applyBindings } from "./bindings/bindings";
import { ViewModel } from "./bindings/view-model";
import { sendWebviewMessage } from "./comms/comms";

addEventListener("DOMContentLoaded", () => {
  const os = ObservableScope(queueMicrotask);
  const ui = document.querySelector("main")!;
  const vm = new MessageViewerViewModel(os);
  applyBindings(ui, os, vm);
});

type MessageCount = { total: number; filter: number | null };
type MessageLimitType = "1m" | "100k" | "10k" | "1k" | "100";

const messageLimitNumber: Record<MessageLimitType, number> = {
  "1m": 1_000_000,
  "100k": 100_000,
  "10k": 10_000,
  "1k": 1_000,
  "100": 100,
};

const messageLimitLabel: Record<string, MessageLimitType> = {
  1_000_000: "1m",
  100_000: "100k",
  10_000: "10k",
  1_000: "1k",
  100: "100",
};

type StreamState = "running" | "paused" | "errored";
type ConsumeMode = "latest" | "beginning" | "timestamp";

/**
 * Top level view model for Message Viewer. It composes shared state and logic
 * available for the UI. It also talks to the "backend": sends and receives
 * messages from the host environment that manages stream consumption.
 */
class MessageViewerViewModel extends ViewModel {
  /** This timestamp updates everytime the host environment wants UI to update. */
  timestamp = this.observe(
    () => Date.now(),
    (cb) => {
      function handle(event: MessageEvent<any[]>) {
        if (event.data[0] === "Timestamp") cb();
      }
      addEventListener("message", handle);
      return () => removeEventListener("message", handle);
    },
  );

  page = this.signal(0);
  pageSize = this.signal(100);

  /** Initial state of messages collection. Stored separately so we can use to reset state. */
  emptySnapshot = { messages: [] as PartitionConsumeRecord[], indices: [] as number[] };
  /**
   * Get a snapshot of messages from the host environment, whenever page is changed or
   * the stream is updated. The snapshot includes message records and list of original indices.
   */
  snapshot = this.resolve(() => {
    return post("GetMessages", {
      page: this.page(),
      pageSize: this.pageSize(),
      timestamp: this.timestamp(),
    });
  }, this.emptySnapshot);

  /** Information about the topic's partitions. */
  partitionStats = this.resolve(() => {
    return post("GetPartitionStats", {});
  }, []);
  /** List of currently consumed partitions. `null` for all partitions. */
  partitionsConsumed = this.resolve(() => {
    return post("GetConsumedPartitions", { timestamp: this.timestamp() });
  }, null);
  /** List of currently filtered partitions. `null` for all consumed partitions. */
  partitionsFiltered = this.resolve(() => {
    return post("GetFilteredPartitions", { timestamp: this.timestamp() });
  }, null);
  partitionsConsumedDescription = this.derive(() => {
    const consumed = this.partitionsConsumed();
    if (consumed == null) return "All partitions";
    if (consumed.length === 1) return `Partition ${consumed[0]}`;
    return `${consumed.length} partitions`;
  });
  partitionsFilteredDescription = this.derive(() => {
    const filtered = this.partitionsFiltered();
    const consumed = this.partitionsConsumed();
    const partitions = this.partitionStats();
    if (filtered == null) {
      if (consumed == null) return "All partitions";
      if (consumed.length === 1) return `Partition ${consumed[0]}`;
      return `${consumed.length} partitions`;
    }
    if (filtered.length === 1) return `Partition ${filtered[0]}`;
    if (consumed == null && filtered.length === partitions.length) return "All partitions";
    return `${filtered.length} partitions`;
  });
  /**
   * Check if the client-side partition filtering is possible:
   * 1. The viewer consumes all existing partitions
   *    1.1. The topic has more than 1 partition
   * 2. The number of partitions consumed greater than 1
   */
  canFilterPartition = this.derive(() => {
    const partitions = this.partitionsConsumed();
    const stats = this.partitionStats();
    return partitions == null ? stats.length > 1 : partitions.length > 1;
  });
  /**
   * List of partitions that can be filtered on the client side is a subset
   * of partitions currently consumed.
   */
  filterablePartitions = this.derive(() => {
    const all = this.partitionStats();
    const consumed = this.partitionsConsumed();
    return consumed == null ? all : all.filter((p) => consumed.includes(p.partition_id));
  });
  /** Signal used as temporary state for editing what partitions need to be consumed. */
  partitionsConsumedTemp = this.signal<number[] | null>(null);
  /** Determine whether the temporary state is different from the commited one. */
  partitionsConsumedSelectionPristine = this.derive(() => {
    const consumed = this.partitionsConsumed();
    const temp = this.partitionsConsumedTemp();
    if (consumed == null || temp == null) return temp === consumed;
    return consumed.length === temp.length && consumed.every((id) => temp.includes(id));
  });
  isPartitionIncluded(partitionId: number, partitions: number[] | null) {
    return partitions == null || partitions.includes(partitionId);
  }
  /** Should be used before the user attempts to update partition consumption settings. */
  prepareConsumePartitionControl(state: "open" | "closed") {
    if (state === "open") {
      this.partitionsConsumedTemp(this.partitionsConsumed());
    }
  }
  /** Method for updating temporary state of consumed partitions. */
  toggleTempPartitionsConsumed(partitionId: number) {
    const consumed = this.partitionsConsumedTemp();
    if (consumed == null) {
      // if all partitions consumed — switch to list that excludes target partition
      const all = this.partitionStats().map((partition) => partition.partition_id);
      this.partitionsConsumedTemp(all.filter((id) => id !== partitionId));
    } else {
      // if the consumed list already detailed, toggle the partition id
      if (consumed.includes(partitionId)) {
        this.partitionsConsumedTemp(consumed.filter((id) => id !== partitionId));
      } else {
        this.partitionsConsumedTemp(consumed.concat(partitionId));
      }
    }
  }
  /** Toggle temporary state all at once. */
  toggleAllTempPartitionsConsumed() {
    const consumed = this.partitionsConsumedTemp();
    if (consumed == null) {
      this.partitionsConsumedTemp([]);
    } else {
      this.partitionsConsumedTemp(null);
    }
  }
  /** Method to submit changes in partition consumption settings. */
  async changePartitionsConsumed() {
    const partitions = this.partitionsConsumedTemp();
    await post("PartitionConsumeChange", { partitions });
    this.page(0);
  }
  /**
   * Unlike partition consumed, filtering is about client side filter application
   * of existing messages in memory. Toggling the partition ids logic is similar
   * to consumed ones, but the change is applied instantly.
   */
  async togglePartitionsFiltered(partitionId: number) {
    let filtered = this.partitionsFiltered();
    if (filtered == null) {
      const all = this.filterablePartitions().map((partition) => partition.partition_id);
      filtered = all.filter((id) => id !== partitionId);
    } else {
      if (filtered.includes(partitionId)) {
        filtered = filtered.filter((id) => id !== partitionId);
      } else {
        filtered = filtered.concat(partitionId);
        const consumed = this.partitionsConsumed();
        const partitions = this.partitionStats();
        // drop filter if all consumed partitions selected
        if (filtered.length === (consumed ?? partitions).length) filtered = null;
      }
    }
    await post("PartitionFilterChange", { partitions: filtered });
  }
  /** Toggle filtered partitions all at once. */
  async toggleAllPartitionsFiltered() {
    let filtered = this.partitionsFiltered();
    filtered = filtered == null ? [] : null;
    await post("PartitionFilterChange", { partitions: filtered });
  }

  /** Total count of consumed messages, along with count of filtered ones. */
  messageCount = this.resolve(() => post("GetMessagesCount", { timestamp: this.timestamp() }), {
    total: 0,
    filter: null,
  });
  /** For now, the only way to expose a loading spinner. */
  waitingForMessages = this.derive(() => this.messageCount().total === 0);
  emptyFilterResult = this.derive(
    () => this.messageCount().total > 0 && this.messageCount().filter === 0,
  );
  hasMessages = this.derive(() => {
    const { total, filter } = this.messageCount();
    return filter != null ? filter > 0 : total > 0;
  });
  /** A description of current messages range, based on the page and total number of messages. */
  pageStatLabel = this.derive(() => {
    const offset = this.page() * this.pageSize();
    const count = this.messageCount();
    if (count.filter != null) {
      return `${offset}..${Math.min(offset + this.pageSize(), count.filter)} of ${count.filter} (total: ${count.total})`;
    }
    return `${offset}..${Math.min(offset + this.pageSize(), count.total)} of ${count.total}`;
  });
  prevPageAvailable = this.derive(() => this.page() > 0);
  nextPageAvailable = this.derive(() => {
    const count = this.messageCount();
    const limit = count.filter ?? count.total;
    return this.page() * this.pageSize() + this.pageSize() < limit;
  });

  /**
   * List of columns width, in pixels. The final `value` column is not present,
   * because it always takes the rest of the space available.
   */
  colWidth = this.signal(
    // currently (Aug 13th), copy of old widths in rem (1rem = 16px)
    [9 * 16, 6 * 16, 6 * 16, 6 * 16],
    // skip extra re-renders if the user didn't move pointer too much
    (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  );
  /** The value can be set to `style` prop to pass values to CSS. */
  gridTemplateColumns = this.derive(
    () => `--grid-template-columns: ${this.colWidth().reduce((s, w) => `${s} ${w}px`, "")} 1fr`,
  );
  /** Temporary state for resizing events. */
  resizeColumnDelta = this.signal<number | null>(null);

  /** Handles the beginning of column resizing. */
  handleStartResize(event: PointerEvent, index: number) {
    const target = event.target as HTMLElement;
    target.setPointerCapture(event.pointerId);
    // this is half of the computations for the new column width
    // any new clientX added (via move event) provide the new width
    this.resizeColumnDelta(this.colWidth()[index] - event.clientX);
  }

  /** Triggered on each move event while resizing, dynamically changes column width. */
  handleMoveResize(event: PointerEvent, index: number) {
    const start = this.resizeColumnDelta();
    // skip, if the pointer just passing by
    if (start == null) return;
    const widths = this.colWidth().slice();
    const newWidth = Math.round(start + event.clientX);
    // clamp new width in meaningful range so the user doesn't break the whole layout
    widths[index] = Math.max(4 * 16, Math.min(newWidth, 14 * 16));
    this.colWidth(widths);
  }

  /** Cleanup handler when the user stops resizing a column. */
  handleStopResize(event: PointerEvent) {
    const target = event.target as HTMLElement;
    target.releasePointerCapture(event.pointerId);
    // drop temporary state so the move event doesn't change anything after the pointer is released
    this.resizeColumnDelta(null);
  }

  /** The text search query string. */
  search = this.signal("");
  async handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      const value = (event.target as HTMLInputElement).value;
      if (value.length > 0) {
        await post("SearchMessages", { search: value });
      } else {
        await post("SearchMessages", { search: null });
      }
    }
  }
  async handleInput(event: Event | InputEvent) {
    if (event.type === "input" && !(event instanceof InputEvent)) {
      await post("SearchMessages", { search: null });
    }
  }

  /** Consume mode affects parameters used for consuming messages. */
  consumeMode = this.signal<ConsumeMode>("beginning");
  consumeModeTimestamp = this.signal(Date.now());

  async handleConsumeModeChange(value: ConsumeMode) {
    const timestamp = Date.now();
    await post("ConsumeModeChange", { mode: value, timestamp });
    this.consumeModeTimestamp(timestamp);
    this.consumeMode(value);
    this.page(0);
    this.snapshot(this.emptySnapshot);
  }

  async handleConsumeModeTimestampChange(timestamp: number) {
    await post("ConsumeModeChange", { mode: "timestamp", timestamp });
    this.consumeModeTimestamp(timestamp);
    this.consumeMode("timestamp");
    this.page(0);
    this.snapshot(this.emptySnapshot);
  }

  /** Numeric limit of messages that need to be consumed. */
  messageLimit = this.resolve(async () => {
    const maxSize = await post("GetMaxSize", { timestamp: this.timestamp() });
    return messageLimitLabel[maxSize];
  }, "100k");

  async handleMessageLimitChange(value: MessageLimitType) {
    await post("MessageLimitChange", { limit: messageLimitNumber[value] });
    this.messageLimit(value);
    this.page(0);
    this.snapshot(this.emptySnapshot);
  }

  /** State of stream provided by the host: either running or paused. */
  streamState = this.resolve(() => {
    return post("GetStreamState", { timestamp: this.timestamp() });
  }, "running");
  streamStateLabel = this.derive(() => {
    switch (this.streamState()) {
      case "running":
        return "Pause";
      case "paused":
        return "Resume";
    }
  });
  streamStateTooltip = this.derive(() => {
    switch (this.streamState()) {
      case "running":
        return "Consuming messages";
      case "paused":
        return "Message consumption is paused. Click to resume from last message received.";
    }
  });

  handleStreamToggle(state: StreamState) {
    switch (state) {
      case "running":
        return post("StreamPause", {});
      case "paused":
        return post("StreamResume", {});
    }
  }

  timestampStyle = this.signal<"original" | "local" | "utc">("original");

  formatTimestamp(timestamp: number, format: "original" | "local" | "utc") {
    switch (format) {
      case "local":
        return new Date(timestamp).toISOString();
      case "utc":
        return new Date(timestamp).toUTCString();
      case "original":
      default:
        return timestamp;
    }
  }

  formatMessageValue(message: PartitionConsumeRecord, search: string) {
    return highlight(JSON.stringify(message.value, null, " "), search);
  }

  formatMessageValueFull(message: PartitionConsumeRecord) {
    return JSON.stringify(message.value, null, 2);
  }

  preview(message: PartitionConsumeRecord) {
    const { messages, indices } = this.snapshot();
    const index = indices[messages.indexOf(message)];
    return post("PreviewMessageByIndex", { index });
  }
}

function highlight(input: string, query: string) {
  if (query.length === 0) return input;
  let index = input.indexOf(query);
  let result = "";
  let cursor = 0;
  while (index >= 0) {
    result += input.substring(cursor, index);
    result += `<mark>${input.substring(index, index + query.length)}</mark>`;
    cursor = index + query.length;
    index = input.indexOf(query, cursor);
  }
  return result + input.substring(cursor);
}

export function post(type: "GetStreamState", body: { timestamp?: number }): Promise<StreamState>;
export function post(
  type: "GetMessages",
  body: { page: number; pageSize: number; timestamp?: number },
): Promise<{ messages: PartitionConsumeRecord[]; indices: number[] }>;
export function post(type: "GetPartitionStats", body: object): Promise<PartitionData[]>;
export function post(
  type: "GetTimestampExtent",
  body: { timestamp?: number },
): Promise<[number, number] | null>;
export function post(type: "GetMessagesCount", body: { timestamp?: number }): Promise<MessageCount>;
export function post(
  type: "GetMaxSize",
  body: { timestamp?: number },
): Promise<keyof typeof messageLimitLabel>;
export function post(type: "GetConsumedPartitions", body: object): Promise<number[] | null>;
export function post(type: "GetFilteredPartitions", body: object): Promise<number[] | null>;
export function post(
  type: "PartitionConsumeChange",
  body: { partitions: number[] | null },
): Promise<null>;
export function post(
  type: "PartitionFilterChange",
  body: { partitions: number[] | null },
): Promise<null>;
export function post(
  type: "ConsumeModeChange",
  body: { mode: ConsumeMode; timestamp?: number },
): Promise<null>;
export function post(type: "MessageLimitChange", body: { limit: number }): Promise<null>;
export function post(type: "SearchMessages", body: { search: string | null }): Promise<null>;
export function post(type: "StreamPause", body: object): Promise<null>;
export function post(type: "StreamResume", body: object): Promise<null>;
export function post(type: "PreviewMessageByIndex", body: { index: number }): Promise<null>;
export function post(type: any, body: any): Promise<unknown> {
  return sendWebviewMessage(type, body);
}
