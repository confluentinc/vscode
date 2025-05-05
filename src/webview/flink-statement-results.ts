import { ObservableScope } from "inertial";
import { SqlV1ResultSchema } from "../clients/flinkSql";
import { applyBindings } from "./bindings/bindings";
import { ViewModel } from "./bindings/view-model";
import { createWebviewStorage, sendWebviewMessage } from "./comms/comms";
import { Timer } from "./timer/timer";

customElements.define("flink-timer", Timer);

const storage = createWebviewStorage<{
  colWidth: number[];
  columnVisibilityFlags: boolean[];
  page: number;
}>();

addEventListener("DOMContentLoaded", () => {
  const os = ObservableScope(queueMicrotask);
  const ui = document.querySelector("main")!;
  const vm = new FlinkStatementResultsViewModel(os);
  applyBindings(ui, os, vm);
});

type ResultCount = { total: number; filter: number | null };
type ResultLimitType = "1m" | "100k" | "10k" | "1k" | "100";

const labels = ["1m", "100k", "10k", "1k", "100"];
const numbers = [1_000_000, 100_000, 10_000, 1_000, 100];
const resultLimitNumber = Object.fromEntries(
  labels.map((label, index) => [label, numbers[index]]),
) as Record<ResultLimitType, number>;
const resultLimitLabel = Object.fromEntries(
  labels.map((label, index) => [numbers[index], label]),
) as Record<string, ResultLimitType>;

type StreamState = "running" | "paused" | "errored" | "completed";

/**
 * Top level view model for Flink Statement Results Viewer. It composes shared state and logic
 * available for the UI. It also talks to the "backend": sends and receives
 * messages from the host environment that manages statement results fetching.
 */
class FlinkStatementResultsViewModel extends ViewModel {
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

  /** Schema information for the current statement */
  schema = this.resolve(() => post("GetSchema", { timestamp: this.timestamp() }), {
    columns: [],
  } as SqlV1ResultSchema);

  /** Initial state of results collection. Stored separately so we can use to reset state. */
  emptySnapshot = { results: [] as any[] };
  /**
   * Get a snapshot of results from the host environment, whenever page is changed or
   * the stream is updated. The snapshot includes result records.
   */
  snapshot = this.resolve(() => {
    return post("GetResults", {
      page: this.page(),
      pageSize: this.pageSize(),
      timestamp: this.timestamp(),
    });
  }, this.emptySnapshot);

  /** Total count of results, along with count of filtered ones. */
  resultCount = this.resolve(() => post("GetResultsCount", { timestamp: this.timestamp() }), {
    total: 0,
    filter: null,
  });
  /** For now, the only way to expose a loading spinner. */
  waitingForResults = this.derive(() => this.resultCount().total === 0);
  emptyFilterResult = this.derive(
    () => this.resultCount().total > 0 && this.resultCount().filter === 0,
  );
  hasResults = this.derive(() => {
    const { total, filter } = this.resultCount();
    return filter != null ? filter > 0 : total > 0;
  });

