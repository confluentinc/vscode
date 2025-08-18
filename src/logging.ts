import { readdirSync, statSync, unlinkSync } from "fs";
import { join, normalize } from "path";
import { createStream, RotatingFileStream } from "rotating-file-stream";
import { Event, LogLevel, LogOutputChannel, Uri, window } from "vscode";
import { SIDECAR_LOGFILE_NAME } from "./sidecar/constants";
import { WriteableTmpDir } from "./utils/file";

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
        this.writeToLogFile(prefix, message, ...args).catch(() => {
          // already logged, no need for additional handling. we still need this here so we don't
          // get unhandled promise rejections bubbling up.
        });
      }
    } catch {
      // ignore if the channel is disposed or the log file write fails
    }
  }

  /** Create a stream to write to the log file in "append" mode, write the log contents to it, and
   * then close the stream.
   */
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
 * Default directory to store downloadable log files for this extension instance.
 *
 * The main difference between this and the ExtensionContext.logUri (where LogOutputChannel lines
 * are written) is this will include ALL log levels, not just the ones enabled in the output channel.
 */
export function getLogFileDir(): string {
  return WriteableTmpDir.getInstance().get();
}

/** The base file name prefix for the log file. Helps with clean up of old log files. @see {@link cleanupOldLogFiles} */
export const BASEFILE_PREFIX: string = "vscode-confluent-";

/** The name of the currently active log file, including time/index prefixing. */
export const CURRENT_LOGFILE_NAME: string = `${BASEFILE_PREFIX}${process.pid}.log`;

/** Set of log file names that have already been created for this extension instance. */
export const ROTATED_LOGFILE_NAMES: string[] = [];

/** Max size of any log file written to disk.
 * @see https://github.com/iccicci/rotating-file-stream?tab=readme-ov-file#size */
export const MAX_LOGFILE_SIZE = "10M"; // 10MB max file size

/** Number of log files to keep.
 * @see https://github.com/iccicci/rotating-file-stream?tab=readme-ov-file#maxfiles */
export const MAX_LOGFILES = 3; // only keep 3 **rotated** log files at a time for this extension instance

/** How often log files should rotate if they don't exceed {@link MAX_LOGFILE_SIZE}.
 * @see https://github.com/iccicci/rotating-file-stream?tab=readme-ov-file#interval */
export const LOGFILE_ROTATION_INTERVAL = "1d"; // rotate log files daily

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
      path: getLogFileDir(),
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
 * - `vscode-confluent-1234.log` (current log file)
 * - `vscode-confluent-1234.1.log` (oldest log file)
 * - `vscode-confluent-1234.2.log`
 * - `vscode-confluent-1234.3.log` (new log file)
 *
 * The next rotation will remove the oldest file and create a new one:
 * - `vscode-confluent-1234.log` (current log file)
 * - (`vscode-confluent-1234.1.log` is deleted)
 * - `vscode-confluent-1234.2.log`
 * - `vscode-confluent-1234.3.log`
 * - `vscode-confluent-1234.4.log` (new log file)
 */
export function rotatingFilenameGenerator(time: number | Date, index?: number): string {
  // 0, undefined, null will drop any index suffix
  const maybefileIndex = index ? `.${index}` : "";
  // use process.pid to keep the log file names unique across multiple extension instances
  const newFileName = `vscode-confluent-${process.pid}${maybefileIndex}.log`;

  // this function will be called multiple times by RotatingFileStream as it handles rotations, so
  // we need to guard against adding the same file name multiple times
  // (we could use a Set, but we would end up calling Array.from() on it over and over)
  if (newFileName !== CURRENT_LOGFILE_NAME && !ROTATED_LOGFILE_NAMES.includes(newFileName)) {
    ROTATED_LOGFILE_NAMES.push(newFileName);
  }

  if (ROTATED_LOGFILE_NAMES.length > MAX_LOGFILES) {
    // remove the oldest log file from the array
    // (RotatingFileStream will handle the actual file deletion)
    ROTATED_LOGFILE_NAMES.shift();
  }

  return newFileName;
}

