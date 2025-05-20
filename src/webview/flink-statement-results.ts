import { Scope, Signal } from "inertial";
import { SqlV1ResultSchema } from "../clients/flinkSql";
import { PostFunction, ResultCount, StreamState } from "../flinkStatementResultsManager";
import {
  ColumnDefinitions,
  ViewMode,
  createColumnDefinitions,
  getColumnOrder,
} from "../utils/flinkStatementResultColumns";
import { ViewModel } from "./bindings/view-model";
import { WebviewStorage, createWebviewStorage, sendWebviewMessage } from "./comms/comms";

export type ResultsViewerStorageState = {
  colWidths: number[];
  columnVisibilityFlags: boolean[];
  page: number;
};

/**
 * Top level view model for Flink Statement Results Viewer. It composes shared state and logic
 * available for the UI. It also talks to the "backend": sends and receives
 * messages from the host environment that manages statement results fetching.
 *
 * @see flinkStatementResultsManager.test.ts for tests.
 */
export class FlinkStatementResultsViewModel extends ViewModel {
  readonly page: Signal<number>;
  readonly pageSize: Signal<number>;
  readonly resizeColumnDelta: Signal<number | null> = this.signal<number | null>(null);
  readonly stopButtonClicked: Signal<boolean>;
  readonly tablePage: Signal<number>;
  readonly changelogPage: Signal<number>;
  readonly viewMode: Signal<ViewMode>;
  readonly schema: Signal<SqlV1ResultSchema>;
  readonly emptySnapshot: { results: any[] };
  readonly snapshot: Signal<{ results: any[] }>;
  readonly resultCount: Signal<ResultCount>;
  readonly statementMeta: Signal<{
    name: string;
    status: string;
    startTime: string | null;
    detail: string | null;
    failed: boolean;
    areResultsViewable: boolean;
  }>;
  readonly waitingForResults: Signal<boolean>;
  readonly emptyFilterResult: Signal<boolean>;
  readonly hasResults: Signal<boolean>;
  readonly streamState: Signal<StreamState>;
  readonly streamError: Signal<{ message: string } | null>;
  readonly pageStatLabel: Signal<string | null>;
  readonly prevPageAvailable: Signal<boolean>;
  readonly nextPageAvailable: Signal<boolean>;
  readonly columns: Signal<ColumnDefinitions>;
  readonly allColumns: Signal<string[]>;
  readonly columnVisibilityFlags: Signal<boolean[]>;
  readonly visibleColumns: Signal<string[]>;
  readonly colWidth: Signal<number[]>;
  readonly gridTemplateColumns: Signal<string>;
  readonly pageButtons: Signal<(number | "ldot" | "rdot")[]>;

  readonly pagePersistWatcher: () => void;

