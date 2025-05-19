// sidecar manager module

import { ChildProcess, spawn } from "child_process";
import fs from "fs";

import sidecarExecutablePath, { version as currentSidecarVersion } from "ide-sidecar";
import * as vscode from "vscode";

import { Configuration, HandshakeResourceApi, SidecarVersionResponse } from "../clients/sidecar";
import { Logger } from "../logging";
import { getStorageManager } from "../storage";
import { SIDECAR_BASE_URL, SIDECAR_PORT, SIDECAR_PROCESS_ID_HEADER } from "./constants";
import { ErrorResponseMiddleware } from "./middlewares";
import { SidecarHandle } from "./sidecarHandle";
import { WebsocketManager, WebsocketStateEvent } from "./websocketManager";

import { normalize } from "path";
import { Tail } from "tail";
import { EXTENSION_VERSION } from "../constants";
import { observabilityContext } from "../context/observability";
import { logError } from "../errors";
import { showErrorNotificationWithButtons } from "../notifications";
import { SecretStorageKeys } from "../storage/constants";
import { checkSidecarOsAndArch } from "./checkArchitecture";
import {
  NoSidecarExecutableError,
  NoSidecarRunningError,
  SidecarFatalError,
  WrongAuthSecretError,
} from "./errors";
import { getSidecarLogfilePath, startTailingSidecarLogs } from "./logging";
import { SidecarLogFormat } from "./types";
import { pause } from "./utils";

/** Header name for the workspace's PID in the request headers. */
const WORKSPACE_PROCESS_ID_HEADER: string = "x-workspace-process-id";

export const MOMENTARY_PAUSE_MS = 500; // half a second.
/**
 * Time to wait after having delivered a SIGTERM to sidecar before
 * promoting to SIGKILL. The ratio of this to {@link MOMENTARY_PAUSE_MS}
 * is the number of times {@link killSidecar} will pause+poll loop waiting
 * for an old (by either version or access token) sidecar to die.
 **/
export const WAIT_FOR_SIDECAR_DEATH_MS = 4_000; // 4 seconds.

/** How many loop attempts to try in startSidecar() and doHand */
const MAX_ATTEMPTS = 10;

const logger = new Logger("sidecarManager");

/**
 * Internal singleton class managing starting / restarting sidecar process and handing back a reference to an API client (SidecarHandle)
 * which should be used for a single action and then discarded. Not retained for multiple actions, otherwise
 * we won't be in position to restart / rehandshake with the sidecar if needed.
 */
export class SidecarManager {
  // Counters for logging purposes.
  private getHandleCallNumSource: number = 0;
  private handleIdSource: number = 0;

  // We want at most one sidecar process attempted to be started up at a time.
  private pendingHandlePromise: Promise<SidecarHandle> | null = null;

  private myPid: string = process.pid.toString();

  // tail -F actor for the sidecar log file.
  private logTailer: Tail | undefined = undefined;

  private sidecarContacted: boolean = false;
  private websocketManager: WebsocketManager | null = null;

  /** Construct or return reference to already running sidecar process.
   * Code should _not_ retain the return result here for more than a single direct action, in that
   * the sidecar process may need to be restarted at any time.
   **/
  public getHandle(): Promise<SidecarHandle> {
    const callnum = this.getHandleCallNumSource++;

    // 0. If we're in the process of starting up the sidecar, defer to it
    if (this.pendingHandlePromise) {
      return this.pendingHandlePromise;
    } else {
      // Make a new promise, retain it, return it.
      this.pendingHandlePromise = this.getHandlePromise(callnum);
      return this.pendingHandlePromise;
    }
  }

