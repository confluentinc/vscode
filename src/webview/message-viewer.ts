import { ObservableScope } from "inertial";
import { type PartitionData } from "../clients/kafkaRest";
import { type PartitionConsumeRecord } from "../clients/sidecar";
import { applyBindings } from "./bindings/bindings";
import { ViewModel } from "./bindings/view-model";
import { sendWebviewMessage, createWebviewStorage } from "./comms/comms";
import { Histogram, type HistogramBin } from "./canvas/histogram";
import { Timer } from "./timer/timer";

customElements.define("messages-histogram", Histogram);
customElements.define("consume-timer", Timer);

const storage = createWebviewStorage<{
  colWidth: number[];
  columnVisibilityFlags: number;
  timestamp: MessageTimestampFormat;
  page: number;
}>();

addEventListener("DOMContentLoaded", () => {
  const os = ObservableScope(queueMicrotask);
  const ui = document.querySelector("main")!;
  const vm = new MessageViewerViewModel(os);
  applyBindings(ui, os, vm);
});

type MessageCount = { total: number; filter: number | null };
type MessageLimitType = "1m" | "100k" | "10k" | "1k" | "100";
type MessageGridColumn = "timestamp" | "partition" | "offset" | "key" | "value";
type MessageTimestampFormat = "iso" | "unix";

const labels = ["1m", "100k", "10k", "1k", "100"];
const numbers = [1_000_000, 100_000, 10_000, 1_000, 100];
const messageLimitNumber = Object.fromEntries(
  labels.map((label, index) => [label, numbers[index]]),
) as Record<MessageLimitType, number>;
const messageLimitLabel = Object.fromEntries(
  labels.map((label, index) => [numbers[index], label]),
) as Record<string, MessageLimitType>;

type StreamState = "running" | "paused" | "errored";
type ConsumeMode = "latest" | "beginning" | "timestamp";

/**
 * Top level view model for Message Viewer. It composes shared state and logic
 * available for the UI. It also talks to the "backend": sends and receives
 * messages from the host environment that manages stream consumption.
 */
class MessageViewerViewModel extends ViewModel {
  /** This timestamp updates everytime the host environment wants UI to update. */
  timestamp = this.produce(Date.now(), (ts, signal) => {
    function handle(event: MessageEvent<any[]>) {
      if (event.data[0] === "Timestamp") ts(Date.now());
    }
    addEventListener("message", handle, { signal });
  });

  page = this.signal(storage.get()?.page ?? 0);
  pageSize = this.signal(100);

  pagePersistWatcher = this.watch(() => {
    storage.set({ ...storage.get()!, page: this.page() });
  });

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

