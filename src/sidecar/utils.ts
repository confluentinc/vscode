import fs from "fs";
import sidecarExecutablePath, { version as currentSidecarVersion } from "ide-sidecar";
import { normalize } from "path";
import { logError } from "../errors";
import { Logger } from "../logging";
import { showErrorNotificationWithButtons } from "../notifications";
import { checkSidecarOsAndArch } from "./checkArchitecture";
import { MOMENTARY_PAUSE_MS, SIDECAR_PORT } from "./constants";
import { SidecarFatalError } from "./errors";
import { SidecarStartupFailureReason } from "./types";

const logger = new Logger("sidecar/utils.ts");

/**
 * Time to wait after having delivered a SIGTERM to sidecar before
 * promoting to SIGKILL. The ratio of this to {@link MOMENTARY_PAUSE_MS}
 * is the number of times {@link killSidecar} will pause+poll loop waiting
 * for an old (by either version or access token) sidecar to die.
 **/
export const WAIT_FOR_SIDECAR_DEATH_MS = 4_000; // 4 seconds.

/**
 * Pause for MOMENTARY_PAUSE_MS.
 */
export async function pause(delay: number): Promise<void> {
  // pause an iota
  await new Promise((timeout_resolve) => setTimeout(timeout_resolve, delay));
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

/** Try / catch wrapper around process.kill(). Always returns. */
export function safeKill(process_id: number, signal: NodeJS.Signals | 0 = "SIGTERM") {
  try {
    process.kill(process_id, signal);
  } catch (e) {
    logger.error(`Failed to deliver signal ${signal} to process ${process_id}: ${e}`);
  }
}

/**
 * Kill the sidecar process by its PID. Will raise an exception if the PID does not seem like a concrete process id. See kill(2).
 *
 * After delivering the SIGTERM signal, we will wait in a loop for at
 * most WAIT_FOR_SIDECAR_DEATH_MS in MOMENTARY_PAUSE_MS increments in to wait for the process
 * dies. If it has not by the end, we upgrade to using SIGKILL, then repeat
 * the procedure.
 *
 * @param process_id The sidecar's process id.
 * @param signal The signal to send to the process. Default is SIGTERM.
 */
export async function killSidecar(process_id: number, signal: "SIGTERM" | "SIGKILL" = "SIGTERM") {
  if (process_id <= 1) {
    logger.warn("Refusing to kill process with PID <= 1");
    throw new Error(`Refusing to kill process with PID <= 1`);
  }

  safeKill(process_id, signal);
  logger.debug(`Delivered ${signal} to old sidecar process ${process_id}`);

  // Now loop for at most maxWaitMs, checking if the process is still running, pausing
  // between checks each time.
  let isRunning: boolean = isProcessRunning(process_id);
  let remainingWaitMs = WAIT_FOR_SIDECAR_DEATH_MS;
  while (isRunning && remainingWaitMs > 0) {
    logger.info(`Waiting for old sidecar process ${process_id} to die ...`);
    await pause(MOMENTARY_PAUSE_MS);
    remainingWaitMs -= MOMENTARY_PAUSE_MS;

    isRunning = isProcessRunning(process_id);
  }

  if (isRunning) {
    logger.warn(
      `Old sidecar process ${process_id} still running after ${WAIT_FOR_SIDECAR_DEATH_MS}ms.`,
    );
    if (signal === "SIGTERM") {
      logger.warn(`Upgrading to using SIGKILL ...`);
      await killSidecar(process_id, "SIGKILL");
    } else {
      logger.warn(`SIGKILL signal already sent, giving up.`);
      throw new SidecarFatalError(
        SidecarStartupFailureReason.CANNOT_KILL_OLD_PROCESS,
        "Failed to kill old sidecar process",
      );
    }
  } else {
    // Successful kill. fallthrough to return.
    logger.debug(
      `Old sidecar process ${process_id} has died, took ${WAIT_FOR_SIDECAR_DEATH_MS - remainingWaitMs}ms.`,
    );
  }
}

/** Introspect into an exception's cause stack to discern if was ultimately caused by ECONNREFUSED. */
export function wasConnRefused(e: any): boolean {
  // They don't make this easy, do they? Have to dig into a few layers of causes, then also
  // array of aggregated errors to find the root cause expressed as `code == 'ECONNREFUSED'`.

  if (e == null) {
    // null or undefined?
    return false;
  } else if (e.code) {
    return e.code === "ECONNREFUSED";
  } else if (e.cause) {
    return wasConnRefused(e.cause);
  } else if (e.errors) {
    // Fortunately when happens in real life, it's always within the first error in the array.
    return wasConnRefused(e.errors[0]);
  } else {
    // If we can't find it in the main eager branching above, then it wasn't ECONNREFUSED.
    return false;
  }
}

/** Return the full path to the sidecar executable. */
export function normalizedSidecarPath(path: string): string {
  // check platform and adjust the path, so we don't end up with paths like:
  // "C:/c:/Users/.../ide-sidecar-0.26.0-runner.exe"
  if (process.platform === "win32") {
    path = normalize(path.replace(/^[/\\]+/, ""));
  }

  return path;
}

/**
 * Check the sidecar file at the given path. Checks performed:
 *   1. File exists
 *   2. File is for the proper platform and architecture
 * @param path The path to the sidecar file.
 * @throws SidecarFatalError with corresponding reason if any of the checks fail.
 */
export function checkSidecarFile(executablePath: string) {
  // 1. Check if the file exists and is executable
  try {
    fs.accessSync(executablePath, fs.constants.X_OK);
  } catch (e) {
    logError(e, `Sidecar executable "${executablePath}" does not exist or is not executable`, {
      extra: {
        executablePath,
        originalExecutablePath: sidecarExecutablePath,
        currentSidecarVersion,
      },
    });
    throw new SidecarFatalError(
      SidecarStartupFailureReason.MISSING_EXECUTABLE,
      `Component ${executablePath} does not exist or is not executable`,
    );
  }

  // 2. Check for architecture/platform mismatch
  // (will itself throw SidecarFatalError if the check fails)
  checkSidecarOsAndArch(executablePath);
}

export async function showSidecarStartupErrorMessage(
  e: unknown,
  platform: NodeJS.Platform,
): Promise<void> {
  if (e instanceof SidecarFatalError) {
    logger.error(`showSidecarStartupErrorMessage(): ${e.message} (${e.reason})`);
    switch (e.reason) {
      case SidecarStartupFailureReason.PORT_IN_USE:
        switch (platform) {
          case "win32":
            void showErrorNotificationWithButtons(
              `(Windows) Sidecar port ${SIDECAR_PORT} is in use by another process. Please kill that process and try again.`,
            );
            break;
          default:
            void showErrorNotificationWithButtons(
              `(UNIX) Sidecar port ${SIDECAR_PORT} is in use by another process. Please kill that process and try again.`,
            );
            break;
        }
        break;

      default:
        void showErrorNotificationWithButtons(
          `Sidecar failed to start: ${e.message}. Please check the logs for more details.`,
        );
        break;
    }
  } else {
    void showErrorNotificationWithButtons(
      `Sidecar failed to start: ${e}. Please check the logs for more details.`,
    );
  }
}
