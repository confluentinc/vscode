import { readdirSync, statSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { createStream, RotatingFileStream } from "rotating-file-stream";
import { LogOutputChannel, window } from "vscode";

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
        const stream: RotatingFileStream = getLogFileStream();
        if (stream.closed) {
          resolve();
          return;
        }
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

/**
 * Default path to store downloadable log files for this extension instance.
 *
 * The main difference between this and the ExtensionContext.logUri (where LogOutputChannel lines
 * are written) is this will include ALL log levels, not just the ones enabled in the output channel.
 */
export const LOGFILE_DIR = tmpdir();

/** The name of the currently active log file, including time/index prefixing. */
export let CURRENT_LOGFILE_NAME: string;

/** Set of log file names that have already been created for this extension instance. */
export const ROTATED_LOGFILE_NAMES: string[] = [];

/** Max size of any log file written to disk.
 * @see https://github.com/iccicci/rotating-file-stream?tab=readme-ov-file#size */
const MAX_LOGFILE_SIZE = "10M"; // 10MB max file size

/** Number of log files to keep.
 * @see https://github.com/iccicci/rotating-file-stream?tab=readme-ov-file#maxfiles */
const MAX_LOGFILES = 3; // only keep 3 **rotated** log files at a time for this extension instance

/** How often log files should rotate if they don't exceed {@link MAX_LOGFILE_SIZE}.
 * @see https://github.com/iccicci/rotating-file-stream?tab=readme-ov-file#interval */
const LOGFILE_ROTATION_INTERVAL = "1d"; // rotate log files daily

/** Single stream to allow rotating-file-stream to keep track of file sizes and rotation timing. */
let logFileStream: RotatingFileStream | undefined;

/** Creates a new rotating log file stream if it doesn't already exist. */
export function getLogFileStream(): RotatingFileStream {
  if (!logFileStream) {
    // don't use the `maxSize` option since that will interfere with proper rotation and cleanup by
    // immediately removing the created rotated log file
    logFileStream = createStream(rotatingFilenameGenerator, {
      size: MAX_LOGFILE_SIZE,
      maxFiles: MAX_LOGFILES,
      interval: LOGFILE_ROTATION_INTERVAL,
      path: LOGFILE_DIR,
      history: `vscode-confluent-${process.pid}.history.log`,
      encoding: "utf-8",
    });
  }
  return logFileStream;
}

/**
 * Generates a rotating filename based on the index, to be used in the `RotatingFileStream`'s
 * internal operations.
 *
 * The currently-active logfile will always end in `0.log`, and as new files are created, the older
 * files will be removed until the max number of files is reached.
 *
 * Example for a max of 3 log files:
 * First set of rotations:
 * - `vscode-confluent-1234.0.log` (current log file)
 * - `vscode-confluent-1234.1.log` (oldest log file)
 * - `vscode-confluent-1234.2.log`
 * - `vscode-confluent-1234.3.log` (new log file)
 *
 * The next rotation will remove the oldest file and create a new one:
 * - `vscode-confluent-1234.0.log` (current log file)
 * - (`vscode-confluent-1234.1.log` is deleted)
 * - `vscode-confluent-1234.2.log`
 * - `vscode-confluent-1234.3.log`
 * - `vscode-confluent-1234.4.log` (new log file)
 */
function rotatingFilenameGenerator(time: number | Date, index?: number): string {
  const maybefileIndex = index !== undefined ? `.${index}` : "";
  // use process.pid to keep the log file names unique across multiple extension instances
  const newFileName = `vscode-confluent-${process.pid}${maybefileIndex}.log`;
  ROTATED_LOGFILE_NAMES.push(newFileName);
  if (ROTATED_LOGFILE_NAMES.length > MAX_LOGFILES) {
    // remove the oldest log file from the array
    // (RotatingFileStream will handle the actual file deletion)
    ROTATED_LOGFILE_NAMES.shift();
  }
  CURRENT_LOGFILE_NAME = newFileName;
  return newFileName;
}

/** Helper function to clean up older log files that weren't picked up by the rotating file stream. */
export function cleanupOldLogFiles() {
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(now.getDate() - 3);

  const logFiles: string[] = readdirSync(LOGFILE_DIR).filter((file) => {
    // any `vscode-confluent*.log` files, excluding the sidecar log file
    return (
      file.startsWith("vscode-confluent-") &&
      file.endsWith(".log") &&
      file !== "vscode-confluent-sidecar.log"
    );
  });
  if (!logFiles.length) {
    return;
  }

  // filter out any log files that were last modified before the cutoff date
  const oldLogFiles = logFiles.filter((file) => {
    const filePath = `${LOGFILE_DIR}/${file}`;
    const stats = statSync(filePath);
    return stats.mtime < cutoffDate;
  });

  // delete the old log files
  for (const file of oldLogFiles) {
    const filePath = `${LOGFILE_DIR}/${file}`;
    try {
      console.log(`Deleting old log file: ${filePath}`);
      unlinkSync(filePath);
    } catch (error) {
      console.error(`Error deleting old log file: ${filePath}`, error);
    }
  }
}
