/**
 * Create a function that schedules async functions by given parameters:
 * 1. No more than `concurrency` functions being invoked at one moment
 * 2. At least `interval` time pass between calls within a single "thread"
 */
export function scheduler(concurrency: number, interval: number) {
  const { acquire, release } = semaphore(concurrency);
  return async function schedule<Result>(
    cb: () => Promise<Result>,
    signal?: AbortSignal,
  ): Promise<Result> {
    const handle = acquire();
    if (handle instanceof Promise) await handle;
    if (signal != null && signal.aborted) {
      release();
      throw new Error(signal.reason);
    }
    setTimeout(release, interval);
    return cb();
  };
}

/** @link https://en.wikipedia.org/wiki/Semaphore_(programming) */
export function semaphore(max: number) {
  let value = max;
  let queue: Array<() => void> = [];

  function acquire() {
    if (value > 0) return value-- > 0;
    return new Promise<boolean>((resolve) => {
      queue.push(() => resolve(acquire()));
    });
  }

  function release() {
    value++;
    let resolve = queue.shift();
    if (resolve != null) resolve();
  }

  return { acquire, release };
}