  /**
   * Inner function to actually gain reference to a happy running sidecar.
   * @param callnum What call number this is, for logging purposes.
   * @returns Promise<SidecarHandle> A promise that will resolve with a SidecarHandle object
   *          for actual sidecar interaction.
   */
  private async getHandlePromise(callnum: number): Promise<SidecarHandle> {
    // Try to make a request to the sidecar to see if it's running.
    // If it's not, start it.
    // If it replies with a 401, then we need to restart it because we're out of sync with the access token.

    // Try to make hit to the healthcheck endpoint. One of three things will happen, in order of likelyhood):
    // 1. The sidecar is running and healthy, in which case we're done.
    // 2. The sidecar is not running, in which case we need to start it.
    // 3. The sidecar is running but rejects our access token, in which case we need to restart it.
    //   (the 401 should include the sidecar's PID in the response headers, so we can kill it by PID)
    //
    // (When starting the extension from scratch, we'll go through path two and then later on path one. Path three only needed
    //  if something goes wrong with managing the access token or someone )

    // TODO: We don't need to get the access token from secret store every time?
    let accessToken: string | undefined = await this.getAuthTokenFromSecretStore();

    if (this.logTailer == null) {
      this.logTailer = startTailingSidecarLogs();
    }

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const logPrefix = `getHandlePromise(${callnum} attempt ${i})`;

      try {
        if (this.websocketManager?.isConnected() || (await this.healthcheck(accessToken))) {
          // 1. The sidecar is running and healthy, in which case we're probably done.
          // (this is the only path that may resolve this promise successfully)
          const handle = new SidecarHandle(accessToken, this.myPid, this.handleIdSource++);

          if (!this.sidecarContacted) {
            // Do the one-time-only things re/this sidecar process, whether or not
            // we had to start it up or was already running.
            await this.firstSidecarContactActions(handle);
          }

          // websocket connection may need connecting or reconnecting
          // independent of first sidecar contact.
          if (!this.websocketManager?.isConnected()) {
            await this.setupWebsocketManager(accessToken);
          }

          // This client is good to go. Resolve the promise with it.
          this.pendingHandlePromise = null;

          return handle;
        }
      } catch (e) {
        try {
          if (e instanceof NoSidecarRunningError) {
            // 2. The sidecar is not running (we got ECONNREFUSED), in which case we need to start it.
            logger.info(`${logPrefix}: No sidecar running, starting sidecar`);
            accessToken = await this.startSidecar(callnum);

            // Now jump back to the top of loop, try healthcheck / authentication again.
            continue;
          } else if (e instanceof WrongAuthSecretError) {
            // 3. The sidecar is running but rejects our access token, in which case we need to kill + start it.
            logger.info(`${logPrefix}:  Wrong access token, restarting sidecar`);
            // Kill the process, pause an iota, restart it, then try again.
            try {
              await killSidecar(e.sidecar_process_id);
            } catch (e: any) {
              logger.error(
                `${logPrefix}: failed to kill sidecar process ${e.sidecar_process_id}: ${e}`,
              );
              throw e;
            }

            await pause(MOMENTARY_PAUSE_MS);

            // Start new sidecar proces.
            accessToken = await this.startSidecar(callnum);
            logger.info(`${logPrefix}: Started new sidecar, got new access token.`);

            // Now jump back to the top, try healthcheck / authentication again.
            continue;
          } else {
            logger.error(`${logPrefix}: unhandled error`, e);
            this.pendingHandlePromise = null;
            throw e;
          }
        } catch (e) {
          // as thrown by startSidecar()
          if (e instanceof NoSidecarExecutableError) {
            logger.error(`${logPrefix}: sidecar executable not found`, e);
          } else if (e instanceof SidecarFatalError) {
            logger.error(`${logPrefix}: sidecar process failed to start`, e);
          }
          this.pendingHandlePromise = null;
          throw e;
        }
      } // end catch.
    } // end for loop.
    // If we get here, we've tried MAX_ATTEMPTS times and failed. Throw an error.
    this.pendingHandlePromise = null;
    throw new Error(`getHandlePromise(${callnum}): failed to start sidecar`);
  }

  /**
   * Perform actions that should only be done once per workspace + sidecar process:
   *  - When we know we just started up new sidecar,
   *  - or when this workspace is doing first contact with an already-running sidecar.
   **/
  private async firstSidecarContactActions(handle: SidecarHandle): Promise<void> {
    // Check the sidecar version, if it's not the same as the extension, show a warning.
    // This is a non-fatal issue, but we want the user to know and have the option to restart the sidecar.
    // If sidecar gets restarted, then we won't complete successfully, and a new sidecar will be started up
    // outside of this function.
    var version_result: SidecarVersionResponse | undefined = undefined;
    try {
      version_result = await handle.getVersionResourceApi().gatewayV1VersionGet();
      logger.info(`Sidecar version: ${version_result.version}`);
    } catch (e) {
      // Some devs may have sidecars running that don't have the version endpoint (Pinnipeds especially)
      logger.error(`Failed to get sidecar version: ${e}`);
      version_result = { version: "pre-history" };
    }

    if (version_result.version !== currentSidecarVersion) {
      const wantedMessage = `${version_result.version}, need ${currentSidecarVersion}`;

      logger.warn(
        `Trying to shut down existing sidecar process due to version mismatch (${wantedMessage})`,
      );

      let sidecarPid: number;
      try {
        // May raise exception if any issue with getting the PID from the sidecar.
        sidecarPid = await handle.getSidecarPid();
      } catch (e) {
        logger.error(
          `Failed to get sidecar PID when needing to kill sidecar due to bad version (${wantedMessage}): ${e}`,
          e,
        );
        vscode.window.showErrorMessage(
          `Wrong sidecar version detected (${wantedMessage}), and could not self-correct. Please explicitly kill the ide-sidecar process.`,
        );
        throw e;
      }

      try {
        // Kill the sidecar process. May possible raise permission errors if, say, the sidecar is running as a different user.
        await killSidecar(sidecarPid);
      } catch (e) {
        logger.error(
          `Failed to kill sidecar process ${sidecarPid} due to bad version (${wantedMessage}): ${e}`,
          e,
        );
        vscode.window.showErrorMessage(
          `Wrong sidecar version detected (${wantedMessage}), and could not self-correct. Please explicitly kill the ide-sidecar process.`,
        );
        throw e;
      }

      // Allow the old one a little bit of time to die off.
      await pause(MOMENTARY_PAUSE_MS);

      if (this.pendingHandlePromise != null) {
        // clear out the old promise and start fresh
        this.pendingHandlePromise = null;
      }
      // Ask to get a new handle, which will start a new sidecar process,
      // and will eventually end up calling firstSidecarContactActions() here again
      // (and hopefully not conflict about the sidecar version the next time).
      logger.info("Restarting sidecar after shutting down old version...");
      await this.getHandle();
    }
    this.sidecarContacted = true;
  }

  private async setupWebsocketManager(authToken: string): Promise<void> {
    if (!this.websocketManager) {
      this.websocketManager = WebsocketManager.getInstance();
      this.websocketManager.registerStateChangeHandler(this.onWebsocketStateChange.bind(this));
    }

    // Connects websocket to the sidecar.
    await this.websocketManager.connect(`localhost:${SIDECAR_PORT}`, authToken);
  }

  /** Called whenever websocket connection goes CONNECTED or DISCONNECTED. */
  private onWebsocketStateChange(event: WebsocketStateEvent) {
    if (event === WebsocketStateEvent.DISCONNECTED) {
      // Try to get a new sidecar handle, which will start a new sidecar process
      // and reconnect websocket.
      this.getHandle();
    }
  }

  /**
   * Make a healthcheck HTTP request to the sidecar. Returns true if the sidecar is healthy.
   * Will find out if the sidecar is healthy, or if it's not running, or if it's running but rejects our auth token.
   **/
  private async healthcheck(accessToken: string): Promise<boolean> {
    try {
      // This and handshake() are the most useful places to inject our PID as a header. No need
      // to do it in every toplevel request since we healthcheck() every time a sidecar handle is requested.
      const response = await fetch(`${SIDECAR_BASE_URL}/gateway/v1/health/live`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          [WORKSPACE_PROCESS_ID_HEADER]: this.myPid,
        },
      });
      if (response.status === 200) {
        return true;
      } else if (response.status === 401) {
        // Unauthorized. Will need to restart sidecar.
        // print out the response headers
        logger.error(
          `GET ${SIDECAR_BASE_URL}/gateway/v1/health/live returned 401 with headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`,
        );
        // Take note of the PID in the response headers.
        const sidecar_pid = response.headers.get(SIDECAR_PROCESS_ID_HEADER);
        if (sidecar_pid) {
          const sidecar_pid_int = parseInt(sidecar_pid);
          if (sidecar_pid_int > 0) {
            // Have enough trustworthy info to throw a specific error that will cause
            // us to kill the sidecar process and start a new one.
            throw new WrongAuthSecretError(
              `GET ${SIDECAR_BASE_URL}/gateway/v1/health/live returned 401.`,
              sidecar_pid_int,
            );
          } else {
            // sidecar quarkus dev mode may skip initialization and still return 401 and this header, but
            // with PID 0, which we will never want to try to kill -- kills whole process group!
            throw new Error(
              `GET ${SIDECAR_BASE_URL}/gateway/v1/health/live returned 401, but claimed PID ${sidecar_pid_int} in the response headers!`,
            );
          }
        } else {
          throw new Error(
            `GET ${SIDECAR_BASE_URL}/gateway/v1/health/live returned 401, but without a PID in the response headers!`,
          );
        }
      } else {
        throw new Error(
          `GET ${SIDECAR_BASE_URL}/gateway/v1/health/live returned unhandled status ${response.status}`,
        );
      }
    } catch (e) {
      if (e instanceof TypeError) {
        // ECONNREFUSED
        throw new NoSidecarRunningError(
          `GET ${SIDECAR_BASE_URL}/gateway/v1/health/live failed with ECONNREFUSED`,
        );
      } else {
        throw e;
      }
    }
  }

  sidecarArchitectureBlessed: boolean | null = null;
  /**
   *  Actually spawn the sidecar process, handshake with it, return its auth token string.
   **/
  private async startSidecar(callnum: number): Promise<string> {
    observabilityContext.sidecarStartCount++;
    return new Promise<string>((resolve, reject) => {
      (async () => {
        const logPrefix = `startSidecar(${callnum})`;
        logger.info(`${logPrefix}: Starting new sidecar process`);

        let executablePath = sidecarExecutablePath;
        // check platform and adjust the path, so we don't end up with paths like:
        // "C:/c:/Users/.../ide-sidecar-0.26.0-runner.exe"
        if (process.platform === "win32") {
          executablePath = normalize(executablePath.replace(/^[/\\]+/, ""));
        }
        this.sidecarContacted = false;

        if (this.sidecarArchitectureBlessed === null) {
          // check to see if the sidecar file exists
          logger.info(`exe path ${executablePath}, version ${currentSidecarVersion}`);
          try {
            fs.accessSync(executablePath);
          } catch (e) {
            logError(e, `Sidecar executable "${executablePath}" does not exist`, {
              extra: {
                originalExecutablePath: sidecarExecutablePath,
                currentSidecarVersion,
              },
            });
            reject(new NoSidecarExecutableError(`Component ${executablePath} does not exist`));
          }

          // Now check to see if is cooked for the right OS + architecture
          try {
            checkSidecarOsAndArch(executablePath);
            this.sidecarArchitectureBlessed = true;
          } catch (e) {
            this.sidecarArchitectureBlessed = false;
            logger.error(`${logPrefix}: component has wrong architecture`, e);
            reject(new SidecarFatalError((e as Error).message));
            return;
          }
        } else if (this.sidecarArchitectureBlessed === false) {
          // We already know the sidecar architecture is wrong, so don't bother trying to start it.
          reject(new SidecarFatalError(`${logPrefix}: component has wrong architecture`));
          return;
        }

        // Start up the sidecar process, daemonized no stdio.
        // Set up the environment for the sidecar process.
        const sidecar_env = constructSidecarEnv(process.env);

        const stderrPath = `${getSidecarLogfilePath()}.stderr`;
        try {
          // try to create a file to track any stderr output from the sidecar process
          fs.writeFileSync(stderrPath, "");
          const stderrFd = fs.openSync(stderrPath, "w");

          let sidecarProcess: ChildProcess;
          try {
            sidecarProcess = spawn(executablePath, [], {
              detached: true,
              // ignore stdin/stdout, stderr to the file
              stdio: ["ignore", "ignore", stderrFd],
              env: sidecar_env,
            });
          } catch (e) {
            // Failure to spawn the process. Reject and return (we're the main codepath here).
            logError(e, `${logPrefix}: sidecar component spawn error`, {
              extra: { functionName: "startSidecar" },
            });
            reject(e);
            return;
          } finally {
            // close the file descriptor for stderr; child process will inherit it
            // and write to it
            fs.closeSync(stderrFd);
          }

          const sidecarPid: number | undefined = sidecarProcess.pid;
          logger.info(
            `${logPrefix}: spawned sidecar process with pid ${sidecarPid}, logging to ${sidecar_env["QUARKUS_LOG_FILE_PATH"]}`,
          );
          sidecarProcess.unref();

          if (sidecarPid === undefined) {
            const err = new SidecarFatalError(
              `${logPrefix}: sidecar process returned undefined PID`,
            );
            logError(err, "sidecar process spawn", { extra: { functionName: "startSidecar" } });
            reject(err);
            return;
          } else {
            // after a short delay, confirm that the sidecar process didn't immediately exit and/or
            // write any stderr to the file
            setTimeout(() => {
              try {
                const isRunning: boolean = confirmSidecarProcessIsRunning(
                  sidecarPid!,
                  logPrefix,
                  stderrPath,
                );
                if (!isRunning) {
                  // reject the promise if the sidecar process is not running so we stop attempting
                  // to handshake with it
                  const err = new SidecarFatalError(`${logPrefix}: sidecar process is not running`);
                  logError(err, "sidecar process check", {
                    extra: { functionName: "startSidecar" },
                  });
                  reject(err);
                  // show a notification to the user to Open Logs or File Issue
                  showErrorNotificationWithButtons(
                    `Sidecar process ${sidecarPid} failed to start. Please check the logs for more details.`,
                  );
                  return;
                }
              } catch (e) {
                logError(e, "sidecar process check", { extra: { functionName: "startSidecar" } });
              }
            }, 2000);
          }

          // May think about a  sidecarProcess.on("exit", (code: number) => { ... }) here to catch early exits,
          // but the sidecar file architecture check above should catch most of those cases.
        } catch (e) {
          // Failure to spawn the process. Reject and return (we're the main codepath here).
          logError(e, `${logPrefix}: sidecar component spawn fatal error`, {
            extra: { functionName: "startSidecar" },
          });
          reject(e);
          return;
        }

        // The sidecar access token, as learned from the handshake endpoint.
        let accessToken = "";

        // Pause after spawning (so as to let the sidecar initialize and bind to its port),
        // then try to hit the handshake endpoint. It may fail a few times while
        // the sidecar process is coming online.
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
          try {
            await pause(MOMENTARY_PAUSE_MS);

            accessToken = await this.doHandshake();
            await getStorageManager().setSecret(SecretStorageKeys.SIDECAR_AUTH_TOKEN, accessToken);

            logger.info(
              `${logPrefix}(handshake attempt ${i}): Successful, got auth token, stored in secret store.`,
            );

            resolve(accessToken);
            return;
          } catch (e) {
            // We expect ECONNREFUSED while the sidecar is coming up, but log + rethrow other unexpected errors.
            if (!wasConnRefused(e)) {
              logError(e, `${logPrefix}: Attempt raised unexpected error`, {
                extra: { handshake_attempt: `${i}` },
              });
            }
            if (i < MAX_ATTEMPTS - 1) {
              logger.info(
                `${logPrefix}(handshake attempt ${i}): Got ECONNREFUSED. Pausing, retrying ...`,
              );
              // loops back to the top, pauses, tries again.
            }
          }
        } // the doHandshake() loop.

        // Didn't resolve and return within the loop, so reject.
        reject(
          new Error(
            `${logPrefix}: Failed to handshake with sidecar after ${MAX_ATTEMPTS} attempts`,
          ),
        );
      })();
    });
  }

  /**
   * Hit the handshake endpoint on the sidecar to get an auth token.
   * @returns The auth token string.
   */
  private async doHandshake(): Promise<string> {
    const config = new Configuration({
      basePath: `http://localhost:${SIDECAR_PORT}`,
      headers: { [WORKSPACE_PROCESS_ID_HEADER]: process.pid.toString() },
      middleware: [new ErrorResponseMiddleware()],
    });
    const api = new HandshakeResourceApi(config);
    const { auth_secret } = await api.gatewayV1HandshakeGet();
    if (auth_secret == null) throw new Error("Unable to receive auth token from sidecar");
    return auth_secret;
  }

  /**
   * Get the auth token secret from the storage manager. Returns empty string if none found.
   **/
  async getAuthTokenFromSecretStore(): Promise<string> {
    const existing_secret = await getStorageManager().getSecret(
      SecretStorageKeys.SIDECAR_AUTH_TOKEN,
    );
    if (existing_secret) {
      return existing_secret;
    }
    return "";
  }

  dispose() {
    if (this.logTailer) {
      this.logTailer.unwatch();
      this.logTailer = undefined;
    }

    // Leave the sidecar running. It will garbage collect itself when all workspaces are closed.
  }
}

