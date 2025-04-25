import { Data } from "dataclass";
import { ObservableScope } from "inertial";
import {
  commands,
  ExtensionContext,
  ViewColumn,
  WebviewPanel,
  window,
} from "vscode";
import { ResponseError } from "./clients/sidecar";
import { registerCommandWithLogging } from "./commands";
import { getExtensionContext } from "./context/extension";
import { Logger } from "./logging";
import { FlinkStatement } from "./models/flinkStatement";
import { CCloudFlinkComputePool } from "./models/flinkComputePool";
import { FlinkStatementsViewProvider } from "./viewProviders/flinkStatements";
import { GetSqlv1StatementResult200Response, SqlV1StatementResultResults } from "./clients/flinkSql";
import { scheduler } from "./scheduler";
import { getSidecar, type SidecarHandle } from "./sidecar";
import { WebviewPanelCache } from "./webview-cache";
import { handleWebviewMessage } from "./webview/comms/comms";
import { type post } from "./webview/flink-statement-results";
import flinkStatementResults from "./webview/flink-statement-results.html";
import { logError, showErrorNotificationWithButtons } from "./errors";
import { Stream } from "./stream/stream";
import { parseResults, DEFAULT_RESULTS_LIMIT } from "./utils/flinkStatementResults";

const logger = new Logger("flink-statement-results");

export function activateFlinkStatementResultsViewer(context: ExtensionContext) {
  const schedule = scheduler(4, 500);

  let activeStatement: FlinkStatement | null = null;
  let activeConfig: FlinkStatementResultsViewerConfig | null = null;
  const cache = new WebviewPanelCache();

  context.subscriptions.push(
    registerCommandWithLogging(
      "confluent.flinkStatementResults",
      async (
        statement?: FlinkStatement,
        duplicate = false,
        config = FlinkStatementResultsViewerConfig.create(),
      ) => {
        const sidecar = await getSidecar();
        if (statement === undefined || statement === null) {
          return;
        }

        activeStatement = statement;
        activeConfig = config;
        const [panel, cached] = cache.findOrCreate(
          {
            id: `${statement.environmentId}/${statement.name}`,
            multiple: duplicate,
            template: flinkStatementResults,
          },
          "flink-statement-results",
          `Statement: ${statement.name}`,
          ViewColumn.One,
          { enableScripts: true },
        );

        if (cached) {
          panel.reveal();
        } else {
          panel.onDidChangeViewState((e) => {
            if (e.webviewPanel.active) {
              activeStatement = statement;
              activeConfig = config;
            }
          });

          flinkStatementResultsStartPollingCommand(
            panel,
            config,
            (value) => (activeConfig = config = value),
            statement,
            sidecar,
            schedule,
          );
        }
      },
    ),
  );
}

type MessageSender = OverloadUnion<typeof post>;
type MessageResponse<MessageType extends string> = Awaited<
  ReturnType<Extract<MessageSender, (type: MessageType, body: any) => any>>
>;

/**
 * Extracts the page token from a next page URL.
 * @param nextUrl The full URL from metadata.next
 * @returns The extracted page token, or undefined if not found
 */
function extractPageToken(nextUrl: string | undefined): string | undefined {
  if (!nextUrl) return undefined;
  try {
    const url = new URL(nextUrl);
    return url.searchParams.get("page_token") ?? undefined;
  } catch {
    return undefined;
  }
}

