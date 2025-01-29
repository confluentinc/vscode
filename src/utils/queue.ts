import { CancellationToken, Progress } from "vscode";

interface Result<R> {
  result?: R;
  error?: Error;
}

interface SuccessResult<R> extends Result<R> {
  result: R;
  error: undefined;
}

interface ErrorResult extends Result<unknown> {
  result: undefined;
  error: Error;
}

export function isSuccessResult<R>(result: Result<R>): result is SuccessResult<R> {
  return result.result !== undefined;
}

export function isErrorResult(result: Result<unknown>): result is ErrorResult {
  return result.error !== undefined;
}

export async function executeInWorkerPool<T, R>(
  items: T[],
  callable: (item: T) => Promise<R>,
  maxWorkers: number,
  returnErrors: boolean = false,
  progress?: Progress<{
    message?: string;
    increment?: number;
  }>,
  token?: CancellationToken,
): Promise<Result<R>[]> {
  const queue = [...items];
  const workers: Promise<void>[] = [];

  const results: Result<R>[] = [];

  async function startNext(): Promise<void> {
    const item = queue.shift();
    if (!item) return;
    if (token?.isCancellationRequested) {
      return;
    }

    try {
      const result: R = await callable(item);
      results.push({ result });
    } catch (error) {
      if (returnErrors && error instanceof Error) {
        results.push({ error });
      } else {
        throw error;
      }
    }

    if (progress) {
      progress.report({ increment: 1 });
    }

    await startNext();
  }

  for (let i = 0; i < Math.min(maxWorkers, items.length); i++) {
    const task = startNext();
    workers.push(task);
  }

  await Promise.all(workers);

  return results;
}