// The following functions exported for testing purposes.
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
      throw new SidecarFatalError("Failed to kill old sidecar process");
    }
  } else {
    // Successful kill. fallthrough to return.
    logger.debug(
      `Old sidecar process ${process_id} has died, took ${WAIT_FOR_SIDECAR_DEATH_MS - remainingWaitMs}ms.`,
    );
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
 * Check if a process is running by sending a signal 0 to it. If the process is running, it will not
 * throw an error.
 * @see https://man7.org/linux/man-pages/man2/kill.2.html#:~:text=%2Dpid.-,If%20sig%20is%200,-%2C%20then%20no%20signal
 *
 * @param pid The process ID to check.
 * @returns True if the process is running, false otherwise.
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // ignore EPERM and others until we need to care about more processes than the sidecar, which we
    // spawned originally
    return false;
  }
}

/**
 * Check the sidecar process status to ensure it has started up, logging any stderr output and the
 * last few lines of the sidecar log file.
 *
 * @param pid The sidecar process ID.
 * @param logPrefix A prefix for logging messages.
 * @param stderrPath The path to the sidecar's stderr file defined at process spawn time.
 */
function confirmSidecarProcessIsRunning(
  pid: number,
  logPrefix: string,
  stderrPath: string,
): boolean {
  // check if the sidecar process is running for windows or unix
  const isRunning: boolean = isProcessRunning(pid);
  logger.info(`${logPrefix}: Sidecar process status check - running: ${isRunning}`);

  // check stderr file for any process start errors
  let stderrContent = "";
  try {
    stderrContent = fs.readFileSync(stderrPath, "utf8");
    if (stderrContent.trim()) {
      logger.error(`${logPrefix}: Sidecar stderr output: ${stderrContent}`);
    }
  } catch (e) {
    logger.error(`${logPrefix}: Failed to read sidecar stderr file: ${e}`);
  }

  // try to read+parse sidecar logs to watch for any startup errors (occupied port, missing
  // configs, etc.)
  const logLines: string[] = [];
  try {
    const logs = fs.readFileSync(getSidecarLogfilePath(), "utf8").trim().split("\n").slice(-20);
    logLines.push(
      ...logs.map((jsonStr) => {
        try {
          const line = JSON.parse(jsonStr.trim()) as SidecarLogFormat;
          return `\t> ${line.timestamp} ${line.level} [${line.loggerName}] ${line.message}`;
        } catch {
          return `\t> ${jsonStr}`;
        }
      }),
    );
    logger.info(`${logPrefix}: Latest sidecar log lines:\n${logLines.join("\n")}`);
  } catch (e) {
    logger.error(`${logPrefix}: Failed to read sidecar log file: ${e}`);
  }

  if (!isRunning) {
    // for some reason the sidecar process died immediately after startup, so log the error and
    // report to Sentry so we can investigate
    const failureMsg = `${logPrefix}: Sidecar process ${pid} died immediately after startup`;
    const error = new SidecarFatalError(failureMsg);
    logError(error, `sidecar process failed to start`, {
      extra: { stderr: stderrContent, logs: logLines.join("\n") },
    });
  }
  return isRunning;
}
