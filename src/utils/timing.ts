import { Logger } from "../logging";

const SLOW_POLLING_FREQUENCY = 10 * 1000; // 10s

const logger = new Logger("utils.timing");

/** Pause for a random amount of time between minMs and maxMs. */
export async function pauseWithJitter(minMs: number, maxMs: number): Promise<void> {
  if (minMs < 0 || maxMs < 0) {
    throw new Error(`minMs (${minMs}) and maxMs (${maxMs}) must be >= 0`);
  }
  if (minMs > maxMs) {
    throw new Error(`minMs (${minMs}) must be <= maxMs (${maxMs})`);
  }
  const pause_ms = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
  logger.debug(`pauseWithJitter(): Pausing for ${pause_ms} ms`);
  await new Promise((timeout_resolve) => setTimeout(timeout_resolve, pause_ms));
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