function flinkStatementResultsStartPollingCommand(
  panel: WebviewPanel,
  config: FlinkStatementResultsViewerConfig,
  onConfigChange: (config: FlinkStatementResultsViewerConfig) => void,
  statement: FlinkStatement,
  sidecar: SidecarHandle,
  schedule: <T>(cb: () => Promise<T>, signal?: AbortSignal) => Promise<T>,
) {
  const computePool: CCloudFlinkComputePool | null =
    FlinkStatementsViewProvider.getInstance().computePool;
  if (computePool === null) {
    throw new Error("Compute pool not found");
  }

  const service = sidecar.getFlinkSqlStatementResultsApi({
    environmentId: computePool?.environmentId,
    provider: computePool?.provider,
    region: computePool?.region,
  });

  const fetchResults = async (
    page_token: string | undefined,
    signal: AbortSignal,
  ): Promise<GetSqlv1StatementResult200Response> => {
    const response = await service.getSqlv1StatementResult(
      {
        environment_id: statement.environmentId,
        organization_id: statement.organizationId,
        name: statement.name,
        page_token: page_token,
      },
      { signal },
    );

    return response;
  };

  const os = ObservableScope();

  /** Is stream currently running or being paused?  */
  const state = os.signal<"running" | "paused">("running");
  const timer = os.signal(Timer.create());

  /** The results map that holds the statement results. */
  const results = os.signal(new Map<string, any>());
  /** A boolean that indicates if the results reached its capacity. */
  const isResultsFull = os.signal(false);

  /** Most recent response payload from Flink API. */
  const latestResult = os.signal<GetSqlv1StatementResult200Response | null>(null);
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

  os.watch(() => {
    onConfigChange(
      config.copy({
        messageLimit: config.messageLimit,
      }),
    );
  });

  os.watch(async (signal) => {
    if (state() !== "running") return;

    try {
      const nextPageToken = extractPageToken(latestResult()?.metadata?.next);
      logger.info(`Fetching statement results for ${statement.name}`);
      const response = await schedule(() => fetchResults(nextPageToken, signal), signal);
      const resultsData: SqlV1StatementResultResults = response.results ?? {};

      os.batch(() => {
        results(() =>
          parseResults({
            columns: statement.status?.traits?.schema?.columns ?? [],
            isAppendOnly: statement.status?.traits?.is_append_only ?? true,
            upsertColumns: statement.status?.traits?.upsert_columns ?? [],
            limit: config.messageLimit,
            map: results(),
            rows: resultsData.data,
          }),
        );
        latestError(null);
        notifyUI();
      });

      // Fetch statement results every 800 ms.
      setTimeout(() => latestResult(response), 800);
    } catch (error) {
      let reportable: { message: string } | null = null;
      let shouldPause = false;

      if (error instanceof Error && error.name === "AbortError") return;

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

      os.batch(() => {
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
      case "GetResults": {
        const offset = body.page * body.pageSize;
        const limit = body.pageSize;
        const allResults = Array.from(results().values());
        const paginatedResults = allResults.slice(offset, offset + limit);
        return {
          results: paginatedResults,
        } satisfies MessageResponse<"GetResults">;
      }
      case "GetResultsCount": {
        const count = results().size;
        return { total: count, filter: null } satisfies MessageResponse<"GetResultsCount">;
      }
      case "GetSchema": {
        if (!statement) {
          return { columns: [] } satisfies MessageResponse<"GetSchema">;
        }
        return (statement.status?.traits?.schema ?? {
          columns: [],
        }) satisfies MessageResponse<"GetSchema">;
      }
      case "GetMaxSize": {
        return String(config.messageLimit) satisfies MessageResponse<"GetMaxSize">;
      }
      case "ResultLimitChange": {
        const newLimit = body.limit;
        config = config.copy({ messageLimit: newLimit });
        results(new Map());
        isResultsFull(false);
        state("running");
        timer((timer) => timer.resume());
        return null satisfies MessageResponse<"ResultLimitChange">;
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
      case "StreamPause": {
        state("paused");
        timer((timer) => timer.pause());
        return null satisfies MessageResponse<"StreamPause">;
      }
      case "StreamResume": {
        state("running");
        timer((timer) => timer.resume());
        return null satisfies MessageResponse<"StreamResume">;
      }
      default: {
        const _exhaustiveCheck: never = type;
        return _exhaustiveCheck;
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

/**
 * Represents static snapshot of flink statement results viewer state that can be serialized.
 */
export class FlinkStatementResultsViewerConfig extends Data {
  messageLimit: number = 100_000;

  static fromQuery(params: URLSearchParams) {
    let value: string | null;
    let config: Partial<FlinkStatementResultsViewerConfig> = {};

    value = params.get("messageLimit");
    if (value != null) {
      const parsed = parseInt(value, 10);
      if (!Number.isNaN(parsed) && [1_000_000, 100_000, 10_000, 1_000, 100].includes(parsed)) {
        config.messageLimit = parsed;
      }
    }

    return FlinkStatementResultsViewerConfig.create(config);
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
