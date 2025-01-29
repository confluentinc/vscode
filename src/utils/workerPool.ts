import { CancellationToken, Progress } from "vscode";
import { logError } from "../errors";
import { Logger } from "../logging";

const logger = new Logger("workerPool");

/** Result of a worker pool execution containing either a result or error. */
export interface ExecutionResult<R> {
  result?: R;
  error?: Error;
}

/** {@link ExecutionResult} that always includes a `result` and never an `error`. */
export interface SuccessResult<R> extends ExecutionResult<R> {
  result: R;
  error: undefined;
}

/** {@link ExecutionResult} that always includes an `error` and never a `result`. */
export interface ErrorResult extends ExecutionResult<unknown> {
  result: undefined;
  error: Error;
}

/** Type guard to check if an {@link ExecutionResult} is a {@link SuccessResult}. */
export function isSuccessResult<R>(result: ExecutionResult<R>): result is SuccessResult<R> {
  return result.result !== undefined;
}

/** Type guard to check if an {@link ExecutionResult} is an {@link ErrorResult}. */
export function isErrorResult(result: ExecutionResult<unknown>): result is ErrorResult {
  return result.error !== undefined;
}

interface WorkerPoolOptions {
  maxWorkers: number;
  taskName?: string;
  returnErrors: boolean;
}

/**
 * Execute a collection of items in parallel using a worker pool pattern.
 * @param items Array of items to process
 * @param callable Async function to execute for each item
 * @param options Worker pool options
 * @param progress Optional progress reporter
 * @param token Optional cancellation token
 * @returns Array of results, each containing either a result or error
 */
export async function executeInWorkerPool<T, R>(
  items: T[],
  callable: (item: T) => Promise<R>,
  options: WorkerPoolOptions = { maxWorkers: 1, returnErrors: false },
  progress?: Progress<{
    message?: string;
    increment?: number;
  }>,
  token?: CancellationToken,
): Promise<ExecutionResult<R>[]> {
  const callableArgs = [...items];
  // the tasks themselves don't return anything; leave that to the inner function to push to results
  const tasks: Promise<void>[] = [];
  const results: ExecutionResult<R>[] = [];

  const totalCount = items.length;
  let progressCount = 0;
  let resultCount = 0;
  let errorCount = 0;

  async function startNext(): Promise<void> {
    const item: T | undefined = callableArgs.shift();
    if (!item) {
      // no more items to process
      return;
    }

    try {
      const result: R = await callable(item);
      // XXX: only enable for local debugging because this can get very noisy
      // logger.debug("worker pool task finished", {
      //   progressCount,
      //   totalCount,
      //   taskName: options.taskName,
      // });
      resultCount++;
      results.push({ result });
    } catch (error) {
      errorCount++;
      logError(error, "workerPool", {
        taskName: String(options.taskName),
        errorCount: errorCount.toString(),
        resultCount: resultCount.toString(),
        totalCount: totalCount.toString(),
      });
      if (options.returnErrors && error instanceof Error) {
        results.push({ error });
      } else {
        throw error;
      }
    }

    progressCount++;
    if (progress) {
      // update any attached progress reporters (e.g. vscode.window.withProgress)
      progress.report({ increment: 100 / totalCount });
      // TODO: include configurable `message`?
    }

    if (!token?.isCancellationRequested) {
      // start the next task if the user didn't cancel early
      await startNext();
    }
  }

  for (let i = 0; i < Math.min(options.maxWorkers, totalCount); i++) {
    const task = startNext();
    tasks.push(task);
  }

  await Promise.all(tasks);

  if (progressCount < totalCount) {
    logger.debug("worker execution stopped early", {
      taskName: options.taskName,
      errorCount,
      resultCount,
      progressCount,
      totalCount,
      cancellationRequested: token?.isCancellationRequested,
    });
  }

  return results;
}
