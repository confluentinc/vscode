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
import { CCloudResourceLoader } from "./loaders/ccloudResourceLoader";
import { Logger } from "./logging";
import { FlinkStatement, modelFlinkStatementToRest } from "./models/flinkStatement";
import { showErrorNotificationWithButtons } from "./notifications";
import { getSidecar } from "./sidecar";
import { parseResults } from "./utils/flinkStatementResults";

const logger = new Logger("flink-statement-results");

type MessageType =
  | "GetResults"
  | "GetResultsCount"
  | "GetSchema"
  | "GetMaxSize"
  | "GetStreamState"
  | "GetStreamError"
  | "PreviewResult"
  | "PreviewAllResults"
  | "Search"
  | "GetSearchQuery"
  | "SetVisibleColumns"
  | "GetStatementMeta"
  | "StopStatement";

type StreamState = "running" | "completed";

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
  private _isResultsFull: Signal<boolean>;
  private _pollingInterval: NodeJS.Timeout | undefined;
  private _shouldPoll: Signal<boolean>;
  /** Filter by substring text query. */
  private _searchQuery: Signal<string | null>;
  private _visibleColumns: Signal<string[] | null>;
  private _filteredResults: Signal<any[]>;
  private _fetchCount = 0;
  private readonly REFRESH_INTERVAL = 5; // Refresh statement every 5 result fetches
  private readonly resourceLoader = CCloudResourceLoader.getInstance();

  constructor(
    private os: Scope,
    private statement: FlinkStatement,
    private service: StatementResultsSqlV1Api,
    private schedule: <T>(cb: () => Promise<T>, signal?: AbortSignal) => Promise<T>,
    private notifyUI: () => void,
    private resultLimit: number,
    private resultsPollingIntervalMs: number = 800,
  ) {
    this._results = os.signal(new Map<string, any>());
    this._state = os.signal<StreamState>("running");
    this._moreResults = os.signal(true);
    this._latestResult = os.signal<GetSqlv1StatementResult200Response | null>(null);
    this._latestError = os.signal<{ message: string } | null>(null);
    this._isResultsFull = os.signal(false);
    this._shouldPoll = os.derive<boolean>(() => this._state() === "running" && this._moreResults());
    this._searchQuery = os.signal<string | null>(null);
    this._visibleColumns = os.signal<string[] | null>(null);
    this._filteredResults = os.signal<any[]>([]);
    this.setupPolling();
  }

  private setupPolling() {
    this._pollingInterval = setInterval(
      this.fetchResults.bind(this),
      this.resultsPollingIntervalMs,
    );

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

  private async refreshStatementIfNeeded(): Promise<void> {
    this._fetchCount++;
    if (this._fetchCount % this.REFRESH_INTERVAL === 0) {
      const refreshedStatement = await this.resourceLoader.refreshFlinkStatement(this.statement);
      if (refreshedStatement) {
        this.statement = refreshedStatement;
      }
    }
  }

  async fetchResults(): Promise<void> {
    if (!this._shouldPoll()) {
      return;
    }

    let reportable: { message: string } | null =
      this.statement?.status?.detail === ""
        ? null
        : { message: this.statement?.status?.detail ?? "" };
    let shouldComplete = false;

    try {
      await this.refreshStatementIfNeeded();
      if (this.statement.isResultsViewable) {
        const currentResults = this._results();
        const pageToken = this.extractPageToken(this._latestResult()?.metadata?.next);
        const response = await this.schedule(() =>
          this.service.getSqlv1StatementResult({
            environment_id: this.statement.environmentId,
            organization_id: this.statement.organizationId,
            name: this.statement.name,
            page_token: pageToken,
          }),
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
          this._filteredResults(this.filterResultsBySearch());
          // Check if we have more results to fetch
          if (this.extractPageToken(response?.metadata?.next) === undefined) {
            this._moreResults(false);
            this._state("completed");
          }
          this._latestError(null);
          this._latestResult(response);
          this.notifyUI();
        });
      }
    } catch (error) {
      if (error instanceof FetchError && error?.cause?.name === "AbortError") return;

      if (error instanceof ResponseError) {
        const payload = await error.response.json();
        if (!payload?.aborted) {
          const status = error.response.status;
          shouldComplete = status >= 400;
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
        shouldComplete = true;
      }
    } finally {
      this.os.batch(() => {
        if (shouldComplete) {
          this._state("completed");
        }
        if (reportable != null) {
          this._latestError(reportable);
        }
        this.notifyUI();
      });
    }
  }

  /**
   * Filters results based on the current search query and visible columns.
   * If visibleColumns is undefined, searches through all columns.
   * If visibleColumns is defined, only searches through the specified columns.
   *
   * @param results - Array of result rows to filter
   * @param visibleColumns - Optional array of column names to search through. If undefined, searches all columns.
   * @returns Filtered array of results that match the search query in the specified columns
   */
  private filterResultsBySearch(): any[] {
    const results = this.getResultsArray();
    const searchQuery = this._searchQuery();
    const visibleColumns = this._visibleColumns();

    if (searchQuery === null || searchQuery.length === 0) {
      return results;
    }

    const searchLower = searchQuery.toLowerCase();
    return results.filter((row) =>
      Object.entries(row)
        .filter(([key]) => visibleColumns === null || visibleColumns.includes(key))
        .some(([_, value]) => value !== null && String(value).toLowerCase().includes(searchLower)),
    );
  }

  private async stopStatement(): Promise<void> {
    try {
      const sidecar = await getSidecar();
      const api = sidecar.getFlinkSqlStatementsApi(this.statement);
      const latestStatement = await this.resourceLoader.refreshFlinkStatement(this.statement);
      if (!latestStatement) {
        logger.error("Failed to refresh Flink statement before stopping.");
        return;
      }
      await api.updateSqlv1Statement({
        organization_id: latestStatement.organizationId,
        environment_id: latestStatement.environmentId,
        statement_name: latestStatement.name,
        UpdateSqlv1StatementRequest: {
          ...modelFlinkStatementToRest(latestStatement),
          spec: {
            ...latestStatement.spec,
            stopped: true,
          },
        },
      });
    } catch (err) {
      logError(err, "Failed to stop Flink statement");
    }
  }

  handleMessage(type: MessageType, body: any): any {
    switch (type) {
      case "GetResults": {
        const offset = body.page * body.pageSize;
        const limit = body.pageSize;
        return {
          results: this._filteredResults().slice(offset, offset + limit),
        };
      }
      case "GetResultsCount": {
        return {
          total: this._results().size,
          filter: this._filteredResults().length,
        };
      }
      case "Search": {
        this._searchQuery(body.search ?? "");
        this._filteredResults(this.filterResultsBySearch());
        this.notifyUI();
        return null;
      }
      case "SetVisibleColumns": {
        this._visibleColumns(body.visibleColumns ?? null);
        this._filteredResults(this.filterResultsBySearch());
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
        const content = body?.result ?? this._filteredResults();

        showJsonPreview(filename, content);

        // Return value used in tests
        return {
          filename,
          result: content,
        };
      }
      case "GetStreamState": {
        return this._state();
      }
      case "GetStreamError": {
        return this._latestError();
      }
      case "GetStatementMeta": {
        return {
          name: this.statement.name,
          status: this.statement.status?.phase,
          startTime: this.statement.metadata?.created_at ?? null,
          detail: this.statement.status?.detail ?? null,
          failed: this.statement.failed,
          stoppable: this.statement.stoppable,
        };
      }
      case "StopStatement": {
        // Call the PUT API to stop the statement
        this.stopStatement();
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
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
    }
  }
}
