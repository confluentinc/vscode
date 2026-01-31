import type { Scope, Signal } from "inertial";
import * as vscode from "vscode";
import { TokenManager } from "../authn/oauth2/tokenManager";
import {
  GetSqlv1StatementResult200ResponseApiVersionEnum,
  GetSqlv1StatementResult200ResponseKindEnum,
  type GetSqlv1StatementResult200Response,
  type SqlV1ResultSchema,
  type SqlV1StatementResultResults,
  type StatementResultsSqlV1Api,
  type StatementsSqlV1Api,
} from "../clients/flinkSql";
import { FetchError } from "../clients/flinkSql";
import { showJsonPreview } from "../documentProviders/message";
import { isResponseErrorWithStatus, logError } from "../errors";
import { CCloudResourceLoader } from "../loaders/ccloudResourceLoader";
import { Logger } from "../logging";
import type { FlinkStatement } from "../models/flinkStatement";
import { showErrorNotificationWithButtons } from "../notifications";
import { CCloudDataPlaneProxy, type FlinkStatementResult } from "../proxy/ccloudDataPlaneProxy";
import { buildFlinkDataPlaneBaseUrl } from "../proxy/flinkDataPlaneUrlBuilder";
import { HttpError } from "../proxy/httpClient";
import type { ViewMode } from "./flinkStatementResultColumns";
import type { StatementResultsRow } from "./flinkStatementResults";
import { parseResults } from "./flinkStatementResults";
import { extractPageToken } from "./utils";

const logger = new Logger("flink-statement-results");

/**
 * Interface for providing Flink SQL API instances.
 * @see CCloudFlinkSqlApiProvider for the implementation.
 */
export interface FlinkSqlApiProvider {
  getFlinkSqlStatementResultsApi(statement: FlinkStatement): StatementResultsSqlV1Api;
  getFlinkSqlStatementsApi(statement: FlinkStatement): StatementsSqlV1Api;
}

export type ResultCount = { total: number; filter: number | null };
export type StreamState = "running" | "completed";

export type MessageType =
  | "GetResults"
  | "GetResultsCount"
  | "GetSchema"
  | "GetStreamState"
  | "GetSearchQuery"
  | "GetSearchSource"
  | "GetStreamError"
  | "PreviewResult"
  | "PreviewAllResults"
  | "Search"
  | "SetVisibleColumns"
  | "GetStatementMeta"
  | "StopStatement"
  | "ViewStatementSource"
  | "SetViewMode"
  | "GetViewMode";