  /**
   * Creates a new instance of FlinkStatementResultsViewModel.
   *
   * The constructor initializes all reactive properties and sets up the initial state:
   * - Creates signals for pagination, column visibility, and search functionality
   * - Sets up default column widths and visibility
   * - Initializes storage with default values if none exist
   * - Establishes communication channels with the host environment
   *
   * @param os The ObservableScope instance that manages reactive state and signals.
   *            This is used to create and manage all reactive properties of the view model.
   * @param timestamp A Signal<number> that represents the current timestamp.
   *                   This is used to force re-renders of the view model when needed.
   *                   The timestamp is updated whenever the view model needs to refresh.
   * @param storage Optional WebviewStorage instance for persisting view model state.
   *                 If not provided, a new storage instance will be created.
   *                 Used to store and retrieve column widths, visibility flags, and other UI state.
   * @param post Callback function for sending messages to the host environment.
   *              If not provided, defaults to using sendWebviewMessage.
   *              Used to communicate state changes and user actions back to the extension.
   */
  constructor(
    os: Scope,
    private timestamp: Signal<number>,
    private storage: WebviewStorage<ResultsViewerStorageState> = createWebviewStorage<ResultsViewerStorageState>(),
    private post: PostFunction = ((type: string, body: any) =>
      sendWebviewMessage(type, body)) as PostFunction,
  ) {
    super(os);

    this.page = this.signal(storage.get()?.page ?? 0);
    this.tablePage = this.signal(0);
    this.changelogPage = this.signal(0);
    this.pageSize = this.signal(100);
    this.viewMode = this.resolve(async () => {
      return await this.post("GetViewMode", { timestamp: this.timestamp() });
    }, "table" as ViewMode);
    this.pagePersistWatcher = this.watch(() => {
      storage.set({ ...storage.get()!, page: this.page() });
    });

    /** Schema information for the current statement */
    this.schema = this.resolve(() => this.post("GetSchema", { timestamp: this.timestamp() }), {
      columns: [],
    } as SqlV1ResultSchema);

    /** Initial state of results collection. Stored separately so we can use to reset state. */
    this.emptySnapshot = { results: [] as any[] };

    /**
     * Get a snapshot of results from the host environment, whenever page is changed or
     * the stream is updated. The snapshot includes result records.
     */
    this.snapshot = this.resolve(() => {
      return this.post("GetResults", {
        page: this.page(),
        pageSize: this.pageSize(),
        timestamp: this.timestamp(),
      });
    }, this.emptySnapshot);

    this.resultCount = this.resolve(
      () =>
        this.post("GetResultsCount", {
          timestamp: this.timestamp(),
        }),
      {
        total: 0,
        filter: null,
      } as ResultCount,
    );

    /** Statement metadata (name, status, SQL, start time, detail, failed, sqlHtml) */
    this.statementMeta = this.resolve(
      () => this.post("GetStatementMeta", { timestamp: this.timestamp() }),
      {
        name: "",
        status: "",
        startTime: null,
        detail: null,
        failed: false,
        areResultsViewable: true,
      },
    );

    /** For now, the only way to expose a loading spinner. */
    this.waitingForResults = this.derive(() => {
      return this.resultCount().total === 0 && this.statementMeta().areResultsViewable;
    });

    this.emptyFilterResult = this.derive(
      () => this.resultCount().total > 0 && this.resultCount().filter === 0,
    );
    this.hasResults = this.derive(() => {
      const { total, filter } = this.resultCount();
      return filter != null ? filter > 0 : total > 0;
    });

    /**
     * Short list of pages generated based on current results count and current
     * page. Always shows first and last page, current page with two siblings.
     */
    this.pageButtons = this.derive(() => {
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

    /** A description of current results range, based on the page and total number of results. */
    this.pageStatLabel = this.derive(() => {
      const offset = this.page() * this.pageSize();
      const { total, filter } = this.resultCount();
      if (total === 0) return null;
      if (filter != null) {
        return `Showing ${Math.min(offset + 1, filter).toLocaleString()}..${Math.min(offset + this.pageSize(), filter).toLocaleString()} of ${filter.toLocaleString()} results (total: ${total.toLocaleString()}).`;
      }
      return `Showing ${Math.min(offset + 1, total).toLocaleString()}..${Math.min(offset + this.pageSize(), total).toLocaleString()} of ${total.toLocaleString()} results.`;
    });

    this.prevPageAvailable = this.derive(() => this.page() > 0);
    this.nextPageAvailable = this.derive(() => {
      const count = this.resultCount();
      const limit = count.filter ?? count.total;
      return this.page() * this.pageSize() + this.pageSize() < limit;
    });

    /** List of all columns in the grid, with their content definition. */
    this.columns = this.derive(() => {
      const schema: SqlV1ResultSchema = this.schema();
      return createColumnDefinitions(schema, this.viewMode());
    });

    /** Static list of all columns in order shown in the UI. */
    this.allColumns = this.derive(() => {
      const schema = this.schema();
      return getColumnOrder(schema, this.viewMode());
    });

    /**
     * A number which binary representation defines which columns are visible.
     * This number assumes the order defined by `allColumns` array.
     */
    this.columnVisibilityFlags = this.derive(() => {
      const stored = this.storage.get()?.columnVisibilityFlags;
      const allCols = this.allColumns();
      if (!stored || stored.length !== allCols.length) {
        // Initialize with all columns visible
        return Array(allCols.length).fill(true);
      }
      return stored;
    });

    /** List of currently visible column names. */
    this.visibleColumns = this.derive(() => {
      return this._visibleColumns();
    });

    /**
     * List of column widths, in pixels.
     */
    this.colWidth = this.derive(
      () => {
        const columnsLength = this.allColumns().length;
        const storedWidths = this.storage.get()?.colWidths;
        if (!storedWidths) {
          return Array(columnsLength).fill(8 * 16); // Default 8rem width for each column (1rem = 16px)
        }

        // If view mode was toggled
        if (Math.abs(columnsLength - storedWidths.length) === 1) {
          if (this.viewMode() === "changelog") {
            // Set default width for the extra "Operation" column
            return [8 * 16, ...storedWidths];
          } else {
            // Remove the width for the "Operation" column
            // when we're in table view mode
            return storedWidths.slice(1);
          }
        }

        return storedWidths;
      },
      // Equality function skips extra re-renders if values are similar
      (a, b) => a.length === b.length && a.every((v, i) => v === b[i]),
    );

    /** Set to `style` prop to pass width values to CSS. */
    this.gridTemplateColumns = this.derive(() => {
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

    /** Whether the stop button has been clicked */
    this.stopButtonClicked = this.signal(false);

    /** State of stream provided by the host: either running or completed. */
    this.streamState = this.resolve(() => {
      return this.post("GetStreamState", { timestamp: this.timestamp() });
    }, "running");
    this.streamError = this.resolve(() => {
      return this.post("GetStreamError", { timestamp: this.timestamp() });
    }, null);
  }

  async setViewMode(viewMode: ViewMode) {
    if (viewMode === "table") {
      this.changelogPage(this.page());
      this.page(this.tablePage());
    } else {
      this.tablePage(this.page());
      this.page(this.changelogPage());
    }

    await this.post("SetViewMode", { viewMode, timestamp: this.timestamp() });
  }

  isPageButton(input: unknown) {
    return typeof input === "number";
  }

  private _visibleColumns() {
    const flags = this.columnVisibilityFlags();
    return this.allColumns().filter((_, index) => flags[index]);
  }

  /** Testing if a column is currently visible. This is for the settings panel. */
  isColumnVisible(index: number) {
    return this.columnVisibilityFlags()[index];
  }

  /**
   * Toggling a checkbox on the settings panel should set or unset a bit in
   * position `index`. This will trigger the UI to show or hide a column.
   * Prevents hiding the last visible column.
   */
  async toggleColumnVisibility(index: number) {
    const flags = this.columnVisibilityFlags();
    const toggled = [...flags];

    // If trying to hide a column, check if it would hide the last visible one
    if (toggled[index] === true) {
      const visibleCount = toggled.filter((f) => f).length;
      if (visibleCount <= 1) {
        // Don't allow hiding the last visible column
        return;
      }
    }

    toggled[index] = !toggled[index];
    this.columnVisibilityFlags(toggled);
    this.storage.set({ ...this.storage.get()!, columnVisibilityFlags: toggled });
    await this.post("SetVisibleColumns", {
      visibleColumns: this._visibleColumns(),
      timestamp: this.timestamp(),
    });
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
    this.storage.set({ ...this.storage.get()!, colWidths: this.colWidth() });
  }

  /** The text search query string. */
  searchTimer: ReturnType<typeof setTimeout> | null = null;
  searchDebounceTime = 500;

  async handleKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLInputElement;
    if (event.key === "Enter") {
      event.preventDefault();
      // Trigger a search update
      this.snapshot({ results: [] });
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
      await this.post("Search", { search: null, timestamp: this.timestamp() });
    }
  }

  async submitSearch(value: string) {
    if (this.searchTimer != null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    if (value.length > 0) {
      await this.post("Search", { search: value, timestamp: this.timestamp() });
    } else {
      await this.post("Search", { search: null, timestamp: this.timestamp() });
    }
    this.page(0);
  }

  /** Preview the JSON content of a result row in a read-only editor */
  previewResult(result: Record<string, any>) {
    return this.post("PreviewResult", { result, timestamp: this.timestamp() });
  }

  previewAllResults() {
    return this.post("PreviewAllResults", { timestamp: this.timestamp() });
  }

  async stopStatement() {
    this.stopButtonClicked(true);
    await this.post("StopStatement", { timestamp: this.timestamp() });

    // Reset the button state after a short delay
    // in case the stop failed for some reason
    setTimeout(() => this.stopButtonClicked(false), 2000);
  }
}
