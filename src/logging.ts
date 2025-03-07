import { createWriteStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { LogOutputChannel, OutputChannel, window } from "vscode";

export const LOGFILE_NAME = `vscode-confluent-${process.pid}.log`;
/**
 * Default path to store downloadable log files for this extension instance.
 *
 * The main difference between this and the ExtensionContext.logUri (where LogOutputChannel lines
 * are written) is this will include ALL log levels, not just the ones enabled in the output channel.
 */
export const LOGFILE_PATH: string = join(tmpdir(), LOGFILE_NAME);

/**
 * Main "Confluent" output channel.
 * @remarks We're using a {@link LogOutputChannel} instead of a {@link OutputChannel}
 * because it includes timestamps and colored log levels in the output by default.
 */
export const outputChannel = window.createOutputChannel("Confluent", { log: true });

const callpointCounter = new Map<string, number>();

/**
 * Lightweight wrapper class using `console` log methods with timestamps, log levels, and original
 * logger name. Also appends messages and additional args to the "Confluent" output channel and
 * associated log file.
 */
export class Logger {
  constructor(private name: string) {}

  /** Returns a new 'bound' logger with a common prefix to correlate a sequence of calls with */
  public withCallpoint(callpoint: string): Logger {
    const count = callpointCounter.get(callpoint) || 0;
    callpointCounter.set(callpoint, count + 1);
    return new Logger(`${this.name}[${callpoint}.${count}]`);
  }

  /** More verbose form of "debug" according to the LogOutputChannel */
  trace(message: string, ...args: any[]) {
    const prefix = this.logPrefix("trace");
    console.debug(prefix, message, ...args);
    this.logToOutputChannelAndFile(outputChannel.trace, prefix, message, ...args);
  }

  debug(message: string, ...args: any[]) {
    const prefix = this.logPrefix("debug");
    console.debug(prefix, message, ...args);
    this.logToOutputChannelAndFile(outputChannel.debug, prefix, message, ...args);
  }

  log(message: string, ...args: any[]) {
    return this.info(message, ...args);
  }

  info(message: string, ...args: any[]) {
    const prefix = this.logPrefix("info");
    console.info(prefix, message, ...args);
    this.logToOutputChannelAndFile(outputChannel.info, prefix, message, ...args);
  }

  warn(message: string, ...args: any[]) {
    const prefix = this.logPrefix("warning");
    console.warn(prefix, message, ...args);
    this.logToOutputChannelAndFile(outputChannel.warn, prefix, message, ...args);
  }

  error(message: string, ...args: any[]) {
    const prefix = this.logPrefix("error");
    console.error(prefix, message, ...args);
    this.logToOutputChannelAndFile(outputChannel.error, prefix, message, ...args);
  }

  private logPrefix(level: string): string {
    const timestamp = new Date().toISOString();
    return `${timestamp} [${level}] [${this.name}]`;
  }

  private logToOutputChannelAndFile(
    func: (message: string, ...args: any[]) => void,
    prefix: string,
    message: string,
    ...args: any[]
  ): void {
    try {
      func(`[${this.name}] ${message}`, ...args);
      // not awaiting this, as it's not critical to the operation
      this.writeToLogFile(prefix, message, ...args);
    } catch {
      // ignore if the channel is disposed or the log file write fails
    }
  }

  /** Create a stream to write to the log file in "append" mode, write the log contents to it, and
   * then close the stream. */
  private writeToLogFile(prefix: string, message: string, ...args: any[]) {
    const argString = args.map((arg) => JSON.stringify(arg)).join(" ");
    const formattedMessage = `${prefix} ${message} ${argString}\n`;

    return new Promise<void>((resolve, reject) => {
      const logWriteStream = createWriteStream(LOGFILE_PATH, { flags: "a" });
      logWriteStream.once("error", (error) => {
        console.error("Error writing to log file:", error);
        logWriteStream.end();
        reject(error);
      });
      logWriteStream.write(Buffer.from(formattedMessage), (error) => {
        if (error) {
          console.error("Error writing to log file:", error);
          logWriteStream.end();
          reject(error);
        }
        // waits for any remaining data to be written to the file before closing the stream
        logWriteStream.end(() => resolve());
      });
    });
  }
}