/** Helper function to clean up older log files that weren't picked up by the rotating file stream. */
export function cleanupOldLogFiles() {
  const logger = new Logger("logging.cleanup");
  const logfileDir = getLogFileDir();
  const now = new Date();
  const cutoffDate = new Date(now);
  cutoffDate.setDate(now.getDate() - 3);

  const logFiles: string[] = readdirSync(logfileDir).filter((file) => {
    // any `vscode-confluent*.log` files, excluding the sidecar log file
    return (
      file.startsWith("vscode-confluent-") && file.endsWith(".log") && file !== SIDECAR_LOGFILE_NAME
    );
  });
  logger.debug(
    `found ${logFiles.length} extension log file(s) in "${logfileDir}":`,
    logFiles.slice(0, 5),
  );
  if (!logFiles.length) {
    return;
  }

  // filter out any log files that were last modified before the cutoff date
  const oldLogFiles = logFiles.filter((file) => {
    const filePath = `${logfileDir}/${file}`;
    const stats = statSync(filePath);
    return stats.mtime < cutoffDate;
  });
  logger.debug(
    `extension log files modified before ${cutoffDate.toISOString()} to delete:`,
    oldLogFiles,
  );

  // delete the old log files
  for (const file of oldLogFiles) {
    const filePath = `${logfileDir}/${file}`;
    try {
      logger.debug(`Deleting old log file: ${filePath}`);
      unlinkSync(filePath);
    } catch (error) {
      logger.error(`Error deleting old log file: ${filePath}`, error);
    }
  }
}

/**
 * Manages the creation and rotation of log files.
 * @remarks Taken from {@link getLogFileStream}
 *
 * @param base - The base filepath name of the log file.
 */
export class RotatingLogManager {
  private stream: RotatingFileStream | undefined;
  private readonly _baseFileName: string;
  private readonly _currentFileName: string;
  private readonly _rotatedFileNames: string[] = [];

  constructor(private readonly base: string) {
    this._baseFileName = `${BASEFILE_PREFIX}${this.base}`;
    this._currentFileName = `${this._baseFileName}.log`;
  }

  /** Generates a new log file name based on the base file name and the index. @remarks Taken from {@link rotatingFilenameGenerator} */
  rotatingFilenameGenerator(time: number | Date, index?: number): string {
    // 0, undefined, null will drop any index suffix
    const maybefileIndex = index ? `.${index}` : "";
    // use process.pid (from base) to keep the log file names unique across multiple extension instances
    const newFileName = `${this._baseFileName}${maybefileIndex}.log`;

    // this function will be called multiple times by RotatingFileStream as it handles rotations, so
    // we need to guard against adding the same file name multiple times
    // (we could use a Set, but we would end up calling Array.from() on it over and over)
    if (newFileName !== this._currentFileName && !this._rotatedFileNames.includes(newFileName)) {
      this._rotatedFileNames.push(newFileName);
    }

    if (this._rotatedFileNames.length > MAX_LOGFILES) {
      // remove the oldest log file from the array
      // (RotatingFileStream will handle the actual file deletion)
      this._rotatedFileNames.shift();
    }

    return newFileName;
  }

  /** Gets the stream for the log file. @remark Taken from {@link getLogFileStream} */
  getStream(): RotatingFileStream {
    if (!this.stream) {
      // Arrow function automatically captures 'this' context when getStream() function is recalled
      const filenameGenerator = (time: number | Date, index?: number) =>
        this.rotatingFilenameGenerator(time, index);

      this.stream = createStream(filenameGenerator, {
        size: MAX_LOGFILE_SIZE,
        maxFiles: MAX_LOGFILES,
        interval: LOGFILE_ROTATION_INTERVAL,
        path: this.getDir(),
        history: `${this._baseFileName}.history.log`,
        encoding: "utf-8",
      });
    }
    return this.stream;
  }

  /** Gets the file URIs for the log file. @remarks Taken from {@link file://vscode/src/commands/support.ts extensionLogFileUris} */
  getFileUris(): Uri[] {
    const dir = this.getDir();
    const current = Uri.file(normalize(join(dir, this._currentFileName)));
    const rotated = this._rotatedFileNames.map((n) => Uri.file(normalize(join(dir, n))));
    const all = [current, ...rotated];
    return all.filter((u, i, arr) => arr.findIndex((x) => x.fsPath === u.fsPath) === i);
  }

  private getDir(): string {
    return WriteableTmpDir.getInstance().get();
  }

