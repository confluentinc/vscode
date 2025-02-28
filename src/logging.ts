import { createWriteStream, existsSync, readdirSync, renameSync, statSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { LogOutputChannel, OutputChannel, window } from "vscode";

export const LOGFILE_NAME = `vscode-confluent-${process.pid}.log`;
const MAX_LOG_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB max file size
const MAX_LOG_FILES = 3; // only keep 3 log files at a time

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
          outputChannel.trace(fullMessage, ...args);
          break;
        case "debug":
          outputChannel.debug(fullMessage, ...args);
          break;
        case "info":
          outputChannel.info(fullMessage, ...args);
          break;
        case "warn":
          outputChannel.warn(fullMessage, ...args);
          break;
        case "error":
          outputChannel.error(fullMessage, ...args);
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
   * then close the stream. */
  private writeToLogFile(prefix: string, message: string, ...args: any[]) {
    const argString = args.map((arg) => JSON.stringify(arg)).join(" ");
    const formattedMessage = `${prefix} ${message} ${argString}\n`;

    return new Promise<void>((resolve, reject) => {
      try {
        this.rotateLogFileIfNeeded();

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
      } catch (error) {
        console.error("Unexpected error during log file operations:", error);
        resolve();
      }
    });
  }

  /** Check if the current log file exceeds size limit and rotate if needed */
  private rotateLogFileIfNeeded(): void {
    try {
      // no need to rotate if the file doesn't exist or it's under the size limit
      if (!existsSync(LOGFILE_PATH)) {
        return;
      }
      const stats = statSync(LOGFILE_PATH);
      if (stats.size < MAX_LOG_FILE_SIZE_BYTES) {
        return;
      }

      this.rotateLogFiles();
    } catch (error) {
      console.error("Error checking log file size:", error);
    }
  }

  /** Handle the log file rotation */
  private rotateLogFiles(): void {
    try {
      const logDir: string = tmpdir();
      const logFilePrefix: string = LOGFILE_NAME.split("-")[0]; // "vscode-confluent"
      const logFiles: string[] = readdirSync(logDir)
        .filter(
          (file) =>
            file.startsWith(logFilePrefix) && file.endsWith(".log") && file !== LOGFILE_NAME,
        )
        .map((file) => join(logDir, file))
        .sort(); // sort by name (including timestamp) to get oldest first

      // remove oldest log file(s) if we have more than the max number
      while (logFiles.length >= MAX_LOG_FILES) {
        const oldestFile = logFiles.shift();
        if (oldestFile) {
          unlinkSync(oldestFile);
        }
      }

      // create new log file with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const newLogPath = join(tmpdir(), `${logFilePrefix}-${timestamp}-${process.pid}.log`);

      // rename current file to archived name (or just delete if renaming fails)
      try {
        createWriteStream(newLogPath).close();
        renameSync(LOGFILE_PATH, newLogPath);
      } catch {
        // if rename fails, just delete the old file
        unlinkSync(LOGFILE_PATH);
      }
    } catch (error) {
      console.error("Error rotating log files:", error);
    }
  }
}
