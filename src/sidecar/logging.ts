import { accessSync, writeFileSync } from "fs";
import { join } from "path";
import { Tail } from "tail";
import { commands, LogOutputChannel, window, workspace } from "vscode";
import { OUTPUT_CHANNEL } from "../logging";
import { showErrorNotificationWithButtons } from "../notifications";
import { WriteableTmpDir } from "../utils/file";
import { SIDECAR_LOGFILE_NAME } from "./constants";
import { SidecarLogFormat } from "./types";

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