  histogram = this.resolve(() => {
    return post("GetHistogram", { timestamp: this.timestamp() });
  }, null);
  selection = this.resolve(() => {
    // get selection from the host when webview gets restored, otherwise use local state
    return post("GetSelection", {});
  }, null);
  histogramTimer: ReturnType<typeof setTimeout> | null = null;
  async updateHistogramFilter(timestamps: [number, number] | null) {
    // throttle events slightly, since a lot of selection changes are transient
    this.histogramTimer ??= setTimeout(() => {
      post("TimestampFilterChange", { timestamps: this.peek(this.selection) });
      this.histogramTimer = null;
    }, 10);
    this.selection(timestamps);
    this.page(0);
  }

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
    this.selection(null);
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
    this.page(0);
  }
  /** Toggle filtered partitions all at once. */
  async toggleAllPartitionsFiltered() {
    let filtered = this.partitionsFiltered();
    filtered = filtered == null ? [] : null;
    await post("PartitionFilterChange", { partitions: filtered });
    this.page(0);
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
  timestampExtent = this.resolve(() => {
    return post("GetMessagesExtent", { timestamp: this.timestamp() });
  }, null);
  shouldShowMessagesStat = this.derive(() => {
    const count = this.messageCount();
    const extent = this.timestampExtent();
    return count.total > 0 && extent != null;
  });
  /**
   * Short list of pages generated based on current messages count and current
   * page. Always shows first and last page, current page with two siblings.
   * For larger total number of pages adds … spacing between disconnected pages.
   *
   * Examples: [0, 1, 2], [0, 1, 2, 'rdot', 6], [0, 'ldot', 3, 4, 5, 'rdot', 8],
   * [0, 'ldot', 6, 7, 8], etc. Values `rdot` and `ldot` are sentinel values
   * because the template needs unique keys to keep buttons state persisted.
   */
  pageButtons = this.derive(() => {
    const { total, filter } = this.messageCount();
    const max = Math.ceil((filter ?? total) / this.pageSize()) - 1;
    const current = this.page();
    if (max <= 0) return [];
    const offset = 2;
    const lo = Math.max(0, current - offset);
    const hi = Math.min(current + offset, max);
    const chunk: (number | "ldot" | "rdot")[] = Array.from(
      { length: hi - lo + 1 },
      (_, i) => i + lo,
    );
    if (lo > 0) {
      if (lo > 1) chunk.unshift(0, "ldot");
      else chunk.unshift(0);
    }
    if (hi < max) {
      if (hi < max - 1) chunk.push("rdot", max);
      else chunk.push(max);
    }
    return chunk;
  });
  isPageButton(input: unknown) {
    return typeof input === "number";
  }
  /** A description of current messages range, based on the page and total number of messages. */
  pageStatLabel = this.derive(() => {
    const offset = this.page() * this.pageSize();
    const { total, filter } = this.messageCount();
    if (total === 0) return null;
    if (filter != null) {
      return `Showing ${Math.min(offset + 1, filter).toLocaleString()}..${Math.min(offset + this.pageSize(), filter).toLocaleString()} of ${filter.toLocaleString()} messages (total: ${total.toLocaleString()}).`;
    }
    return `Showing ${Math.min(offset + 1, total).toLocaleString()}..${Math.min(offset + this.pageSize(), total).toLocaleString()} of ${total.toLocaleString()} messages.`;
  });
  prevPageAvailable = this.derive(() => this.page() > 0);
  nextPageAvailable = this.derive(() => {
    const count = this.messageCount();
    const limit = count.filter ?? count.total;
    return this.page() * this.pageSize() + this.pageSize() < limit;
  });

  /** List of all columns in the grid, with their content definition. */
  columns: Record<MessageGridColumn, any> = {
    timestamp: {
      index: 0,
      title: () => "Timestamp",
      children: (message: PartitionConsumeRecord) => this.formatTimestamp()(message.timestamp!),
      description: (message: PartitionConsumeRecord) => {
        return this.messageTimestampFormat() === "iso"
          ? `${this.formatTimestamp()(message.timestamp!)} (${message.timestamp})`
          : message.timestamp;
      },
    },
    partition: {
      index: 1,
      title: () => "Partition",
      children: (message: PartitionConsumeRecord) => message.partition_id,
      description: (message: PartitionConsumeRecord) => message.partition_id,
    },
    offset: {
      index: 2,
      title: () => "Offset",
      children: (message: PartitionConsumeRecord) =>
        this.formatMessageValue(message.offset, this.searchRegexp()),
      description: (message: PartitionConsumeRecord) => message.offset,
    },
    key: {
      index: 3,
      title: () => "Key",
      children: (message: PartitionConsumeRecord) =>
        this.formatMessageValue(message.key, this.searchRegexp()),
      description: (message: PartitionConsumeRecord) => message.key,
    },
    value: {
      index: 4,
      title: () => "Value",
      children: (message: PartitionConsumeRecord) =>
        this.formatMessageValue(message.value, this.searchRegexp()),
      description: (message: PartitionConsumeRecord) => message.value,
    },
  };
  /** Static list of all columns in order shown in the UI. */
  allColumns = ["timestamp", "partition", "offset", "key", "value"];
  /**
   * A number which binary representation defines which columns are visible.
   * This number assumes the order defined by `allColumns` array.
   */
  columnVisibilityFlags = this.derive(() => storage.get()?.columnVisibilityFlags ?? 0b11111);
  /** List of currently visible column names. */
  visibleColumns = this.derive<MessageGridColumn[]>(() => {
    const flags = this.columnVisibilityFlags();
    return this.allColumns.filter((_, index) => (0b10000 >> index) & flags) as MessageGridColumn[];
  });
  /** Testing if a column is currently visible. This is for the settings panel. */
  isColumnVisible(index: number) {
    return ((0b10000 >> index) & this.columnVisibilityFlags()) !== 0;
  }
  /**
   * Toggling a checkbox on the settings panel should set or unset a bit in
   * position `index`. This will trigger the UI to show or hide a column.
   */
  toggleColumnVisibility(index: number) {
    const flags = this.columnVisibilityFlags();
    // a bitset with 1 bit set specifically for the target column
    const mask = 0b10000 >> index;
    // if bit in `index` position is set, unset it, otherwise set it
    const toggled = (mask & flags) !== 0 ? flags & ~mask : flags | mask;
    // ...you must be thinking, wow that fella is so smart. I know right?
    this.columnVisibilityFlags(toggled);
    storage.set({ ...storage.get()!, columnVisibilityFlags: toggled });
  }
  /**
   * List of columns width, in pixels. The final `value` column is not present,
   * because it always takes the rest of the space available.
   */
  colWidth = this.signal(
    // conveniently expressed in rems (1rem = 16px)
    storage.get()?.colWidth ?? [13 * 16, 5.5 * 16, 6.5 * 16, 6 * 16],
    // skip extra re-renders if the user didn't move pointer too much
    (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  );
  /** The value can be set to `style` prop to pass values to CSS. */
  gridTemplateColumns = this.derive(() => {
    const columns = this.colWidth().reduce((string, width, index) => {
      return this.isColumnVisible(index) ? `${string} ${width}px` : string;
    }, "");
    return `--grid-template-columns: ${columns} 1fr`;
  });
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
    widths[index] = Math.max(4 * 16, Math.min(newWidth, 16 * 16));
    this.colWidth(widths);
  }

  /** Cleanup handler when the user stops resizing a column. */
  handleStopResize(event: PointerEvent) {
    const target = event.target as HTMLElement;
    target.releasePointerCapture(event.pointerId);
    // drop temporary state so the move event doesn't change anything after the pointer is released
    this.resizeColumnDelta(null);
    // persist changes to local storage
    storage.set({ ...storage.get()!, colWidth: this.colWidth() });
  }

  /** The text search query string. */
  search = this.resolve(() => {
    return post("GetSearchQuery", {});
  }, "");
  searchRegexp = this.resolve(async () => {
    const timestamp = this.timestamp();
    const source = await post("GetSearchSource", { timestamp });
    return source != null ? new RegExp(source, "gi") : null;
  }, null);
  searchTimer: ReturnType<typeof setTimeout> | null = null;
  searchDebounceTime = 500;
  async handleKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLInputElement;
    if (event.key === "Enter") {
      // when user hits Enter, search query submitted immediately
      const value = target.value.trim();
      this.submitSearch(value);
    } else {
      // otherwise, we keep debouncing search submittion until the user stops typing
      if (this.searchTimer != null) clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(async () => {
        const value = target.value.trim();
        this.submitSearch(value);
      }, this.searchDebounceTime);
    }
  }
  async handleInput(event: Event | InputEvent) {
    if (event.type === "input" && !(event instanceof InputEvent)) {
      if (this.searchTimer != null) {
        clearTimeout(this.searchTimer);
        this.searchTimer = null;
      }
      await post("SearchMessages", { search: null });
    }
  }
  async submitSearch(value: string) {
    if (this.searchTimer != null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    if (value.length > 0) {
      await post("SearchMessages", { search: value });
    } else {
      await post("SearchMessages", { search: null });
    }
    this.page(0);
  }

  /** Consume mode affects parameters used for consuming messages. */
  consumeMode = this.resolve(() => {
    return post("GetConsumeMode", { timestamp: this.timestamp() });
  }, "beginning" as ConsumeMode);
  consumeModeTimestamp = this.resolve(() => {
    return post("GetConsumeModeTimestamp", { timestamp: this.timestamp() });
  }, Date.now());

  async handleConsumeModeChange(value: ConsumeMode) {
    const timestamp = Date.now();
    await post("ConsumeModeChange", { mode: value, timestamp });
    this.consumeModeTimestamp(timestamp);
    this.consumeMode(value);
    this.page(0);
    this.snapshot(this.emptySnapshot);
    this.selection(null);
  }

  async handleConsumeModeTimestampChange(timestamp: number) {
    await post("ConsumeModeChange", { mode: "timestamp", timestamp });
    this.consumeModeTimestamp(timestamp);
    this.consumeMode("timestamp");
    this.page(0);
    this.snapshot(this.emptySnapshot);
    this.selection(null);
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
    this.selection(null);
  }

  timer = this.resolve(() => {
    return post("GetStreamTimer", { timestamp: this.timestamp() });
  }, null);
  /** State of stream provided by the host: either running or paused. */
  streamState = this.resolve(() => {
    return post("GetStreamState", { timestamp: this.timestamp() });
  }, "running");
  streamError = this.resolve(() => {
    return post("GetStreamError", { timestamp: this.timestamp() });
  }, null);
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

  messageTimestampFormat = this.signal(storage.get()?.timestamp ?? "iso");
  updateTimestampFormat(format: MessageTimestampFormat) {
    this.messageTimestampFormat(format);
    storage.set({ ...storage.get()!, timestamp: format });
  }
  formatTimestamp = this.derive(() => {
    const format = this.messageTimestampFormat();
    switch (format) {
      case "iso":
        return (timestamp: number) => new Date(timestamp).toISOString();
      case "unix":
        return (timestamp: number) => String(timestamp);
    }
  });

  formatMessageValue(value: unknown, search: RegExp | null) {
    if (value == null) return "";
    const input = typeof value === "string" ? value : JSON.stringify(value, null, " ");
    if (search == null) return input;
    // search regexp is global, reset its index state to avoid mismatches
    search.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    const matches = input.matchAll(search);
    let cursor = 0;
    for (const match of matches) {
      const index = match.index;
      const length = match[0].length;
      fragment.append(input.substring(cursor, index));
      const mark = document.createElement("mark");
      mark.append(input.substring(index, index + length));
      fragment.append(mark);
      cursor = index + length;
    }
    fragment.append(input.substring(cursor));
    return fragment;
  }

  formatMessageValueFull(message: PartitionConsumeRecord) {
    return message.value;
  }

  preview(message: PartitionConsumeRecord) {
    const { messages, indices } = this.snapshot();
    const index = indices[messages.indexOf(message)];
    return post("PreviewMessageByIndex", { index });
  }

  previewJSON() {
    return post("PreviewJSON", {});
  }
}