  // close the stream if it exists - for clean up
  dispose(): void {
    if (this.stream && !this.stream.closed) {
      this.stream.end();
    }
    this.stream = undefined;
  }
}

/** Wrapper class for the {@link LogOutputChannel} that also writes to a rotating log file.
 * @remarks Methods defined factored out from {@link Logger} to avoid code duplication.
 */
export class RotatingLogOutputChannel implements LogOutputChannel {
  private readonly rotatingLogManager: RotatingLogManager;
  private readonly outputChannel: LogOutputChannel;

  /** Creates a new {@link RotatingLogOutputChannel} instance.
   * @param displayChannelName - The name of the output channel to display in the UI.
   * @param logFileBaseName - The base name of the log file.
   * @param consoleLabelName (optional) - The name of the console label to display in the UI.
   */
  constructor(
    private readonly displayChannelName: string,
    private readonly logFileBaseName: string,
    private readonly consoleLabelName?: string,
  ) {
    this.outputChannel = window.createOutputChannel(this.displayChannelName, { log: true });
    this.rotatingLogManager = new RotatingLogManager(this.logFileBaseName);
  }

  get name(): string {
    return this.outputChannel.name;
  }

  get logLevel(): LogLevel {
    return this.outputChannel.logLevel;
  }

  get onDidChangeLogLevel(): Event<LogLevel> {
    return this.outputChannel.onDidChangeLogLevel;
  }

  /** Write a message to both output channel and log file
   * @remarks Taken from {@link Logger.logToOutputChannelAndFile} */
  private logToOutputChannelAndFile(
    level: string,
    prefix: string,
    message: string,
    ...args: any[]
  ): void {
    try {
      // Write to VS Code output channel
      switch (level) {
        case "trace":
          this.outputChannel.trace(message, ...args);
          break;
        case "debug":
          this.outputChannel.debug(message, ...args);
          break;
        case "info":
          this.outputChannel.info(message, ...args);
          break;
        case "warn":
          this.outputChannel.warn(message, ...args);
          break;
        case "error":
          this.outputChannel.error(message, ...args);
          break;
      }
      // don't write trace logs to the log file
      if (level !== "trace") {
        this.writeToLogFile(prefix, message, ...args).catch(() => {
          // already logged, no need for additional handling. we still need this here so we don't
          // get unhandled promise rejections bubbling up.
        });
      }
    } catch {
      // ignore if the channel is disposed or the log file write fails
    }
  }

  /** Create a stream to write to the log file in "append" mode, write the log contents to it, and
   * then close the stream.
   * @remarks Taken from {@link Logger.writeToLogFile} */
  private writeToLogFile(prefix: string, message: string, ...args: any[]) {
    const argString = args.map((arg) => JSON.stringify(arg)).join(" ");
    const formattedMessage = `${prefix} ${message} ${argString}\n`;

    return new Promise<void>((resolve, reject) => {
      try {
        const stream: RotatingFileStream = this.rotatingLogManager.getStream();
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

  /** Generates a log prefix for the given log level. */
  private logPrefix(level: string): string {
    const timestamp = new Date().toISOString();
    return `${timestamp} [${level}] ${this.consoleLabelName ? `[${this.consoleLabelName}]` : ""}`;
  }

  // Output channel methods
  append(value: string): void {
    this.outputChannel.append(value);
    const prefix = this.logPrefix("append");
    this.writeToLogFile(prefix, value.trim()).catch(() => {});
  }

  appendLine(value: string): void {
    this.outputChannel.appendLine(value);
    const prefix = this.logPrefix("appendLine");
    this.writeToLogFile(prefix, value).catch(() => {});
  }

  replace(value: string): void {
    this.outputChannel.replace(value);
    const prefix = this.logPrefix("replace");
    this.writeToLogFile(prefix, value).catch(() => {});
  }

  clear(): void {
    this.outputChannel.clear();
  }

  hide(): void {
    this.outputChannel.hide();
  }

  show(viewColumn?: any, preserveFocus?: boolean): void {
    this.outputChannel.show(viewColumn, preserveFocus);
  }

  // Access to file URIs for support zip
  getFileUris(): Uri[] {
    return this.rotatingLogManager.getFileUris();
  }

  dispose(): void {
    this.rotatingLogManager.dispose();
    this.outputChannel.dispose();
  }
}
