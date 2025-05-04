import { Data } from "dataclass";
import { Scope, Signal } from "inertial";
import {
  FetchError,
  GetSqlv1StatementResult200Response,
  SqlV1StatementResultResults,
  StatementResultsSqlV1Api,
} from "./clients/flinkSql";
import { ResponseError } from "./clients/sidecar";
import { showJsonPreview } from "./documentProviders/message";
import { logError } from "./errors";
import { Logger } from "./logging";
import { FlinkStatement } from "./models/flinkStatement";
import { showErrorNotificationWithButtons } from "./notifications";
import { parseResults } from "./utils/flinkStatementResults";

const logger = new Logger("flink-statement-results");

type MessageType =
  | "GetResults"
  | "GetResultsCount"
  | "GetSchema"
  | "GetMaxSize"
  | "ResultLimitChange"
  | "GetStreamState"
  | "GetStreamError"
  | "GetStreamTimer"
  | "StreamPause"
  | "StreamResume"
  | "PreviewResult"
  | "PreviewAllResults"
  | "Search"
  | "GetSearchQuery";

type StreamState = "running" | "paused" | "completed";

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

/**
 * Manages the state and data fetching for Flink statement results.
 * This class handles polling for results, state management, and data transformation,
 * but does not directly manage the webview panel display.
 *
 * @param os - Observable scope for managing reactive state and cleanup
 * @param statement - The Flink statement to fetch results for
 * @param service - API service for fetching statement results
 * @param schedule - Scheduler to use for issuing API calls
 * @param notifyUI - Callback to notify UI of state changes
 * @param resultLimit - Maximum number of results to fetch
 */
export class FlinkStatementResultsManager {
  private _results: Signal<Map<string, any>>;
  private _state: Signal<StreamState>;
  private _moreResults: Signal<boolean>;
  private _latestResult: Signal<GetSqlv1StatementResult200Response | null>;
  private _latestError: Signal<{ message: string } | null>;
  private _timer: Signal<Timer>;
  private _isResultsFull: Signal<boolean>;
  private _pollingWatch: (() => void) | undefined;
  private _shouldPoll: Signal<boolean>;
  /** Filter by substring text query. */
  private _searchQuery: Signal<string | null>;

  constructor(
    private os: Scope,
    private statement: FlinkStatement,
    private service: StatementResultsSqlV1Api,
    private schedule: <T>(cb: () => Promise<T>, signal?: AbortSignal) => Promise<T>,
    private notifyUI: () => void,
    private resultLimit: number,
  ) {
    this._results = os.signal(new Map<string, any>());
    this._state = os.signal<StreamState>("running");
    this._moreResults = os.signal(true);
    this._latestResult = os.signal<GetSqlv1StatementResult200Response | null>(null);
    this._latestError = os.signal<{ message: string } | null>(null);
    this._timer = os.signal(Timer.create());
    this._isResultsFull = os.signal(false);
    this._pollingWatch = undefined;
    this._shouldPoll = os.derive<boolean>(() => this._state() === "running" && this._moreResults());
    this._searchQuery = os.signal<string | null>(null);
    this.setupWatches();
  }

  private setupWatches() {
    // Watch for polling
    this._pollingWatch = this.os.watch(async (signal) => {
      await this.fetchResults(signal);
    });

    // Watch for results full state
    this.os.watch(() => {
      if (this._isResultsFull()) {
        this._state("completed");
      }
    });
  }

  /**
   * Extracts the page token from a next page URL.
   */
  private extractPageToken(nextUrl: string | undefined): string | undefined {
    if (!nextUrl) return undefined;
    try {
      const url = new URL(nextUrl);
      return url.searchParams.get("page_token") ?? undefined;
    } catch {
      return undefined;
    }
  }

