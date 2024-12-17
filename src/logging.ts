import { createWriteStream, WriteStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { LogOutputChannel, OutputChannel, window } from "vscode";

/**
 * Default path to store downloadable log files for this extension instance.
 *
 * The main difference between this and the ExtensionContext.logUri (where LogOutputChannel lines
 * are written) is this will include ALL log levels, not just the ones enabled in the output channel.
 */
export let LOGFILE_PATH: string = join(tmpdir(), "vscode-confluent.log");

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
  constructor(private name: string) {
    ensureLogWriteStream();
  }

  /** Returns a new 'bound' logger with a common prefix to correlate a sequence of calls with */
  public withCallpoint(callpoint: string): Logger {
    const count = callpointCounter.get(callpoint) || 0;
    callpointCounter.set(callpoint, count + 1);
    return new Logger(`${this.name} ${callpoint} ${count}`);
  }

  /** More verbose form of "debug" according to the LogOutputChannel */
  trace(message: string, ...args: any[]) {
    const prefix = this.logPrefix("trace");
    console.debug(prefix, message, ...args);
    this.appendToOutputChannel(outputChannel.trace, prefix, message, ...args);
  }

  debug(message: string, ...args: any[]) {
    const prefix = this.logPrefix("debug");
    console.debug(prefix, message, ...args);
    this.appendToOutputChannel(outputChannel.debug, prefix, message, ...args);
  }

  log(message: string, ...args: any[]) {
    return this.info(message, ...args);
  }

  info(message: string, ...args: any[]) {
    const prefix = this.logPrefix("info");
    console.info(prefix, message, ...args);
    this.appendToOutputChannel(outputChannel.info, prefix, message, ...args);
  }

  warn(message: string, ...args: any[]) {
    const prefix = this.logPrefix("warning");
    console.warn(prefix, message, ...args);
    this.appendToOutputChannel(outputChannel.warn, prefix, message, ...args);
  }

  error(message: string, ...args: any[]) {
    const prefix = this.logPrefix("error");
    console.error(prefix, message, ...args);
    this.appendToOutputChannel(outputChannel.error, prefix, message, ...args);
  }

  private logPrefix(level: string): string {
    const timestamp = new Date().toISOString();
    return `${timestamp} [${level}] [${this.name}]`;
  }

  private appendToOutputChannel(
    func: (message: string, ...args: any[]) => void,
    prefix: string,
    message: string,
    ...args: any[]
  ): void {
    this.writeToLogFile(prefix, message, ...args);
    try {
      func(`[${this.name}] ${message}`, ...args);
    } catch {
      // ignore if the channel is disposed
    }
  }

  private async writeToLogFile(prefix: string, message: string, ...args: any[]) {
    if (!logWriteStream) {
      console.error("Log write stream not initialized");
      return;
    }
    const argString = args.map((arg) => JSON.stringify(arg)).join(" ");
    const formattedMessage = `${prefix} ${message} ${argString}\n`;
    return new Promise<void>((resolve, reject) => {
      logWriteStream!.write(Buffer.from(formattedMessage), (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

/** The stream used to write to the log file. */
let logWriteStream: WriteStream | undefined;

/** Initialize the log write stream if not already created. */
function ensureLogWriteStream() {
  if (!logWriteStream) {
    logWriteStream = createWriteStream(LOGFILE_PATH, { flags: "a" });
    logWriteStream.on("error", (err) => {
      console.error("Error writing to log file:", err);
    });
  }
}

/**
 * "Dispose of" the {@link WriteStream} for this extension instance's log file, used during this
 * extension instance's deactivation process.
 */
export function disposeLogWriteStream() {
  if (logWriteStream) {
    console.info("Closing log file write stream");
    logWriteStream.end();
    logWriteStream = undefined;
  }
}