// Define the post function type based on the overloads
export type PostFunction = {
  (type: "GetStreamState", body: { timestamp?: number }): Promise<StreamState>;
  (type: "GetSearchQuery", body: { timestamp?: number }): Promise<string>;
  (type: "GetSearchSource", body: { timestamp?: number }): Promise<string | null>;
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
    isForeground: boolean;
  }>;
  (type: "StopStatement", body: { timestamp?: number }): Promise<null>;
  (type: "ViewStatementSource", body: { timestamp?: number }): Promise<null>;
  (type: "SetViewMode", body: { viewMode: ViewMode; timestamp?: number }): Promise<null>;
  (type: "GetViewMode", body: { timestamp?: number }): Promise<ViewMode>;
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
  /**
   * Signal containing a map of processed or changelog-compressed results,
   * where each key is a unique identifier for the row and the value is the row data.
   * The row data value is a {@link Map} of column names to their respective data value (represented as `any`).
   */
  private _results: Signal<Map<string, Map<string, any>>>;
  /**
   * Signal containing the raw statement results as received from the API, before any processing or transformation.
   * This represents a changelog stream where each result represents a change to the data rather than just the current state.
   * This is used in changelog view mode to show the history of changes, while table view mode uses the processed {@link _results}.
   */
  private _rawResults: Signal<StatementResultsRow[]>;
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
  private _viewMode!: Signal<ViewMode>;

  private _flinkStatementResultsSqlApi: StatementResultsSqlV1Api;
  private _flinkStatementsSqlApi: StatementsSqlV1Api;

  private _fetchResultsLocked = false;

  constructor(
    private os: Scope,
    private statement: FlinkStatement,
    private flinkApiProvider: FlinkSqlApiProvider,
    private notifyUI: () => void,
    private resultLimit: number,
    private resultsPollingIntervalMs: number = 800,
    private statementRefreshIntervalMs: number = 2000,
    private readonly resourceLoader: CCloudResourceLoader = CCloudResourceLoader.getInstance(),
  ) {
    this._results = os.signal(new Map<string, any>());
    this._rawResults = os.signal<any[]>([]);
    this._state = os.signal<StreamState>("running");
    this._moreResults = os.signal(true);
    this._latestResult = os.signal<GetSqlv1StatementResult200Response | null>(null);
    this._latestError = os.signal<{ message: string } | null>(null);
    this._isResultsFull = os.signal(false);
    this._searchQuery = os.signal<string | null>(null);
    this._visibleColumns = os.signal<string[] | null>(null);
    this._filteredResults = os.signal<any[]>([]);
    this._getResultsAbortController = new AbortController();

    this._flinkStatementResultsSqlApi = flinkApiProvider.getFlinkSqlStatementResultsApi(statement);
    this._flinkStatementsSqlApi = flinkApiProvider.getFlinkSqlStatementsApi(statement);

    this._viewMode = this.os.signal<ViewMode>("table");

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

  private async refreshStatement() {
    const refreshedStatement = await this.resourceLoader.refreshFlinkStatement(this.statement);
    if (refreshedStatement) {
      this.statement = refreshedStatement;
      this.notifyUI();
    }
  }

  async fetchResults(): Promise<void> {
    if (this._fetchResultsLocked) {
      // setInterval fires off the callbacks even if the previous one is still running
      // (meaning we could still be awaiting a response from the GET results API)
      // If we don't guard against only one instance of this function running at a time,
      // we could end up with out of order application of changelogs.

      // This callback being fired with another concurrently executing instance
      // is expected and doesn't warrant a log.
      return;
    }
    this._fetchResultsLocked = true;
    try {
      if (
        this._state() !== "running" ||
        !this._moreResults() ||
        !this.statement.canRequestResults ||
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

      try {
        const priorResults = this._results();
        const priorRawResults = this._rawResults();
        const pageToken = extractPageToken(this._latestResult()?.metadata?.next);

        // Get auth token for data plane API
        const tokenManager = TokenManager.getInstance();
        const dataPlaneToken = await tokenManager.getDataPlaneToken();
        if (!dataPlaneToken) {
          throw new Error("Failed to get data plane token for Flink SQL API");
        }

        // Build the Flink Data Plane API base URL
        const baseUrl = buildFlinkDataPlaneBaseUrl(
          this.statement.provider,
          this.statement.region,
          this.statement.environmentId,
        );

        // Create the proxy instance with Bearer token auth
        const proxy = new CCloudDataPlaneProxy({
          baseUrl,
          organizationId: this.statement.organizationId,
          environmentId: this.statement.environmentId,
          auth: {
            type: "bearer",
            token: dataPlaneToken,
          },
        });

        const response: FlinkStatementResult = await this.retry(async () => {
          return await proxy.getStatementResults(this.statement.name, pageToken);
        }, "fetch statement results");

        const resultsData: SqlV1StatementResultResults = response.results ?? {};

        // Convert proxy response to client format for _latestResult signal
        const clientFormatResponse: GetSqlv1StatementResult200Response = {
          api_version: GetSqlv1StatementResult200ResponseApiVersionEnum.SqlV1,
          kind: GetSqlv1StatementResult200ResponseKindEnum.StatementResult,
          metadata: {
            self: "",
            next: response.metadata?.next,
          },
          results: response.results as SqlV1StatementResultResults,
        };

        this.os.batch(() => {
          // Store raw changelog data in order
          this._rawResults([...priorRawResults, ...(resultsData?.data ?? [])]);

          // Process results for table view
          parseResults({
            columns: this.statement.status?.traits?.schema?.columns ?? [],
            isAppendOnly: this.statement.status?.traits?.is_append_only ?? true,
            upsertColumns: this.statement.status?.traits?.upsert_columns,
            limit: this.resultLimit,
            map: priorResults,
            rows: resultsData.data,
          });
          this._filteredResults(this.filterResultsBySearch());
          // Check if we have more results to fetch
          if (extractPageToken(response?.metadata?.next) === undefined) {
            this._moreResults(false);
            this._state("completed");
          }
          this._latestError(null);
          this._latestResult(clientFormatResponse);
          this.notifyUI();
        });
      } catch (error) {
        if (error instanceof FetchError && error?.cause?.name === "AbortError") {
          logger.info("Statement results fetch was aborted");
          return;
        }

        if (error instanceof HttpError) {
          const status = error.status;
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
                extra: { status: status.toString() },
              });
              void showErrorNotificationWithButtons(
                "Error response while fetching statement results.",
              );
              break;
            }
          }
          logger.error(`An error occurred during statement results fetching. Status ${status}`);
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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .some(([_, value]) => value !== null && String(value).toLowerCase().includes(searchLower)),
    );
  }

  /**
   * Checks if the error is a 409 Conflict error.
   */
  private is409ConflictError(err: unknown): boolean {
    // Check for HttpError (from CCloudDataPlaneProxy)
    if (err instanceof HttpError && err.status === 409) {
      return true;
    }
    // Check for OpenAPI client ResponseError (legacy)
    if (isResponseErrorWithStatus(err, 409)) {
      return true;
    }
    return false;
  }

  /**
   * Retries {@link maxRetries} times with a constant backoff delay of
   * {@link backoffMs}. Nothing fancy.
   */
  private async retry<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 60,
    backoffMs: number = 500,
  ): Promise<T> {
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastErr = err as Error;
        if (this.is409ConflictError(err)) {
          if (attempt < maxRetries - 1) {
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
      await this.retry(async () => {
        await this._stopStatement();
      }, "stop statement");
    } catch (err) {
      logError(err, "Failed to stop Flink statement", {
        extra: { functionName: "stopStatement" },
      });
      this._latestError({ message: "Failed to stop Flink statement" });
    }
  }

  /** Open up a read-only view over the statement's sources SQL. */
  private async viewStatementSource(): Promise<void> {
    await vscode.commands.executeCommand("confluent.statements.viewstatementsql", this.statement);
  }

  private async _stopStatement() {
    await this.resourceLoader.stopFlinkStatement(this.statement);
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
          total: this._viewMode() === "table" ? this._results().size : this._rawResults().length,
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
      case "GetSearchQuery": {
        return this._searchQuery();
      }
      case "GetSearchSource": {
        const query = this._searchQuery();
        if (!query || query.length === 0) {
          return null;
        }
        // Escape special characters for safe use in regex operations for highlighting
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return escaped;
      }
      case "GetStatementMeta": {
        return {
          name: this.statement.name,
          status: this.statement.status?.phase,
          startTime: this.statement.metadata?.created_at ?? null,
          detail: this.statement.status?.detail ?? null,
          failed: this.statement.failed,
          stoppable: this.statement.stoppable,
          areResultsViewable: this.statement.canRequestResults,
          possiblyViewable: this.statement.possiblyViewable,
          isForeground: this.statement.isForeground,
        };
      }
      case "StopStatement": {
        return this.stopStatement();
      }
      case "ViewStatementSource": {
        return this.viewStatementSource();
      }
      case "SetViewMode": {
        this._viewMode(body.viewMode! as ViewMode);
        this._filteredResults(this.filterResultsBySearch());
        this.notifyUI();
        return null;
      }
      case "GetViewMode": {
        return this._viewMode();
      }
      default: {
        const _exhaustiveCheck: never = type;
        return _exhaustiveCheck;
      }
    }
  }

  private getResultsArray() {
    return this._viewMode() === "table"
      ? Array.from(this._results().values()).map((row: Map<string, any>) => Object.fromEntries(row))
      : Array.from(this._rawResults());
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