  /**
   * Short list of pages generated based on current results count and current
   * page. Always shows first and last page, current page with two siblings.
   */
  pageButtons = this.derive(() => {
    const { total, filter } = this.resultCount();
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
  /** A description of current results range, based on the page and total number of results. */
  pageStatLabel = this.derive(() => {
    const offset = this.page() * this.pageSize();
    const { total, filter } = this.resultCount();
    if (total === 0) return null;
    if (filter != null) {
      return `Showing ${Math.min(offset + 1, filter).toLocaleString()}..${Math.min(offset + this.pageSize(), filter).toLocaleString()} of ${filter.toLocaleString()} results (total: ${total.toLocaleString()}).`;
    }
    return `Showing ${Math.min(offset + 1, total).toLocaleString()}..${Math.min(offset + this.pageSize(), total).toLocaleString()} of ${total.toLocaleString()} results.`;
  });
  prevPageAvailable = this.derive(() => this.page() > 0);
  nextPageAvailable = this.derive(() => {
    const count = this.resultCount();
    const limit = count.filter ?? count.total;
    return this.page() * this.pageSize() + this.pageSize() < limit;
  });

  /** List of all columns in the grid, with their content definition. */
  columns = this.derive(() => {
    const schema: SqlV1ResultSchema = this.schema();
    const columns: Record<string, any> = {};

    schema?.columns?.forEach((col, index) => {
      columns[col.name] = {
        index: index,
        title: () => col.name,
        children: (result: Record<string, any>) => {
          const value = result[col.name];
          if (value === null) return "NULL";
          switch (col.type.type) {
            case "VARCHAR":
              return String(value);
            case "INTEGER":
              return value.toLocaleString();
            case "TIMESTAMP":
              return new Date(value).toISOString();
            // TODO: Add more cases here.
            default:
              return JSON.stringify(value);
          }
        },
        // TODO: What should go here?
        description: (result: Record<string, any>) => {
          const value = result[col.name];
          if (value === null) return "NULL";
          return String(value);
        },
      };
    });

    return columns;
  });

  /** Static list of all columns in order shown in the UI. */
  allColumns = this.derive(() => {
    const schema = this.schema();
    return schema.columns?.map((col) => col.name) ?? [];
  });

  /**
   * A number which binary representation defines which columns are visible.
   * This number assumes the order defined by `allColumns` array.
   */
  columnVisibilityFlags = this.derive(() => {
    const stored = storage.get()?.columnVisibilityFlags;
    const schema = this.schema();
    if (!stored || stored.length !== schema?.columns?.length) {
      // Initialize with all columns visible
      return Array(schema?.columns?.length).fill(true);
    }
    return stored;
  });

  /** List of currently visible column names. */
  visibleColumns = this.derive(() => {
    const flags = this.columnVisibilityFlags();
    return this.allColumns().filter((_, index) => flags[index]);
  });

  /** Testing if a column is currently visible. This is for the settings panel. */
  isColumnVisible(index: number) {
    return this.columnVisibilityFlags()[index];
  }

  /**
   * Toggling a checkbox on the settings panel should set or unset a bit in
   * position `index`. This will trigger the UI to show or hide a column.
   */
  toggleColumnVisibility(index: number) {
    const flags = this.columnVisibilityFlags();
    const toggled = [...flags];
    toggled[index] = !toggled[index];
    this.columnVisibilityFlags(toggled);
    storage.set({ ...storage.get()!, columnVisibilityFlags: toggled });
  }

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
    widths[index] = Math.max(16, newWidth); // Minimum width of 1rem
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

  /** Temporary state for resizing events. */
  resizeColumnDelta = this.signal<number | null>(null);

  /** Handle search input events */
  search(value: string) {
    // This is handled by the backend through the GetResults message
    return value;
  }

  /** Handle keydown events in the search field */
  handleKeydown(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      // Trigger a search update
      this.snapshot(this.emptySnapshot);
    }
  }

  /** Handle input events in the search field */
  handleInput(event: InputEvent) {
    // This is handled by the search function
  }

  /** Preview the JSON content of a result row in a read-only editor */
  previewResult(result: Record<string, any>) {
    return post("PreviewResult", { result, timestamp: this.timestamp() });
  }

  previewAllResults() {
    return post("PreviewAllResults", { timestamp: this.timestamp() });
  }

  /**
   * List of column widths, in pixels.
   */
  colWidth = this.derive(
    () => {
      const columnsLength = this.allColumns().length;
      const storedWidths = storage.get()?.colWidth;
      if (!storedWidths) {
        return Array(columnsLength).fill(8 * 16); // Default 8rem width for each column (1rem = 16px)
      }
      return storedWidths;
    },
    // Equality function skips extra re-renders if values are similar
    (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
  );

  /** Set to `style` prop to pass width values to CSS. */
  gridTemplateColumns = this.derive(() => {
    const widths = this.colWidth();
    const columnNames = this.allColumns();
    const flags = this.columnVisibilityFlags();
    // Fallback in case we can't get columns
    if (widths.length === 0 && columnNames.length === 0) {
      return "--grid-template-columns: 1fr";
    }
    const visibleColumnWidths = columnNames
      .map((_, index) => ({ index, isVisible: flags[index], width: widths[index] }))
      .filter((col) => col.isVisible)
      .map((col) => `${col.width}px`)
      .join(" ");
    return `--grid-template-columns: ${visibleColumnWidths}`;
  });

  /** Numeric limit of results that need to be fetched. */
  resultLimit = this.resolve(async () => {
    const maxSize = await post("GetMaxSize", { timestamp: this.timestamp() });
    return resultLimitLabel[maxSize];
  }, "100k");

  async handleResultLimitChange(value: ResultLimitType) {
    await post("ResultLimitChange", {
      limit: resultLimitNumber[value],
      timestamp: this.timestamp(),
    });
    this.resultLimit(value);
    this.page(0);
    this.snapshot(this.emptySnapshot);
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
      case "completed":
        return "Completed";
    }
  });
  streamStateTooltip = this.derive(() => {
    switch (this.streamState()) {
      case "running":
        return "Polling for new results (click to pause polling). This does not affect statement execution.";
      case "paused":
        return "Result polling is paused (click to resume polling). This does not affect statement execution.";
      case "completed":
        return "All results have been fetched";
    }
  });

  handleStreamToggle(state: StreamState) {
    switch (state) {
      case "running":
        return post("StreamPause", { timestamp: this.timestamp() });
      case "paused":
        return post("StreamResume", { timestamp: this.timestamp() });
      case "completed":
        return null; // No action for completed state
    }
  }
}

export function post(type: "GetStreamState", body: { timestamp?: number }): Promise<StreamState>;
export function post(
  type: "GetStreamError",
  body: { timestamp?: number },
): Promise<{ message: string } | null>;
export function post(
  type: "GetStreamTimer",
  body: { timestamp?: number },
): Promise<{ start: number; offset: number }>;
export function post(
  type: "GetResults",
  body: { page: number; pageSize: number; timestamp?: number },
): Promise<{ results: Map<string, any>[] }>;
export function post(type: "GetResultsCount", body: { timestamp?: number }): Promise<ResultCount>;
export function post(type: "GetSchema", body: { timestamp?: number }): Promise<SqlV1ResultSchema>;
export function post(
  type: "GetMaxSize",
  body: { timestamp?: number },
): Promise<keyof typeof resultLimitLabel>;
export function post(
  type: "ResultLimitChange",
  body: { limit: number; timestamp?: number },
): Promise<null>;
export function post(type: "StreamPause", body: { timestamp?: number }): Promise<null>;
export function post(type: "StreamResume", body: { timestamp?: number }): Promise<null>;
export function post(
  type: "PreviewResult",
  body: { result: Record<string, any>; timestamp?: number },
): Promise<null>;
export function post(type: "PreviewAllResults", body: { timestamp?: number }): Promise<null>;
export function post(type: any, body: any): Promise<unknown> {
  return sendWebviewMessage(type, body);
}
