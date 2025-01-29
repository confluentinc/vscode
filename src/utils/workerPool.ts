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
export function isSuccessResult<R>(
  result: ExecutionResult<R> | undefined,
): result is SuccessResult<R> {
  return result?.result !== undefined;
}

/** Type guard to check if an {@link ExecutionResult} is an {@link ErrorResult}. */
export function isErrorResult(result: ExecutionResult<unknown> | undefined): result is ErrorResult {
  return result?.error !== undefined;
}

interface WorkerPoolOptions {
  maxWorkers: number;
  taskName?: string;
}

/**
 * Execute a callback against an array of (non-`undefined`) items using a worker pool pattern.
 * Results will be returned in the same order as the input items, with each result containing either
 * a result or an error.
 *
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
  options: WorkerPoolOptions = { maxWorkers: 2 },
  progress?: Progress<{
    message?: string;
    increment?: number;
  }>,
  token?: CancellationToken,
): Promise<ExecutionResult<R>[]> {
  // maxWorkers must be at least 2 and no more than 100
  options.maxWorkers = Math.max(2, Math.min(options.maxWorkers, 100));
  logger.debug("worker pool execution started", {
    taskName: options.taskName,
    maxWorkers: options.maxWorkers,
    itemCount: items.length,
  });
  // `undefined` placeholders for results to preserve ordering
  const results: ExecutionResult<R>[] = new Array(items.length).fill(undefined);

  const totalCount = items.length;
  const progressTick = { increment: 100 / totalCount };
  let currentIndex = 0;
  let resultCount = 0;
  let errorCount = 0;

  async function worker(): Promise<void> {
    while (currentIndex < totalCount && !token?.isCancellationRequested) {
      // store the current index in a separate variable so we can use it to set the result/error and
      // preserve ordering of the original items
      const taskIndex = currentIndex;
      const item: T | undefined = items[currentIndex++];
      if (!item) {
        // no support for passing `undefined` items into the callback
        continue;
      }

      try {
        const result: R = await callable(item);
        // XXX: only enable for local debugging/testing because this can get very noisy
        // logger.info("worker pool task finished", {
        //   result,
        //   currentIndex,
        //   totalCount,
        //   taskName: options.taskName,
        // });
        resultCount++;
        // don't .push() directly since we want to preserve the order of the original items
        results[taskIndex] = { result };
      } catch (error) {
        errorCount++;
        logError(error, "workerPool", {
          taskName: String(options.taskName),
          errorCount: errorCount.toString(),
          resultCount: resultCount.toString(),
          totalCount: totalCount.toString(),
        });
        if (error instanceof Error) {
          results[taskIndex] = { error };
        }
        // no re-throwing here; let the callers handle that if needed
      }

      if (progress) {
        // update any attached progress reporters (e.g. vscode.window.withProgress)
        progress.report(progressTick);
      }
    }
  }

  // set up the initial workers; no less than 2 and no more than the total number of items provided
  // (the workers themselves don't return anything; leave that to the inner function to set results)
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(options.maxWorkers, totalCount); i++) {
    workers.push(worker());
  }
  // wait for all workers to finish their task loops
  await Promise.all(workers);

  if (token?.isCancellationRequested) {
    logger.debug("worker execution stopped early", {
      taskName: options.taskName,
      errorCount,
      resultCount,
      totalCount,
    });
  }

  return results;
}
