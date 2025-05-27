import { accessSync, writeFileSync } from "fs";
import { join } from "path";
import { Tail } from "tail";
import { commands, LogOutputChannel, Uri, window, workspace } from "vscode";
import { Logger, OUTPUT_CHANNEL } from "../logging";
import { showErrorNotificationWithButtons } from "../notifications";
import { WriteableTmpDir } from "../utils/file";
import { readFile } from "../utils/fsWrappers";
import { SIDECAR_LOGFILE_NAME } from "./constants";
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

/** Set up tailing the sidecar log file into the "Confluent (Sidecar)" output channel. **/
export function startTailingSidecarLogs(): Tail | undefined {
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
    logTailer = new Tail(sidecarLogfilePath);
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
  const regex = /ERROR.*\(([^)]+)\)\s*(.*)$/;

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
 * its `level`.
 */
export function appendSidecarLogToOutputChannel(line: string) {
  // DEBUGGING: uncomment to see raw log lines in the output channel
  // SIDECAR_OUTPUT_CHANNEL.trace(line);

  let log: SidecarLogFormat;
  try {
    log = JSON.parse(line) as SidecarLogFormat;
  } catch (e) {
    if (e instanceof Error) {
      OUTPUT_CHANNEL.error(`Failed to parse sidecar log line: ${e.message}\n\t${line}`);
    }
    return;
  }
  if (!(log.level && log.loggerName && log.message)) {
    // log the raw object at `info` level:
    SIDECAR_OUTPUT_CHANNEL.appendLine(line);
    return;
  }

  let logMsg = `[${log.loggerName}] ${log.message}`;

  const logArgs = [];
  if (log.mdc && Object.keys(log.mdc).length > 0) {
    logArgs.push(log.mdc);
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
    try {
      const parsed = JSON.parse(rawLogLine.trim()) as SidecarLogFormat;
      if (!parsed || !parsed.timestamp || !parsed.level || !parsed.loggerName || !parsed.message) {
        throw new Error("Corrupted log line");
      }
      parsedLines.push(parsed);

      const formatted = `\t> ${parsed.timestamp} ${parsed.level} [${parsed.loggerName}] ${parsed.message}`;
      reformattedLogLines.push(formatted);
    } catch {
      // JSON parsing or post-JSON structure issue. Only append the raw line to logLines (if nonempty).
      if (rawLogLine !== "") {
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
