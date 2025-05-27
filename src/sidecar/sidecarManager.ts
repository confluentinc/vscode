// sidecar manager module

import { ChildProcess } from "child_process";

import sidecarExecutablePath, { version as currentSidecarVersion } from "ide-sidecar";

import { Configuration, HandshakeResourceApi, SidecarVersionResponse } from "../clients/sidecar";
import { Logger } from "../logging";
import {
  MOMENTARY_PAUSE_MS,
  SIDECAR_BASE_URL,
  SIDECAR_PORT,
  SIDECAR_PROCESS_ID_HEADER,
} from "./constants";
import { ErrorResponseMiddleware } from "./middlewares";
import { SidecarHandle } from "./sidecarHandle";
import { WebsocketManager, WebsocketStateEvent } from "./websocketManager";

import { Tail } from "tail";
import { observabilityContext } from "../context/observability";
import { logError } from "../errors";
import { SecretStorageKeys } from "../storage/constants";
import { getSecretStorage } from "../storage/utils";
import { NoSidecarRunningError, SidecarFatalError, WrongAuthSecretError } from "./errors";
import {
  determineSidecarStartupFailureReason,
  gatherSidecarOutputs,
  getSidecarLogfilePath,
  startTailingSidecarLogs,
} from "./logging";
import { SidecarStartupFailureReason } from "./types";
import {
  checkSidecarFile,
  constructSidecarEnv,
  isProcessRunning,
  killSidecar,
  normalizedSidecarPath,
  pause,
  showSidecarStartupErrorMessage,
  spawn,
  wasConnRefused,
} from "./utils";

import { closeSync, openSync, writeFileSync } from "../utils/fsWrappers";

/** Header name for the workspace's PID in the request headers. */
const WORKSPACE_PROCESS_ID_HEADER: string = "x-workspace-process-id";

