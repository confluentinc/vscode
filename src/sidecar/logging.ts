import { accessSync, writeFileSync } from "fs";
import { join } from "path";
import { createStream, RotatingFileStream } from "rotating-file-stream";
import { Tail } from "tail";
import { commands, LogOutputChannel, Uri, window, workspace } from "vscode";
import {
  LOGFILE_ROTATION_INTERVAL,
  Logger,
  MAX_LOGFILE_SIZE,
  MAX_LOGFILES,
  OUTPUT_CHANNEL,
} from "../logging";
import { showErrorNotificationWithButtons } from "../notifications";
import { WriteableTmpDir } from "../utils/file";
import { readFile } from "../utils/fsWrappers";
import { SIDECAR_FORMATTED_LOGFILE_NAME, SIDECAR_LOGFILE_NAME } from "./constants";
import { SidecarLogFormat, SidecarOutputs, SidecarStartupFailureReason } from "./types";

const logger = new Logger("sidecar/logging.ts");

/** Output channel for viewing sidecar logs. */
export const SIDECAR_OUTPUT_CHANNEL: LogOutputChannel = window.createOutputChannel(
  "Confluent (Sidecar)",
  { log: true },
);

/** Construct the full pathname to the sidecar log file. */
export function getSidecarLogfilePath(): string {
  return join(WriteableTmpDir.getInstance().get(), SIDECAR_LOGFILE_NAME);
}

/** Construct the full pathname to the formatted sidecar log file. */
export function getSidecarFormattedLogfilePath(): string {
  return join(WriteableTmpDir.getInstance().get(), SIDECAR_FORMATTED_LOGFILE_NAME);
}

/** Try to parse a raw (JSON) sidecar log line into a {@link SidecarLogFormat}. */
export function parseSidecarLogLine(rawLogLine: string): SidecarLogFormat | null {
  try {
    const log = JSON.parse(rawLogLine.trim()) as SidecarLogFormat;
    // basic validation for required fields
    if (!(log.level && log.loggerName && log.message)) {
      return null;
    }
    return log;
  } catch {
    // JSON parsing failed
    return null;
  }
}

/**
 * Format a log object into more human-readable string.
 * @param log The {@link SidecarLogFormat} log object to format.
 * @param options Formatting options:
 * - `withTimestamp`: Whether to include the `timestamp` in the formatted string (default: `true`).
 * - `withLevel`: Whether to include the log `level` in the formatted string (default: `true`).
 * - `withMdc`: Whether to include the `mdc` (Mapped Diagnostic Context) data in the formatted string (default: `true`).
 */
export function formatSidecarLogLine(
  log: SidecarLogFormat,
  options?: {
    withTimestamp: boolean;
    withLevel: boolean;
    withMdc: boolean;
  },
): string {
  const withTimestamp: boolean = options?.withTimestamp ?? true;
  const withLevel: boolean = options?.withLevel ?? true;
  const withMdc: boolean = options?.withMdc ?? true;

  const timestamp = log.timestamp || new Date().toISOString();
  const level = log.level?.padEnd(5) || "INFO ";
  const loggerName = log.loggerName || "unknown";
  const message = log.message || "";

  let formattedLine = `[${loggerName}] ${message}`;
  if (withLevel) {
    formattedLine = `[${level}] ${formattedLine}`;
  }
  if (withTimestamp) {
    formattedLine = `${timestamp} ${formattedLine}`;
  }

  // add MDC data if present
  if (withMdc && log.mdc && Object.keys(log.mdc).length > 0) {
    const mdcString = JSON.stringify(log.mdc);
    formattedLine = `${formattedLine} ${mdcString}`;
  }

  // always add exception details if present
  if (
    log.exception !== undefined &&
    log.exception !== null &&
    (log.exception.exceptionType ||
      log.exception.message ||
      (Array.isArray(log.exception.frames) && log.exception.frames.length > 0))
  ) {
    const exceptionType = log.exception.exceptionType || "UnknownException";
    const exceptionMessage = log.exception.message || "";
    formattedLine += ` [Exception: ${exceptionType} - ${exceptionMessage}]`;
    for (const frame of log.exception.frames) {
      formattedLine += `\n    at ${frame.class}.${frame.method} (${frame.class}:${frame.line})`;
    }
  }
  return formattedLine;
}

let formattedSidecarLogStream: RotatingFileStream | undefined;
/** Get or create the rotating file stream for formatted sidecar logs. */
function getFormattedSidecarLogStream(): RotatingFileStream {
  if (!formattedSidecarLogStream) {
    const logDir = WriteableTmpDir.getInstance().get();
    formattedSidecarLogStream = createStream(SIDECAR_FORMATTED_LOGFILE_NAME, {
      size: MAX_LOGFILE_SIZE,
      maxFiles: MAX_LOGFILES,
      interval: LOGFILE_ROTATION_INTERVAL,
      path: logDir,
    });
  }
  return formattedSidecarLogStream;
}

