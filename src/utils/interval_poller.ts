import { Logger } from "../logging";

const IDLE_POLLING_FREQUENCY = 10 * 1000; // 10s
const WAITING_FOR_EVENT_FREQUENCY = 2 * 1000; // 2s

const logger = new Logger("utils.interval-poller");

/** Class to manage calling a function periodically either at
 * a regular or a higher frequency interval.
 */
export class IntervalPoller {
  private name: string;
  private idle_frequency: number;
  private active_frequency: number;

  private callback: () => void;
  private registeredInterval: NodeJS.Timeout | undefined;

  constructor(
    name: string,
    callback: () => void,
    idle_frequency: number = IDLE_POLLING_FREQUENCY,
    active_frequency: number = WAITING_FOR_EVENT_FREQUENCY,
  ) {
    if (idle_frequency < 1) {
      throw new Error("Idle frequency must be at least 1ms");
    }

    if (active_frequency < 1) {
      throw new Error("Active frequency must be at least 1ms");
    }

    if (idle_frequency <= active_frequency) {
      throw new Error("Idle frequency must be greater than active frequency");
    }

    this.name = name;
    this.callback = callback;
    this.idle_frequency = idle_frequency;
    this.active_frequency = active_frequency;
  }

  /** Start this interval poller. Returns true if actually started
   * this call (i.e. was not already started).
   */
  public start(): boolean {
    // Only start if not already started.
    if (!this.registeredInterval) {
      this.restart(this.idle_frequency);
      return true;
    }

    return false;
  }

  /**  Stop this poller. Returns true if stopped the interval timer
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

  /** Is this poller is currently running? */
  public isRunning() {
    return this.registeredInterval !== undefined;
  }

  /** Switch to the high-frequency interval. Will start() the
   * poller if it's not already running.
   */
  public useHighFrequency() {
    // If we're expecting a connection to be created, we should poll the reconciler
    // more frequently to catch the new connection as soon as possible.
    logger.info(`${this.name}: polling more frequently`);
    this.restart(this.active_frequency);
  }

  /** Switch (back) to the regular idle frequency. Will start() the
   * poller if it's not already running.
   */
  public useRegularFrequency() {
    // Go back to the normal idle polling frequency. Either found what we were looking for
    // or the user canceled the make new connection flow.
    logger.info(`${this.name}: back to regular frequency`);
    this.restart(this.idle_frequency);
  }

  /**
   * Start (or restart) calling our polling function with the given frequency.
   * @param frequency The frequency at which to interval call. Will be either
   * the idle frequency or the active frequency.
   */
  private restart(frequency: number): void {
    // Out with the old interval?
    if (this.registeredInterval) {
      clearInterval(this.registeredInterval);
    }
    // In with the new frequency.
    this.registeredInterval = setInterval(() => {
      this.callback();
    }, frequency);
  }
}