/** How many loop attempts to try in startSidecar() and doHand */
export const MAX_ATTEMPTS = 10;

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
   *
   * @throws SidecarFatalError If the sidecar process fails to start. Best guess as to why
   *         is in the `reason` attribute of the error.
   *
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

    try {
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
            return handle;
          }
        } catch (e) {
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
              throw new SidecarFatalError(
                SidecarStartupFailureReason.CANNOT_KILL_OLD_PROCESS,
                `Failed to kill old sidecar process ${e.sidecar_process_id}: ${e}`,
              );
            }

            await pause(MOMENTARY_PAUSE_MS);

            // Start new sidecar proces.
            accessToken = await this.startSidecar(callnum);
            logger.info(`${logPrefix}: Started new sidecar, got new access token.`);

            // Now jump back to the top, try healthcheck / authentication again.
            continue;
          } else {
            logger.error(`${logPrefix}: unhandled error`, e);
            throw e;
          }
        }
      } // end for loop.

      // If we get here, we've tried MAX_ATTEMPTS times and failed. Throw an error.
      throw new SidecarFatalError(
        SidecarStartupFailureReason.MAX_ATTEMPTS_EXCEEDED,
        `getHandlePromise(${callnum}): failed to start sidecar`,
      );
    } catch (e) {
      // This is the only place we show sidecar startup issues to the user.

      // Ensure the error was logged to the error logger and Sentry.
      if (e instanceof SidecarFatalError) {
        logError(e, "Sidecar startup SidecarFatalError", {
          extra: {
            reason: e.reason,
          },
        });
      } else {
        logError(e, "Sidecar startup error", {
          extra: {
            reason: "Unknown",
          },
        });
      }

      void showSidecarStartupErrorMessage(e);

      throw e;
    } finally {
      // If we get here, we need to clear the pending handle promise.
      this.pendingHandlePromise = null;
    }
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

        throw new SidecarFatalError(
          SidecarStartupFailureReason.CANNOT_GET_SIDECAR_PID,
          `Wrong sidecar version detected (${wantedMessage}), and could not self-correct. Please explicitly kill the ide-sidecar process.`,
        );
      }

      try {
        // Kill the sidecar process. May possible raise permission errors if, say, the sidecar is running as a different user.
        await killSidecar(sidecarPid);
      } catch (e) {
        throw new SidecarFatalError(
          SidecarStartupFailureReason.CANNOT_KILL_OLD_PROCESS,
          `Failed to kill sidecar process ${sidecarPid} due to bad version (${wantedMessage}): ${e}`,
        );
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
      } else if (response.status === 404) {
        // There's a HTTP server running, but it's not the sidecar.
        throw new SidecarFatalError(
          SidecarStartupFailureReason.NON_SIDECAR_HTTP_SERVER,
          `GET ${SIDECAR_BASE_URL}/gateway/v1/health/live returned 404`,
        );
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
            throw new SidecarFatalError(
              SidecarStartupFailureReason.HANDSHAKE_FAILED,
              `GET ${SIDECAR_BASE_URL}/gateway/v1/health/live returned 401, but claimed PID ${sidecar_pid_int} in the response headers!`,
            );
          }
        } else {
          throw new SidecarFatalError(
            SidecarStartupFailureReason.HANDSHAKE_FAILED,
            `Sidecar 401'd the handshake, but did not send its PID in the response headers!`,
          );
        }
      } else {
        throw new SidecarFatalError(
          SidecarStartupFailureReason.HANDSHAKE_FAILED,
          `GET ${SIDECAR_BASE_URL}/gateway/v1/health/live returned unexpected status ${response.status}`,
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

  /**
   *  Actually spawn the sidecar process, handshake with it, return its auth token string.
   *
   * Any errors encountered will be thrown as SidecarFatalError, which will be caught
   * at higher levels and logged to Sentry by that higher level.
   **/
  private async startSidecar(callnum: number): Promise<string> {
    observabilityContext.sidecarStartCount++;

    return new Promise<string>((resolve, reject) => {
      (async () => {
        const logPrefix = `startSidecar(${callnum})`;
        logger.info(`${logPrefix}: Starting new sidecar process`);

        this.sidecarContacted = false;

        let executablePath = normalizedSidecarPath(sidecarExecutablePath);

        try {
          // Will raise SidecarFatalError on any issue found.
          checkSidecarFile(executablePath);
        } catch (e) {
          reject(e);
          return;
        }

        // Start up the sidecar process, daemonized no stdio.
        // Set up the environment for the sidecar process.
        const sidecar_env = constructSidecarEnv(process.env);

        const stderrPath = `${getSidecarLogfilePath()}.stderr`;
        try {
          // try to create a file to track any stderr output from the sidecar process
          writeFileSync(stderrPath, "");
          const stderrFd = openSync(stderrPath, "w");

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
            let reason: SidecarStartupFailureReason;

            if (e instanceof Error && /UNKNOWN/.test(e.message)) {
              reason = SidecarStartupFailureReason.SPAWN_RESULT_UNKNOWN;
            } else {
              reason = SidecarStartupFailureReason.SPAWN_ERROR;
            }

            const err = new SidecarFatalError(
              reason,
              `${logPrefix}: Failed to spawn sidecar process: ${(e as Error).message}`,
            );

            reject(err);
            return;
          } finally {
            // close the file descriptor for stderr; child process will inherit it
            // and write to it
            closeSync(stderrFd);
          }

          const sidecarPid: number | undefined = sidecarProcess.pid;
          logger.info(
            `${logPrefix}: spawned sidecar process with pid ${sidecarPid}, logging to ${sidecar_env["QUARKUS_LOG_FILE_PATH"]}`,
          );
          sidecarProcess.unref();

          if (sidecarPid === undefined) {
            const err = new SidecarFatalError(
              SidecarStartupFailureReason.SPAWN_RESULT_UNDEFINED_PID,
              `${logPrefix}: sidecar process has undefined PID`,
            );
            reject(err);
            return;
          } else {
            // after a short delay, confirm that the sidecar process didn't immediately exit and/or
            // write any stderr to the file
            setTimeout(async () => {
              try {
                await this.confirmSidecarProcessIsRunning(sidecarPid, logPrefix, stderrPath);
              } catch (err) {
                // Reject the startSidecar promise.
                reject(err);
              }
            }, 2000);
          }
        } catch (e) {
          // Unexpected error. Wrap it in a SidecarFatalError and reject.
          const err = new SidecarFatalError(
            SidecarStartupFailureReason.UNKNOWN,
            `${logPrefix}: Unexpected error: ${e}`,
          );

          reject(err);
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
            await getSecretStorage().store(SecretStorageKeys.SIDECAR_AUTH_TOKEN, accessToken);

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
          new SidecarFatalError(
            SidecarStartupFailureReason.HANDSHAKE_FAILED,
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
  async doHandshake(): Promise<string> {
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
   * Get the auth token secret from the secret storage. Returns empty string if none found.
   **/
  async getAuthTokenFromSecretStore(): Promise<string> {
    const existing_secret: string | undefined = await getSecretStorage().get(
      SecretStorageKeys.SIDECAR_AUTH_TOKEN,
    );
    if (existing_secret) {
      return existing_secret;
    }
    return "";
  }

  /**
   * Check the sidecar process status to ensure it has started up, logging any stderr output and the
   * last few lines of the sidecar log file. Called a short time after the sidecar process is spawned.
   *
   * @throws SidecarFatalError if the sidecar process is not running, annotated with
   * our best guess as to why it failed to start (attribute `reason`). Will have already
   * made the call to logError() as needed.
   *
   * @param pid The sidecar process ID.
   * @param logPrefix A prefix for logging messages.
   * @param stderrPath The path to the sidecar's stderr file defined at process spawn time.
   */
  async confirmSidecarProcessIsRunning(
    pid: number,
    logPrefix: string,
    stderrPath: string,
  ): Promise<void> {
    const isRunning: boolean = isProcessRunning(pid);
    logger.info(`${logPrefix}: Sidecar process status check - running: ${isRunning}`);

    if (isRunning) {
      // All done here.
      return;
    }

    // For some reason the sidecar process died immediately after startup, so log the error and
    // report to Sentry so we can investigate.
    const outputs = await gatherSidecarOutputs(getSidecarLogfilePath(), stderrPath);

    let failureReason: SidecarStartupFailureReason = determineSidecarStartupFailureReason(outputs);

    const failureMsg = `${logPrefix}: Sidecar process ${pid} died immediately after startup`;

    const error = new SidecarFatalError(failureReason, failureMsg);

    // Send to sentry and error logger.
    logError(error, `sidecar process failed to start`, {
      extra: {
        stderr: outputs.stderrLines.join("\n"),
        logs: outputs.logLines.join("\n"),
        reason: failureReason,
      },
    });

    // Prettyprint the last few lines of the sidecar logs and/or stderr to our logs, 'cause user will probably
    // open our logs.
    if (outputs.parsedLogLines.length > 0) {
      logger.error(
        `${logPrefix}: Latest sidecar log lines:\n${outputs.parsedLogLines
          .slice(-5)
          .map((sidecarLogEvent) => {
            return `\t> ${sidecarLogEvent.timestamp} ${sidecarLogEvent.level} [${sidecarLogEvent.loggerName}] ${sidecarLogEvent.message}`;
          })
          .join("\n")}`,
      );
    }

    // Likewise for stderr. Will usually be either one or the other between this and the sidecar logs.
    if (outputs.stderrLines.length > 0) {
      logger.error(
        `${logPrefix}: Latest sidecar stderr lines:\n${outputs.stderrLines
          .slice(-5)
          .map((line) => `\t> ${line}`)
          .join("\n")}`,
      );
    }

    throw error;
  }

  dispose() {
    if (this.logTailer) {
      this.logTailer.unwatch();
      this.logTailer = undefined;
    }
    // Leave the sidecar running. It will garbage collect itself when all workspaces are closed.
  }
}
