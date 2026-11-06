import { Logger } from "../logging";

const SLOW_POLLING_FREQUENCY = 10 * 1000; // 10s

/** First delay of the house backoff curve. */
const BACKOFF_BASE_MS = 1000;
/** Growth per retry of the house backoff curve. */
const BACKOFF_FACTOR = 1.6;
/** Jitter added on top of each delay, as a fraction of it. Additive, so it never shortens a wait. */
const BACKOFF_JITTER_RATIO = 0.2;

const logger = new Logger("utils.timing");

/**
 * Pause for a random amount of time between minMs and maxMs. Returns early, clearing the timer, if
 * the optional signal aborts.
 */
export async function pauseWithJitter(
  minMs: number,
  maxMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (minMs < 0 || maxMs < 0) {
    throw new Error(`minMs (${minMs}) and maxMs (${maxMs}) must be >= 0`);
  }
  if (minMs > maxMs) {
    throw new Error(`minMs (${minMs}) must be <= maxMs (${maxMs})`);
  }
  if (signal?.aborted) {
    return;
  }
  const pause_ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  logger.debug(`pauseWithJitter(): Pausing for ${pause_ms} ms`);
  await new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, pause_ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface BackoffOptions {
  /**
   * Ceiling on the exponential delay, and the longest server-requested wait the caller will
   * honor. A longer server wait ends the retry with the error rather than retrying early.
   */
  capMs: number;
  /** First delay. Defaults to {@linkcode BACKOFF_BASE_MS}. */
  baseMs?: number;
}

export interface RetryWithBackoffOptions extends BackoffOptions {
  /** Names the operation in logs. */
  operationName: string;
  /** Retries allowed on top of the first attempt. */
  maxRetries: number;
  /** Whether a failure may clear on its own. Only retry idempotent operations. */
  shouldRetry: (err: unknown) => boolean;
  /** Aborting ends a pending wait early and rethrows the failure that started it. */
  signal?: AbortSignal;
}

/**
 * Run an operation, retrying failures that {@linkcode RetryWithBackoffOptions.shouldRetry} accepts
 * on the house backoff curve. A server-requested delay is a floor that is never shortened; when it
 * is longer than `capMs`, the failure is rethrown instead.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryWithBackoffOptions,
): Promise<T> {
  const { operationName, maxRetries, shouldRetry, signal } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (err) {
      if (attempt >= maxRetries || !shouldRetry(err)) {
        throw err;
      }
      const response = responseOf(err);
      const serverDelayMs = response ? serverRequestedDelayMs(response) : undefined;
      if (serverDelayMs !== undefined && serverDelayMs > options.capMs) {
        logger.info(
          `Not retrying ${operationName}: server asked for ${serverDelayMs}ms, over the ${options.capMs}ms cap`,
        );
        throw err;
      }
      const { minMs, maxMs } = backoffWindow(attempt, options, serverDelayMs);
      logger.debug(
        `Retrying ${operationName} after status ${response?.status ?? "n/a"}. Attempt ${attempt + 1}/${maxRetries}, waiting ${minMs}-${maxMs}ms`,
      );
      await pauseWithJitter(minMs, maxMs, signal);
      if (signal?.aborted) {
        throw err;
      }
    }
  }
}

/**
 * The wait before retry number `attempt + 1`: `baseMs * 1.6^attempt` capped at `capMs`, raised to
 * any server-requested delay, plus up to 20% jitter on top.
 */
export function backoffWindow(
  attempt: number,
  { capMs, baseMs = BACKOFF_BASE_MS }: BackoffOptions,
  serverDelayMs?: number,
): { minMs: number; maxMs: number } {
  // rounded, since 1.6^n carries float noise
  const curveMs = Math.round(Math.min(baseMs * BACKOFF_FACTOR ** attempt, capMs));
  const minMs = Math.max(curveMs, Math.ceil(serverDelayMs ?? 0));
  return { minMs, maxMs: Math.round(minMs * (1 + BACKOFF_JITTER_RATIO)) };
}

/**
 * The delay a response asked for, in ms: `Retry-After` as seconds or an HTTP-date (RFC 9110
 * section 10.2.3), else, on a 429, `X-RateLimit-Reset`, which Confluent Cloud sends as seconds until
 * the rate limit window resets. Undefined when the header in use holds no delay in the future.
 */
export function serverRequestedDelayMs(response: Response): number | undefined {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    // a zero or past Retry-After means "retry now", so it still outranks X-RateLimit-Reset
    return secondsToMs(retryAfter) ?? untilDateMs(retryAfter);
  }
  // CCloud sends X-RateLimit-Reset on every response, so it only explains a wait on a 429
  return response.status === 429
    ? secondsToMs(response.headers.get("x-ratelimit-reset"))
    : undefined;
}

/**
 * The HTTP response a failure carries, read structurally so this module needn't import every
 * generated client's `ResponseError` class.
 */
function responseOf(err: unknown): Response | undefined {
  const response = (err as { response?: Partial<Response> } | undefined)?.response;
  return typeof response?.headers?.get === "function" ? (response as Response) : undefined;
}