  async fetchResults(signal: AbortSignal): Promise<void> {
    if (!this._shouldPoll()) {
      return;
    }

    let reportable: { message: string } | null = null;
    let shouldPause = false;

    try {
      const currentResults = this._results();
      const pageToken = this.extractPageToken(this._latestResult()?.metadata?.next);
      const response = await this.schedule(
        () =>
          this.service.getSqlv1StatementResult(
            {
              environment_id: this.statement.environmentId,
              organization_id: this.statement.organizationId,
              name: this.statement.name,
              page_token: pageToken,
            },
            { signal },
          ),
        signal,
      );
      const resultsData: SqlV1StatementResultResults = response.results ?? {};

      this.os.batch(() => {
        parseResults({
          columns: this.statement.status?.traits?.schema?.columns ?? [],
          isAppendOnly: this.statement.status?.traits?.is_append_only ?? true,
          upsertColumns: this.statement.status?.traits?.upsert_columns,
          limit: this.resultLimit,
          map: currentResults,
          rows: resultsData.data,
        });
        // Check if we have more results to fetch
        if (this.extractPageToken(response?.metadata?.next) === undefined) {
          this._moreResults(false);
          this._state("completed");
        }
        this._latestError(null);
        this._latestResult(response);
        this.notifyUI();
      });
    } catch (error) {
      if (error instanceof FetchError && error?.cause?.name === "AbortError") return;

      if (error instanceof ResponseError) {
        const payload = await error.response.json();
        if (!payload?.aborted) {
          const status = error.response.status;
          shouldPause = status >= 400;
          switch (status) {
            case 401: {
              reportable = { message: "Authentication required." };
              break;
            }
            case 403: {
              reportable = { message: "Insufficient permissions to read statement results." };
              break;
            }
            case 404: {
              reportable = { message: "Statement not found." };
              break;
            }
            case 429: {
              reportable = { message: "Too many requests. Try again later." };
              break;
            }
            default: {
              reportable = { message: "Something went wrong." };
              logError(error, "flink statement results", {
                extra: { status: status.toString(), payload },
              });
              showErrorNotificationWithButtons("Error response while fetching statement results.");
              break;
            }
          }
          logger.error(
            `An error occurred during statement results fetching. Status ${error.response.status}`,
          );
        }
      } else if (error instanceof Error) {
        logger.error(error.message);
        reportable = { message: "An internal error occurred." };
        shouldPause = true;
      }
    } finally {
      this.os.batch(() => {
        if (shouldPause) {
          this._state("paused");
          this._timer(this._timer().pause());
        }
        if (reportable != null) {
          this._latestError(reportable);
        }
        this.notifyUI();
      });
    }
  }

  handleMessage(type: MessageType, body: any): any {
    switch (type) {
      case "GetResults": {
        const offset = body.page * body.pageSize;
        const limit = body.pageSize;
        const paginatedResults = this.getResultsArray().slice(offset, offset + limit);

        let filteredResults = paginatedResults;
        const searchQuery = this._searchQuery();
        if (searchQuery !== null) {
          const searchLower = searchQuery.toLowerCase();
          filteredResults = paginatedResults.filter((row) =>
            Object.values(row).some(
              (value) => value !== null && String(value).toLowerCase().includes(searchLower),
            ),
          );
        }

        return {
          results: filteredResults,
        };
      }
      case "GetResultsCount": {
        let filteredCount = null;
        const results = this.getResultsArray();
        const searchQuery = this._searchQuery();
        if (searchQuery !== null) {
          const searchLower = searchQuery.toLowerCase();
          filteredCount = results.filter((row) =>
            Object.values(row).some(
              (value) => value !== null && String(value).toLowerCase().includes(searchLower),
            ),
          ).length;
        }
        return {
          total: results.length,
          filter: filteredCount,
        };
      }
      case "Search": {
        this._searchQuery(body.search ?? "");
        this.notifyUI();
        return null;
      }
      case "GetSearchQuery": {
        return this._searchQuery() ?? "";
      }
      case "GetSchema": {
        if (!this.statement) {
          return { columns: [] };
        }
        return (
          this.statement.status?.traits?.schema ?? {
            columns: [],
          }
        );
      }
      case "GetMaxSize": {
        return String(this.resultLimit);
      }
      case "PreviewAllResults":
      case "PreviewResult": {
        // plural if all results else singular
        const filename = `flink-statement-result${body?.result === undefined ? "s" : ""}-${new Date().getTime()}.json`;
        const content = body?.result ?? this.getResultsArray();

        showJsonPreview(filename, content);

        // Return value used in tests
        return {
          filename,
          result: content,
        };
      }
      case "ResultLimitChange": {
        const newLimit = body.limit;
        this.resultLimit = newLimit;
        this._results(new Map<string, any>());
        this._isResultsFull(false);
        this._state("running");
        this._timer(this._timer().resume());
        return null;
      }
      case "GetStreamState": {
        return this._state();
      }
      case "GetStreamError": {
        return this._latestError();
      }
      case "GetStreamTimer": {
        return this._timer();
      }
      case "StreamPause": {
        this._state("paused");
        this._timer(this._timer().pause());
        this.notifyUI();
        return null;
      }
      case "StreamResume": {
        if (this._state() === "completed") {
          return null;
        }
        this._state("running");
        this._timer(this._timer().resume());
        this.notifyUI();
        return null;
      }
      default: {
        const _exhaustiveCheck: never = type;
        return _exhaustiveCheck;
      }
    }
  }

  private getResultsArray() {
    return Array.from(this._results().values()).map((row: Map<string, any>) =>
      Object.fromEntries(row),
    );
  }

  dispose() {
    this._pollingWatch?.();
    this.os.dispose();
  }
}
