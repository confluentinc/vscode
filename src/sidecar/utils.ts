import { Uri } from "vscode";
import { Logger } from "../logging";
import { readFile } from "../utils/fsWrappers";
import { getSidecarLogfilePath } from "./logging";
import { SidecarLogFormat, SidecarOutputs, SidecarStartupFailureReason } from "./types";

const logger = new Logger("sidecar/utils.ts");
/**
 * Pause for MOMENTARY_PAUSE_MS.
 */
export async function pause(delay: number): Promise<void> {
  // pause an iota
  await new Promise((timeout_resolve) => setTimeout(timeout_resolve, delay));
}

export function divineSidecarStartupFailureReason(
  platform: NodeJS.Platform,
  outputs: SidecarOutputs,
): SidecarStartupFailureReason {
  // Check for the presence of specific error messages in the logs
  if (
    outputs.parsedLogLines.some((log) => /seems to be in use by another process/.test(log.message))
  ) {
    return SidecarStartupFailureReason.PORT_IN_USE;
  }

  // If no specific error messages are found, return UNKNOWN
  return SidecarStartupFailureReason.UNKNOWN;
}

/**
 * Check if a process is running by sending a signal 0 to it. If the process is running, it will not
 * throw an error.
 * @see https://man7.org/linux/man-pages/man2/kill.2.html#:~:text=%2Dpid.-,If%20sig%20is%200,-%2C%20then%20no%20signal
 *
 * @param pid The process ID to check.
 * @returns True if the process is running, false otherwise.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // ignore EPERM and others until we need to care about more processes than the sidecar, which we
    // spawned originally
    return false;
  }
}

export async function gatherSidecarOutputs(stderrPath: string): Promise<SidecarOutputs> {
  const myLogger = logger.withCallpoint("gatherSidecarOutputs");
  // Try to read+parse sidecar logs to notice any startup errors (occupied port, missing
  // configs, etc.)
  const reformattedLogLines: string[] = [];
  const parsedLines: SidecarLogFormat[] = [];

  let rawLogs: string[] = [];
  try {
    rawLogs = (await readFile(Uri.file(getSidecarLogfilePath()))).trim().split("\n").slice(-20);
  } catch (e) {
    myLogger.error(`Failed to read sidecar log file: ${e}`);
  }

  for (const rawLogLine in rawLogs) {
    try {
      const parsed = JSON.parse(rawLogLine.trim()) as SidecarLogFormat;
      parsedLines.push(parsed);

      const formatted = `\t> ${parsed.timestamp} ${parsed.level} [${parsed.loggerName}] ${parsed.message}`;
      reformattedLogLines.push(formatted);
    } catch {
      // JSON parsing issue. Only append the raw line to logLines.
      reformattedLogLines.push(rawLogLine);
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
