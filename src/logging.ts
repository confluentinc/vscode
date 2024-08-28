import * as vscode from "vscode";

/**
 * Main "Confluent" output channel.
 * @remarks We're using a {@link vscode.LogOutputChannel} instead of a {@link vscode.OutputChannel}
 * because it includes timestamps and colored log levels in the output by default.
 */
export const outputChannel = vscode.window.createOutputChannel("Confluent", { log: true });

const callpointCounter = new Map<string, number>();

/**
 * Lightweight wrapper class using `console` log methods with timestamps, log levels, and original
 * logger name. Also appends messages and additional args to the "Confluent" output channel.
 */
export class Logger {
  // matches the default values from `env.logLevel`
  levels = ["off", "trace", "debug", "info", "warning", "error"];
  constructor(private name: string) {}

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
    outputChannel.trace(`[${this.name}] ${message}`, ...args);
  }

  debug(message: string, ...args: any[]) {
    const prefix = this.logPrefix("debug");
    console.debug(prefix, message, ...args);
    outputChannel.debug(`[${this.name}] ${message}`, ...args);
  }

  log(message: string, ...args: any[]) {
    return this.info(message, ...args);
  }

  info(message: string, ...args: any[]) {
    const prefix = this.logPrefix("info");
    console.info(prefix, message, ...args);
    outputChannel.info(`[${this.name}] ${message}`, ...args);
  }

  warn(message: string, ...args: any[]) {
    const prefix = this.logPrefix("warning");
    console.warn(prefix, message, ...args);
    outputChannel.warn(`[${this.name}] ${message}`, ...args);
  }

  error(message: string, ...args: any[]) {
    const prefix = this.logPrefix("error");
    console.error(prefix, message, ...args);
    outputChannel.error(`[${this.name}] ${message}`, ...args);
  }

  private logPrefix(level: string): string {
    const timestamp = new Date().toISOString();
    return `${timestamp} [${level}] [${this.name}]`;
  }
}
