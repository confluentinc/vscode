import { Scope, Signal } from "inertial";
import {
  FetchError,
  GetSqlv1StatementResult200Response,
  SqlV1ResultSchema,
  SqlV1StatementResultResults,
  StatementResultsSqlV1Api,
  StatementsSqlV1Api,
} from "./clients/flinkSql";
import { showJsonPreview } from "./documentProviders/message";
import { isResponseError, isResponseErrorWithStatus, logError } from "./errors";
import { CCloudResourceLoader } from "./loaders/ccloudResourceLoader";
import { Logger } from "./logging";
import { FlinkStatement } from "./models/flinkStatement";
import { showErrorNotificationWithButtons } from "./notifications";
import { SidecarHandle } from "./sidecar";
import { parseResults } from "./utils/flinkStatementResults";

const logger = new Logger("flink-statement-results");

export type ResultCount = { total: number; filter: number | null };
export type StreamState = "running" | "completed";

export type MessageType =
  | "GetResults"
  | "GetResultsCount"
  | "GetSchema"
  | "GetStreamState"
  | "GetStreamError"
  | "PreviewResult"
  | "PreviewAllResults"
  | "Search"
  | "SetVisibleColumns"
  | "GetStatementMeta"
  | "StopStatement";

// Define the post function type based on the overloads
export type PostFunction = {
  (type: "GetStreamState", body: { timestamp?: number }): Promise<StreamState>;
  (type: "GetStreamError", body: { timestamp?: number }): Promise<{ message: string } | null>;
  (
    type: "GetResults",
    body: { page: number; pageSize: number; timestamp?: number },
  ): Promise<{ results: any[] }>;
  (type: "GetResultsCount", body: { timestamp?: number }): Promise<ResultCount>;
  (type: "GetSchema", body: { timestamp?: number }): Promise<SqlV1ResultSchema>;
  (
    type: "PreviewResult",
    body: { result: Record<string, any>; timestamp?: number },
  ): Promise<{
    filename: string;
    result: any;
  }>;
  (
    type: "PreviewAllResults",
    body: { timestamp?: number },
  ): Promise<{
    filename: string;
    result: any;
  }>;
  (type: "Search", body: { search: string | null; timestamp?: number }): Promise<null>;
  (
    type: "SetVisibleColumns",
    body: { visibleColumns: string[] | null; timestamp?: number },
  ): Promise<null>;
  (
    type: "GetStatementMeta",
    body: { timestamp?: number },
  ): Promise<{
    name: string;
    status: string;
    startTime: string | null;
    detail: string | null;
    failed: boolean;
    areResultsViewable: boolean;
  }>;
  (type: "StopStatement", body: { timestamp?: number }): Promise<null>;
};

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
  private _getResultsAbortController: AbortController;
  /** Filter by substring text query. */
  private _searchQuery: Signal<string | null>;
  private _visibleColumns: Signal<string[] | null>;
  private _filteredResults: Signal<any[]>;
  private _fetchCount = 0;
  private _statementRefreshInterval: NodeJS.Timeout | undefined;

  private _flinkStatementResultsSqlApi: StatementResultsSqlV1Api;
  private _flinkStatementsSqlApi: StatementsSqlV1Api;

  private _fetchResultsLocked = false;

  constructor(
    private os: Scope,
    private statement: FlinkStatement,
    private sidecar: SidecarHandle,
    private notifyUI: () => void,
    private resultLimit: number,
    private resultsPollingIntervalMs: number = 800,
    private statementRefreshIntervalMs: number = 2000,
    private readonly resourceLoader: CCloudResourceLoader = CCloudResourceLoader.getInstance(),
  ) {
    this._results = os.signal(new Map<string, any>());
    this._state = os.signal<StreamState>("running");
    this._moreResults = os.signal(true);
    this._latestResult = os.signal<GetSqlv1StatementResult200Response | null>(null);
    this._latestError = os.signal<{ message: string } | null>(null);
    this._isResultsFull = os.signal(false);
    this._searchQuery = os.signal<string | null>(null);
    this._visibleColumns = os.signal<string[] | null>(null);
    this._filteredResults = os.signal<any[]>([]);
    this._getResultsAbortController = new AbortController();

    this._flinkStatementResultsSqlApi = sidecar.getFlinkSqlStatementResultsApi(statement);
    this._flinkStatementsSqlApi = sidecar.getFlinkSqlStatementsApi(statement);

    this.setupPolling();
  }

  private setupPolling() {
    this._pollingInterval = setInterval(
      this.fetchResults.bind(this),
      this.resultsPollingIntervalMs,
    );

    this._statementRefreshInterval = setInterval(
      this.refreshStatement.bind(this),
      this.statementRefreshIntervalMs,
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

  private async refreshStatement() {
    const refreshedStatement = await this.resourceLoader.refreshFlinkStatement(this.statement);
    if (refreshedStatement) {
      this.statement = refreshedStatement;
      this.notifyUI();
    }
  }

  async fetchResults(): Promise<void> {
    if (this._fetchResultsLocked) {
      logger.warn("Fetch results is locked, skipping fetch.");
      return;
    }
    this._fetchResultsLocked = true;
    try {
      if (
        this._state() !== "running" ||
        !this._moreResults() ||
        !this.statement.areResultsViewable ||
        this._getResultsAbortController.signal.aborted
      ) {
        // Self-destruct
        clearInterval(this._pollingInterval);
        this._pollingInterval = undefined;
        return;
      }
      let reportable: { message: string } | null = null;
      let shouldComplete = false;
      this._fetchCount++;
      logger.debug(`Fetching statement results...: ${this._fetchCount}`);

      try {
        const currentResults = this._results();
        const pageToken = this.extractPageToken(this._latestResult()?.metadata?.next);

        const response = await this.retryWithBackoff(async () => {
          return await this._flinkStatementResultsSqlApi.getSqlv1StatementResult(
            {
              environment_id: this.statement.environmentId,
              organization_id: this.statement.organizationId,
              name: this.statement.name,
              page_token: pageToken,
            },
            {
              signal: this._getResultsAbortController.signal,
            },
          );
        }, "fetch statement results");

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
      } catch (error) {
        if (error instanceof FetchError && error?.cause?.name === "AbortError") {
          logger.info("Statement results fetch was aborted");
          return;
        }

        if (isResponseError(error)) {
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
                showErrorNotificationWithButtons(
                  "Error response while fetching statement results.",
                );
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
    } finally {
      this._fetchResultsLocked = false;
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

  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 5,
    initialBackoffMs: number = 100,
    maxBackoffMs: number = 10_000,
  ): Promise<T> {
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastErr = err as Error;
        if (isResponseErrorWithStatus(err, 409)) {
          if (attempt < maxRetries - 1) {
            const backoffMs = Math.min(initialBackoffMs * Math.pow(2, attempt), maxBackoffMs);
            logger.debug(
              `Retrying ${operationName} after 409 conflict. Attempt ${attempt + 1}/${maxRetries}. Waiting ${backoffMs}ms`,
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
          }
        } else {
          break;
        }
      }
    }

    throw lastErr;
  }

  private async stopStatement(): Promise<void> {
    // Abort any in-flight GET results requests
    this._getResultsAbortController.abort();

    try {
      await this.retryWithBackoff(async () => {
        await this.refreshStatement();
        await this._stopStatement();
      }, "stop statement");
    } catch (err) {
      logError(err, "Failed to stop Flink statement", {
        extra: { functionName: "stopStatement" },
      });
      this._latestError({ message: "Failed to stop Flink statement" });
    }
  }

  private async _stopStatement() {
    await this._flinkStatementsSqlApi.updateSqlv1Statement({
      organization_id: this.statement.organizationId,
      environment_id: this.statement.environmentId,
      statement_name: this.statement.name,
      UpdateSqlv1StatementRequest: {
        metadata: this.statement.metadata,
        name: this.statement.name,
        organization_id: this.statement.organizationId,
        environment_id: this.statement.environmentId,
        status: this.statement.status,
        spec: {
          ...this.statement.spec,
          stopped: true,
        },
      },
    });
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
          areResultsViewable: this.statement.areResultsViewable,
        };
      }
      case "StopStatement": {
        return this.stopStatement();
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
      this._pollingInterval = undefined;
    }
    if (this._statementRefreshInterval) {
      clearInterval(this._statementRefreshInterval);
      this._statementRefreshInterval = undefined;
    }
    // Abort any in-flight requests
    this._getResultsAbortController.abort();
  }
}