export function post(type: "GetStreamState", body: { timestamp?: number }): Promise<StreamState>;
export function post(type: "GetStreamError", body: object): Promise<{ message: string } | null>;
export function post(
  type: "GetStreamTimer",
  body: { timestamp?: number },
): Promise<{ start: number; offset: number }>;
export function post(
  type: "GetMessages",
  body: { page: number; pageSize: number; timestamp?: number },
): Promise<{ messages: PartitionConsumeRecord[]; indices: number[] }>;
export function post(type: "GetPartitionStats", body: object): Promise<PartitionData[]>;
export function post(
  type: "GetHistogram",
  body: { timestamp?: number },
): Promise<HistogramBin[] | null>;
export function post(
  type: "GetSelection",
  body: { timestamp?: number },
): Promise<[number, number] | null>;
export function post(type: "GetSearchSource", body: { timestamp?: number }): Promise<string | null>;
export function post(type: "GetSearchQuery", body: { timestamp?: number }): Promise<string>;
export function post(type: "GetMessagesCount", body: { timestamp?: number }): Promise<MessageCount>;
export function post(
  type: "GetMessagesExtent",
  body: { timestamp?: number },
): Promise<[number, number] | null>;
export function post(
  type: "GetMaxSize",
  body: { timestamp?: number },
): Promise<keyof typeof messageLimitLabel>;
export function post(type: "GetConsumedPartitions", body: object): Promise<number[] | null>;
export function post(type: "GetFilteredPartitions", body: object): Promise<number[] | null>;
export function post(type: "GetConsumeMode", body: object): Promise<ConsumeMode>;
export function post(type: "GetConsumeModeTimestamp", body: object): Promise<number | null>;
export function post(
  type: "PartitionConsumeChange",
  body: { partitions: number[] | null },
): Promise<null>;
export function post(
  type: "PartitionFilterChange",
  body: { partitions: number[] | null },
): Promise<null>;
export function post(
  type: "TimestampFilterChange",
  body: { timestamps: [number, number] | null },
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
export function post(type: "PreviewJSON", body: object): Promise<null>;
export function post(type: any, body: any): Promise<unknown> {
  return sendWebviewMessage(type, body);
}
