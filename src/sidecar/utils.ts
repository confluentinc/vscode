import * as childProcess from "child_process";
import fs from "fs";
import sidecarExecutablePath, { version as currentSidecarVersion } from "ide-sidecar";
import { normalize } from "path";
import * as vscode from "vscode";
import { env, Uri } from "vscode";
import { EXTENSION_VERSION } from "../constants";
import { logError } from "../errors";
import { Logger } from "../logging";
import { NotificationButtons, showErrorNotificationWithButtons } from "../notifications";
import { checkSidecarOsAndArch } from "./checkArchitecture";
import { MOMENTARY_PAUSE_MS, SIDECAR_PORT } from "./constants";
import { SidecarFatalError } from "./errors";
import { getSidecarLogfilePath } from "./logging";
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
 * Construct the environment for the sidecar process.
 * @param env The current environment, parameterized for test purposes.
 * @returns The environment object for the sidecar process.
 */
export function constructSidecarEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sidecar_env = Object.create(env);
  sidecar_env["QUARKUS_LOG_FILE_ENABLE"] = "true";
  sidecar_env["QUARKUS_LOG_FILE_ROTATION_ROTATE_ON_BOOT"] = "false";
  sidecar_env["QUARKUS_LOG_FILE_PATH"] = getSidecarLogfilePath();
  sidecar_env["VSCODE_VERSION"] = vscode.version;
  sidecar_env["VSCODE_EXTENSION_VERSION"] = EXTENSION_VERSION;

  // If we are running within WSL, then need to have sidecar bind to 0.0.0.0 instead of its default
  // localhost so that browsers running on Windows can connect to it during OAuth flow. The server
  // port will still be guarded by the firewall.
  // We also need to use the IPv6 loopback address for the OAuth redirect URI instead of the IPv4
  // (127.0.0.1) address, as the latter is not reachable from WSL2.
  if (env.WSL_DISTRO_NAME) {
    sidecar_env["QUARKUS_HTTP_HOST"] = "0.0.0.0";
    sidecar_env["IDE_SIDECAR_CONNECTIONS_CCLOUD_OAUTH_REDIRECT_URI"] =
      "http://[::1]:26636/gateway/v1/callback-vscode-docs";
  }

  return sidecar_env;
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

/**
 * If there's an error that kicks us out of starting up the sidecar, this
 * is the ONLY place to present that error to the user.
 *
 * It is most desired for these errors to come as a SidecarFatalError
 * carrying a SidecarStartupFailureReason.
 */
export async function showSidecarStartupErrorMessage(e: unknown): Promise<void> {
  if (e instanceof SidecarFatalError) {
    logger.error(`showSidecarStartupErrorMessage(): ${e.message} (${e.reason})`);
    const portBoilerplate = `Sidecar could not start, port ${SIDECAR_PORT} is in use by another process`;
    let buttons: NotificationButtons | undefined = undefined;
    let message: string;
    switch (e.reason) {
      case SidecarStartupFailureReason.PORT_IN_USE:
        message = `${portBoilerplate}. If you have multiple IDE types open with the extension installed (like VS Code and VS Code Insiders), please close all but one. Otherwise, check for other applications using this port.`;
        break;

      case SidecarStartupFailureReason.NON_SIDECAR_HTTP_SERVER:
        message = `${portBoilerplate}, which seems to be a web server but is not our sidecar. Please check for other applications using this port.`;
        break;

      case SidecarStartupFailureReason.LINUX_GLIBC_NOT_FOUND:
        message = `It appears your Linux installation is too old and does not have the required GLIBC version. We build on Ubuntu 22.04 and need at least GLIBC_2.32. Please upgrade your distribution to a more recent version.`;
        break;

      case SidecarStartupFailureReason.CANNOT_KILL_OLD_PROCESS:
        message = `Sidecar failed to start: Failed to kill old sidecar process.`;
        break;

      case SidecarStartupFailureReason.SPAWN_RESULT_UNKNOWN:
        message = `Sidecar executable was not able to be spawned. This is likely due to a Windows anti-virus issue. Please check your anti-virus settings and try again.  "${sidecarExecutablePath}" needs to be approved to be executed for this extension to work.`;
        break;

      case SidecarStartupFailureReason.SPAWN_ERROR:
        message = `Sidecar executable was not able to be spawned.`;
        break;

      case SidecarStartupFailureReason.SPAWN_RESULT_UNDEFINED_PID:
        message = `Sidecar executable was not able to be spawned -- resulting PID was undefined.`;
        break;

      case SidecarStartupFailureReason.HANDSHAKE_FAILED:
        message = `Sidecar failed to start: Handshake failed.`;
        break;

      case SidecarStartupFailureReason.MAX_ATTEMPTS_EXCEEDED:
        message = `Sidecar failed to start: Handshake failed after repeated attempts.`;
        break;

      case SidecarStartupFailureReason.MISSING_EXECUTABLE:
      case SidecarStartupFailureReason.WRONG_ARCHITECTURE:
      case SidecarStartupFailureReason.CANNOT_GET_SIDECAR_PID:
        // These use the error message embedded in the exception,
        // in that the raising point.
        message = e.message;

        // But we can add a button to open the marketplace in case of WRONG_ARCHITECTURE.
        // (User direct installed from, say github, but grabbed the wrong vsix)
        if (e.reason === SidecarStartupFailureReason.WRONG_ARCHITECTURE) {
          buttons = {
            "Open Marketplace": () => {
              env.openExternal(Uri.parse("vscode:extension/confluentinc.vscode-confluent"));
            },
          };
        }
        break;

      default:
        message = `Sidecar failed to start: ${e.message}`;
        break;
    }

    void showErrorNotificationWithButtons(message, buttons);
  } else {
    // Was some truly unexpected exception!
    void showErrorNotificationWithButtons(`Sidecar failed to start: ${e}`);
  }
}

/** Stubbable wrapper over child_process.spawn() */
export function spawn(
  command: string,
  args: readonly string[],
  options: childProcess.SpawnOptions,
): childProcess.ChildProcess {
  return childProcess.spawn(command, args, options);
}