let _logTailer: Tail | undefined;
/** Set up tailing the sidecar log file into the "Confluent (Sidecar)" output channel. **/
export function getSidecarLogTail(): Tail | undefined {
  if (_logTailer) {
    return _logTailer;
  }
  _logTailer = createLogTailer();
  return _logTailer;
}

/** Stop tailing the sidecar logs and clean up the tailer. */
export function disposeSidecarLogTail(): void {
  if (_logTailer) {
    try {
      _logTailer.unwatch();
    } catch (e) {
      logger.warn("Error unwatching log tailer during stop:", e);
    }
    _logTailer = undefined;
  }
}

function createLogTailer(): Tail | undefined {
  // Create sidecar's log file if it doesn't exist so that we can
  // start tailing it right away before the sidecar process may exist.

  const sidecarLogfilePath = getSidecarLogfilePath();
  try {
    accessSync(sidecarLogfilePath);
  } catch {
    writeFileSync(sidecarLogfilePath, "");
  }

  let logTailer: Tail;
  try {
    // https://github.com/lucagrulla/node-tail/blob/master/README.md#constructor-parameters
    logTailer = new Tail(sidecarLogfilePath, {
      useWatchFile: true,
      follow: true, // default is true, but explicitly set for clarity
      fromBeginning: false, // default is false, also explicitly set for clarity
    });
  } catch (e) {
    SIDECAR_OUTPUT_CHANNEL.appendLine(
      `Failed to tail sidecar log file "${sidecarLogfilePath}": ${e}`,
    );
    return;
  }

  SIDECAR_OUTPUT_CHANNEL.appendLine(
    `Tailing the extension's sidecar logs from "${sidecarLogfilePath}" ...`,
  );

  // Take note of the start of exception lines in the log file, show as toast (if user has allowed via config)
  // Define a regex pattern to find "ERROR", a parenthesized thread name, and capture everything after it

  const regex = /ERROR.*\(([^)]+)\)\s*(.*)$/; //NOSONAR: This regex is intentionally written for log parsing and is safe in this context.

  logTailer.on("line", (data: any) => {
    const line: string = data.toString();
    const errorMatch = line.match(regex);
    if (errorMatch) {
      const config = workspace.getConfiguration();
      const notifySidecarExceptions = config.get(
        "confluent.debugging.showSidecarExceptions",
        false,
      );
      if (notifySidecarExceptions) {
        showErrorNotificationWithButtons(`[Debugging] Sidecar error: ${errorMatch[2]}`, {
          "Open Sidecar Logs": () => commands.executeCommand("confluent.showSidecarOutputChannel"),
          "Open Settings": () =>
            commands.executeCommand(
              "workbench.action.openSettings",
              "@id:confluent.debugging.showSidecarExceptions",
            ),
        });
      }
    }

    appendSidecarLogToOutputChannel(line);
  });

  logTailer.on("error", (data: any) => {
    OUTPUT_CHANNEL.error(`Error tailing sidecar log: ${data.toString()}`);
  });

  return logTailer;
}

/**
 * Parse and append a sidecar log line to the {@link SIDECAR_OUTPUT_CHANNEL output channel} based on
 * its `level`. Also writes a formatted version to the formatted log file for easier download.
 */
export function appendSidecarLogToOutputChannel(line: string) {
  // DEBUGGING: uncomment to see raw log lines in the output channel
  // SIDECAR_OUTPUT_CHANNEL.trace(line);

  const log: SidecarLogFormat | null = parseSidecarLogLine(line);
  if (!log) {
    // failed to parse JSON, or missing required fields; pass the raw line to the output channel
    OUTPUT_CHANNEL.error(`Failed to parse sidecar log line: ${line}`);
    SIDECAR_OUTPUT_CHANNEL.appendLine(line);
    try {
      const formattedLogStream = getFormattedSidecarLogStream();
      formattedLogStream.write(`${line}\n`);
    } catch (e) {
      OUTPUT_CHANNEL.warn(`Failed to write raw line to formatted sidecar log: ${e}`);
    }
    return;
  }

  // minimal formatting since the log output channel already has a timestamp and we'll pass any
  // MDC data as args. (any exception details will be formatted into the log message string)
  let logMsg = formatSidecarLogLine(log, {
    withTimestamp: false,
    withLevel: false,
    withMdc: false,
  });
  const logArgs = [];
  if (log.mdc && Object.keys(log.mdc).length > 0) {
    logArgs.push(log.mdc);
  }

  try {
    const formattedLine = formatSidecarLogLine(log, {
      withTimestamp: true,
      withLevel: true,
      withMdc: true,
    });
    const formattedLogStream = getFormattedSidecarLogStream();
    formattedLogStream.write(`${formattedLine}\n`);
  } catch (e) {
    // don't let any potential log file write errors break the main logging functionality
    OUTPUT_CHANNEL.warn(`Failed to write formatted line to sidecar log: ${e}`);
  }

  switch (log.level) {
    case "DEBUG":
      SIDECAR_OUTPUT_CHANNEL.debug(logMsg, ...logArgs);
      break;
    case "INFO":
      SIDECAR_OUTPUT_CHANNEL.info(logMsg, ...logArgs);
      break;
    case "WARN":
      SIDECAR_OUTPUT_CHANNEL.warn(logMsg, ...logArgs);
      break;
    case "ERROR":
      SIDECAR_OUTPUT_CHANNEL.error(logMsg, ...logArgs);
      break;
    default:
      // still shows up as `info` in the output channel
      SIDECAR_OUTPUT_CHANNEL.appendLine(
        `[${log.level}] ${logMsg} ${logArgs.length > 0 ? JSON.stringify(logArgs) : ""}`.trim(),
      );
  }
}

