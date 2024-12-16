import { createWriteStream, WriteStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { LogOutputChannel, OutputChannel, window } from "vscode";

export const LOGFILE_PATH = join(tmpdir(), `vscode-confluent-${new Date().toISOString()}.log`);

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
  private writeStream: WriteStream | undefined;

  // TODO: register logger for cleanup on extension deactivation
  constructor(private name: string) {
    // append to the log file
    this.writeStream = createWriteStream(LOGFILE_PATH, { flags: "a" });
    this.writeStream.on("error", (err) => {
      console.error("Error writing to log file:", err);
    });
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
    const argString = args.map((arg) => JSON.stringify(arg)).join(" ");
    const formattedMessage = `${prefix} ${message} ${argString}\n`;
    const data = Buffer.from(formattedMessage);

    return new Promise<void>((resolve, reject) => {
      this.writeStream!.write(data, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  public dispose() {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = undefined;
    }
  }
}