function secondsToMs(header: string | null): number | undefined {
  const seconds = Number(header);
  return header && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

function untilDateMs(header: string | null): number | undefined {
  const delayMs = header ? Date.parse(header) - Date.now() : NaN;
  return delayMs > 0 ? delayMs : undefined;
}

/**
 * A signal that aborts with a `TimeoutError` after `ms`, or with the caller's reason if their signal
 * aborts first. Call `clear()` once the work settles, which stops the timer and detaches from the
 * caller's signal (unlike `AbortSignal.timeout()`, whose timer can't be cancelled).
 */
export function timeoutSignal(
  ms: number,
  callerSignal?: AbortSignal | null,
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  const timer = setTimeout(
    () => controller.abort(new DOMException(`Timed out after ${ms}ms`, "TimeoutError")),
    ms,
  );
  if (callerSignal?.aborted) {
    onCallerAbort();
  } else {
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    },
  };
}

/** A request got no answer within its time budget. */
export class RequestTimeoutError extends Error {
  constructor(what: string, timeoutMs: number, cause: unknown) {
    super(`${what} timed out after ${timeoutMs / 1000}s`, { cause });
    this.name = "RequestTimeoutError";
  }
}

/** Whether an abort reason came from a timeout rather than a caller's own abort. */
export function isTimeoutReason(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "TimeoutError";
}

/**
 * Race the given promise against a timeout.
 * @param promise The promise to race against the timeout.
 * @param ms The timeout in milliseconds.
 * @returns A new promise that resolves or rejects with the result of the given promise,
 * or rejects with a timeout error if the timeout is exceeded.
 */
export function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout exceeded")), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Class to manage calling a function periodically either at a slower or a faster frequency interval.
 *
 * If `runImmediately` is set to `true`, the callback will be called immediately when the poller is
 * started. Otherwise, the callback will be called after the first interval has passed.
 */
export class IntervalPoller {
  private name: string;

  readonly slowFrequency: number;
  readonly fastFrequency: number | undefined;
  currentFrequency: number;

  runImmediately: boolean = false;

  private callback: () => void;
  /** The current interval timer, if it is currently running. */
  private registeredInterval: NodeJS.Timeout | undefined;

  constructor(
    name: string,
    callback: () => void,
    slowFrequency: number = SLOW_POLLING_FREQUENCY,
    fastFrequency: number | undefined = undefined,
    runImmediately: boolean = false,
  ) {
    if (slowFrequency < 1) {
      throw new Error("Slow frequency must be at least 1ms");
    }

    if (fastFrequency !== undefined) {
      if (fastFrequency < 1) {
        throw new Error("Fast frequency must be at least 1ms");
      }

      if (slowFrequency <= fastFrequency) {
        throw new Error("Slow frequency must be greater than high frequency");
      }
    }

    this.name = name;
    this.callback = callback;

    this.slowFrequency = slowFrequency;
    this.fastFrequency = fastFrequency;
    // set slow to start
    this.currentFrequency = slowFrequency;

    this.runImmediately = runImmediately;
  }

  /** Start this interval poller. Returns true if actually started
   * this call (i.e. was not already started).
   */
  public start(): boolean {
    // Only start if not already started.
    if (!this.registeredInterval) {
      this.restart(this.currentFrequency);
      return true;
    }

    return false;
  }

  /** Stop this poller. Returns true if stopped the interval timer
   * this call (i.e. was actually running).
   */
  public stop(): boolean {
    if (this.registeredInterval) {
      clearInterval(this.registeredInterval);
      this.registeredInterval = undefined;
      return true;
    }

    return false;
  }

  dispose() {
    this.stop();
  }

  /** Is this poller is currently running? */
  public isRunning() {
    return this.registeredInterval !== undefined;
  }

  /** Switch to the faster interval polling. Will start() the poller if it's not already running.
   * Will not take any action if the poller is already running at the fast frequency.
   */
  public useFastFrequency() {
    if (!this.fastFrequency) {
      throw new Error("Fast frequency is not set");
    }

    logger.trace(`${this.name}: using fast frequency polling interval`, {
      fastFrequency: `${this.fastFrequency}ms`,
      slowFrequency: `${this.slowFrequency}ms`,
    });
    // only restart if we're not already running or we're changing from slow->fast frequency
    if (!this.isRunning() || this.currentFrequency !== this.fastFrequency) {
      this.restart(this.fastFrequency);
    }
  }

  /** Switch to the slower interval polling. Will start() the poller if it's not already running.
   * Will not take any action if the poller is already running at the slow frequency.
   */
  public useSlowFrequency() {
    logger.trace(`${this.name}: using slow frequency polling interval`, {
      fastFrequency: `${this.fastFrequency}ms`,
      slowFrequency: `${this.slowFrequency}ms`,
    });
    // only restart if we aren't running or we're changing from fast->slow frequency
    if (!this.isRunning() || this.currentFrequency !== this.slowFrequency) {
      this.restart(this.slowFrequency);
    }
  }

  /**
   * Start (or restart) calling our function with the given frequency interval.
   * @param frequency The frequency at which to interval call. Will be either the slow frequency or
   * the fast frequency.
   */
  private restart(frequency: number): void {
    this.currentFrequency = frequency;
    // Out with the old interval?
    if (this.registeredInterval) {
      clearInterval(this.registeredInterval);
    }
    // In with the new frequency. (Done before any immediate call to ensure callbacks that may affect the poller don't trip up checking .isRunning())
    this.registeredInterval = setInterval(() => {
      // logger.trace(`${this.name}: calling callback function`);
      this.callback();
    }, frequency);
    // Run the callback immediately if the flag is set and then defer to the interval for subsequent calls.
    if (this.runImmediately) {
      logger.trace(`${this.name}: calling callback function immediately`);
      this.callback();
      this.runImmediately = false;
    }
  }
}
