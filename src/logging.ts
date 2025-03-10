import { tmpdir } from "os";
import { createStream, RotatingFileStream } from "rotating-file-stream";
import { LogOutputChannel, window } from "vscode";

/**
 * Default path to store downloadable log files for this extension instance.
 *
 * The main difference between this and the ExtensionContext.logUri (where LogOutputChannel lines
 * are written) is this will include ALL log levels, not just the ones enabled in the output channel.
 */
export const LOGFILE_DIR = tmpdir();

/** Max size of any log file written to disk.
 * @see https://github.com/iccicci/rotating-file-stream?tab=readme-ov-file#size */
const MAX_LOGFILE_SIZE = "15K"; // 10MB max file size

/** Number of log files to keep.
 * @see https://github.com/iccicci/rotating-file-stream?tab=readme-ov-file#maxfiles */
const MAX_LOGFILES = 3; // only keep 3 log files at a time

/** How often log files should rotate if they don't exceed {@link MAX_LOGFILE_SIZE}.
 * @see https://github.com/iccicci/rotating-file-stream?tab=readme-ov-file#interval */
const LOGFILE_ROTATION_INTERVAL = "1d"; // rotate log files daily

/**
 * Main "Confluent" output channel.
 * @remarks We're using a {@link LogOutputChannel} instead of an `OutputChannel`
 * because it includes timestamps and colored log levels in the output by default.
 */
export const OUTPUT_CHANNEL: LogOutputChannel = window.createOutputChannel("Confluent", {
  log: true,
});

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
    this.logToOutputChannelAndFile("trace", prefix, message, ...args);
  }

  debug(message: string, ...args: any[]) {
    const prefix = this.logPrefix("debug");
    console.debug(prefix, message, ...args);
    this.logToOutputChannelAndFile("debug", prefix, message, ...args);
  }

  log(message: string, ...args: any[]) {
    return this.info(message, ...args);
  }

  info(message: string, ...args: any[]) {
    const prefix = this.logPrefix("info");
    console.info(prefix, message, ...args);
    this.logToOutputChannelAndFile("info", prefix, message, ...args);
  }

  warn(message: string, ...args: any[]) {
    const prefix = this.logPrefix("warning");
    console.warn(prefix, message, ...args);
    this.logToOutputChannelAndFile("warn", prefix, message, ...args);
  }

  error(message: string, ...args: any[]) {
    const prefix = this.logPrefix("error");
    console.error(prefix, message, ...args);
    this.logToOutputChannelAndFile("error", prefix, message, ...args);
  }

  private logPrefix(level: string): string {
    const timestamp = new Date().toISOString();
    return `${timestamp} [${level}] [${this.name}]`;
  }

  private logToOutputChannelAndFile(
    level: string,
    prefix: string,
    message: string,
    ...args: any[]
  ): void {
    const fullMessage = `[${this.name}] ${message}`;
    try {
      switch (level) {
        case "trace":
          OUTPUT_CHANNEL.trace(fullMessage, ...args);
          break;
        case "debug":
          OUTPUT_CHANNEL.debug(fullMessage, ...args);
          break;
        case "info":
          OUTPUT_CHANNEL.info(fullMessage, ...args);
          break;
        case "warn":
          OUTPUT_CHANNEL.warn(fullMessage, ...args);
          break;
        case "error":
          OUTPUT_CHANNEL.error(fullMessage, ...args);
          break;
      }
      // don't write trace logs to the log file
      if (level !== "trace") {
        // TODO(shoup): move this.writeToLogFile() here after initial rotating file testing
      }
      this.writeToLogFile(prefix, message, ...args).catch(() => {
        // already logged, no need for additional handling. we still need this here so we don't
        // get unhandled promise rejections bubbling up.
      });
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
      try {
        const stream = getLogFileStream();
        stream.write(formattedMessage, (error) => {
          if (error) {
            console.error("Error writing to log file:", error);
            reject(error);
          } else {
            resolve();
          }
        });
      } catch (error) {
        console.error("Unexpected error during log file operations:", error);
        resolve();
      }
    });
  }
}

/** Single stream to allow rotating-file-stream to keep track of file sizes and rotation timing. */
let logFileStream: RotatingFileStream | undefined;

/** Creates a new rotating log file stream if it doesn't already exist. */
export function getLogFileStream(): RotatingFileStream {
  if (!logFileStream) {
    logFileStream = createStream(rotatingFilenameGenerator, {
      size: MAX_LOGFILE_SIZE,
      maxSize: MAX_LOGFILE_SIZE,
      maxFiles: MAX_LOGFILES,
      interval: LOGFILE_ROTATION_INTERVAL,
      path: LOGFILE_DIR,
      encoding: "utf-8",
    });
  }
  return logFileStream;
}

/**
 * Pads a number with leading zero if it's less than 10.
 * @param num - The number to pad.
 * @returns The padded number as a string.
 */
function pad(num: number): string {
  return (num > 9 ? "" : "0") + num;
}

/** Set of log file names that have already been created for this extension instance. */
const ROTATED_LOGFILE_NAMES = new Set<string>();

/** The name of the currently active log file, including time/index prefixing. */
export let CURRENT_LOGFILE_NAME: string;

/** The name of the log file, without any time/index prefixing. */
const LOGFILE_NAME = `vscode-confluent-${process.pid}.log`;

/**
 * Generates a rotating filename based on the current date and time, with an optional index.
 * The format is `YYYYMMDD-HHMM-index-logfile.log`.
 * @param time - The date/time to use for the filename. If not provided, defaults to the current date/time.
 * @param index - An optional index to append to the filename.
 * @returns The generated filename.
 */
function rotatingFilenameGenerator(time: number | Date, index?: number): string {
  const currentTime = new Date();
  const year = currentTime.getFullYear();
  const month = pad(currentTime.getMonth() + 1);
  const day = pad(currentTime.getDate());
  const hour = pad(currentTime.getHours());
  const minute = pad(currentTime.getMinutes());
  const newFileName = `${year}-${month}-${day}-${hour}${minute}-${index ?? 0}-${LOGFILE_NAME}`;
  ROTATED_LOGFILE_NAMES.add(newFileName);
  CURRENT_LOGFILE_NAME = newFileName;
  return newFileName;
}