/**
 * Gather the sidecar's log lines and stderr lines into a single object.
 * Parses the 20 most recent sidecar log lines into a structured format.
 *
 * @param sidecarLogfilePath The path to the sidecar log file.
 * @param stderrPath The path to the sidecar's stderr file.
 *
 * @returns SidecarOutputs structure containing the log lines, parsed log lines, and stderr lines.
 */
export async function gatherSidecarOutputs(
  sidecarLogfilePath: string,
  stderrPath: string,
): Promise<SidecarOutputs> {
  const myLogger = logger.withCallpoint("gatherSidecarOutputs");
  // Try to read+parse most recent 20 sidecar logs to notice any startup errors (occupied port, missing
  // configs, etc.)
  const reformattedLogLines: string[] = [];
  const parsedLines: SidecarLogFormat[] = [];

  let rawLogs: string[] = [];
  try {
    rawLogs = (await readFile(Uri.file(sidecarLogfilePath))).trim().split("\n").slice(-20);
  } catch (e) {
    myLogger.error(`Failed to read sidecar log file: ${e}`);
  }

  for (const rawLogLine of rawLogs) {
    const parsed: SidecarLogFormat | null = parseSidecarLogLine(rawLogLine);
    if (parsed && parsed.timestamp) {
      parsedLines.push(parsed);

      const formatted = `\t> ${parsed.timestamp} ${parsed.level} [${parsed.loggerName}] ${parsed.message}`;
      reformattedLogLines.push(formatted);
    } else {
      // JSON parsing failed or the line is missing required fields. Only append the raw line if nonempty.
      if (rawLogLine.trim() !== "") {
        reformattedLogLines.push(rawLogLine);
      }
    }
  }

  let stderrLines: string[] = [];
  try {
    let stderrContent = await readFile(Uri.file(stderrPath));
    stderrContent = stderrContent.trim();
    stderrLines = stderrContent.split("\n");
    if (stderrLines.length === 1 && stderrLines[0] === "") {
      // File was essentialy empty. Coerce to empty array.
      stderrLines = [];
    }
  } catch (e) {
    myLogger.error(`Failed to read sidecar stderr file: ${e}`);
  }

  return {
    logLines: reformattedLogLines,
    parsedLogLines: parsedLines,
    stderrLines: stderrLines,
  };
}

/** Try to guess as to reason why Sidecar died very quickly after starting up through heuristics against logged lines or stderr. */
export function determineSidecarStartupFailureReason(
  outputs: SidecarOutputs,
): SidecarStartupFailureReason {
  // Check for the presence of specific error messages in the logs
  if (
    outputs.parsedLogLines.some((log) => /seems to be in use by another process/.test(log.message))
  ) {
    return SidecarStartupFailureReason.PORT_IN_USE;
  }

  if (outputs.stderrLines.some((line) => /GLIBC.*not found/.test(line))) {
    return SidecarStartupFailureReason.LINUX_GLIBC_NOT_FOUND;
  }

  // If no specific error messages are found, return UNKNOWN
  return SidecarStartupFailureReason.UNKNOWN;
}

/** Clean up the formatted sidecar log stream, called from extension.ts `deactivate()`. */
export function closeFormattedSidecarLogStream(): void {
  if (formattedSidecarLogStream) {
    try {
      formattedSidecarLogStream.end();
      formattedSidecarLogStream = undefined;
    } catch (e) {
      OUTPUT_CHANNEL.warn(`Error closing formatted sidecar log stream: ${e}`);
    }
  }
}
