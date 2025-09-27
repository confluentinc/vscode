import { writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import * as vscode from "vscode";
import { CCloudStatus, ConnectedState, Connection, UserInfo } from "../clients/sidecar";
import { AUTH_PROVIDER_ID, CCLOUD_CONNECTION_ID } from "../constants";
import { getExtensionContext } from "../context/extension";
import { observabilityContext } from "../context/observability";
import { ContextValues, setContextValue } from "../context/values";
import { ccloudAuthCallback, ccloudAuthSessionInvalidated, ccloudConnected } from "../emitters";
import { ExtensionContextNotSetError, logError } from "../errors";
import { loadPreferencesFromWorkspaceConfig } from "../extensionSettings/sidecarSync";
import { getLaunchDarklyClient } from "../featureFlags/client";
import { Logger } from "../logging";
import { showInfoNotificationWithButtons } from "../notifications";
import {
  clearCurrentCCloudResources,
  createCCloudConnection,
  deleteCCloudConnection,
  getCCloudConnection,
} from "../sidecar/connections/ccloud";
import { waitForConnectionToBeStable } from "../sidecar/connections/watcher";
import { getLastSidecarLogLines } from "../sidecar/logging";
import { SecretStorageKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";
import { getSecretStorage } from "../storage/utils";
import { logUsage, UserEvent } from "../telemetry/events";
import { sendTelemetryIdentifyEvent } from "../telemetry/telemetry";
import { DisposableCollection } from "../utils/disposables";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "./constants";
import { CCloudSignInError } from "./errors";
import { AuthCallbackEvent } from "./types";

const logger = new Logger("authn.ccloudProvider");

/**
 * Authentication provider for Confluent Cloud, which handles syncing connection/auth states with the
 * sidecar.
 *
 * Main responsibilities:
 * - {@linkcode ConfluentCloudAuthProvider.createSession() createSession()}: Create a CCloud {@link Connection} with the sidecar if one doesn't
 *  already exist, then start the browser-based authentication flow. For connections that exist
 *  already, we reuse the `sign_in_uri` from the {@link Connection}'s `metadata`.
 * - {@linkcode ConfluentCloudAuthProvider.getSessions() getSessions()}: Whenever `vscode.authentication.getSession()` is called with our
 *  `AUTH_PROVIDER_ID`, this method will be called to get the current session. We don't use `scopes`
 *  at all here, since the sidecar manages all connection->access token and scope information.
 * - {@linkcode ConfluentCloudAuthProvider.removeSession() removeSession()}: Deletes the connection from the sidecar and update the provider's
 *  internal state. This is only called after a user chooses to "Sign out" from the Accounts menu
 *  and continues past the confirmation dialog that appears.
 *
 * There are also some event listeners configured to handle changes in the auth state between the
 * extension instance and the sidecar, as well as between different workspaces:
 * - one for monitoring changes in the SecretStore, which is used to notify the extension when the
 * user has completed the auth flow and resolve any promises
 * - one for handling the URI handling event, which is used to resolve any auth flow promises and
 * will trigger the `secrets.onDidChange` listener
 * - one for handling the `ccloudAuthSessionInvalidated` event, which is used to remove the session
 * from the provider's internal state
 *
 * In general, once a user successfully authenticates for the first time, we will continue to reuse
 * that connection until they sign out. This is to avoid inconsistencies in `sign_in_uri` usage, so
 * after the initial transition from `NONE` to `SUCCESS`, any time the user may need to
 * reauthenticate will be with the same connection (and thus the same `sign_in_uri`). (E.g. after
 * token expiration or any other errors with the existing session that the sidecar cannot recover
 * from.) These will be transitions between `SUCCESS` and `FAILED`/`ATTEMPTING` states. The
 * only way we get back to `NONE` is by deleting the connection entirely and recreating a new one
 * (with a new `sign_in_uri`), which should only be done by the user signing out.
 */
export class ConfluentCloudAuthProvider
  extends DisposableCollection
  implements vscode.AuthenticationProvider
{
  // tells VS Code which sessions have been added, removed, or changed for this extension instance
  // NOTE: does not trigger cross-workspace events
  private _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  get onDidChangeSessions() {
    return this._onDidChangeSessions.event;
  }

  /** Notify the extension when the user has completed the auth flow and resolve any promises */
  private _onAuthFlowCompletedSuccessfully = new vscode.EventEmitter<AuthCallbackEvent>();

  /** Used to check for changes in auth state between extension instance and sidecar. */
  private _session: vscode.AuthenticationSession | null = null;

  private static instance: ConfluentCloudAuthProvider | null = null;
  // private to enforce singleton pattern and avoid attempting to re-register the auth provider
  private constructor() {
    super();
    const context: vscode.ExtensionContext = getExtensionContext();
    if (!context) {
      // extension context required for keeping up with secrets changes
      throw new ExtensionContextNotSetError("ConfluentCloudAuthProvider");
    }

    const listeners: vscode.Disposable[] = this.setEventListeners(context);

    this.disposables.push(...listeners);
  }

  static getInstance(): ConfluentCloudAuthProvider {
    if (!ConfluentCloudAuthProvider.instance) {
      ConfluentCloudAuthProvider.instance = new ConfluentCloudAuthProvider();
    }
    return ConfluentCloudAuthProvider.instance;
  }

  /**
   * Create a CCloud connection with the sidecar if one doesn't already exist, then start the
   * browser-based authentication flow.
   * @remarks No access tokens or scopes are managed here since those are entirely managed by the
   * sidecar.
   */
  async createSession(): Promise<vscode.AuthenticationSession> {
    let connection: Connection;

    // we should only ever have to create a connection when a user is signing in for the first
    // time or if they explicitly signed out and the connection is deleted -- see `.removeSession()`
    const existingConnection: Connection | null = await getCCloudConnection();
    if (!existingConnection) {
      connection = await createCCloudConnection();
    } else {
      connection = existingConnection;
      logger.debug("using existing connection for sign-in flow", {
        state: connection.status.ccloud?.state,
      });
    }

    // NOTE: for any of the branches below, if there's an error scenario we need to gather more info
    // about for internal debugging/troubleshooting, we need to create a CCloudSignInError with
    // `handleSignInError()`. This also captures the last few lines of sidecar logs to send to
    // Sentry along with the error.
    // If we need to escape this flow without creating an AuthenticationSession, we still need to
    // throw an error but don't necessarily need to gather sidecar logs, so we can throw a
    // CCloudSignInError directly if we don't want it to appear as an error notification.

    const signInUri: string | undefined = connection.metadata?.sign_in_uri;
    if (!signInUri) {
      logger.error(
        "createSession() no sign-in URI found in connection metadata; this should not happen",
      );
      throw await this.signInError("Failed to create new connection. Please try again.");
    }

    if (process.env.CONFLUENT_VSCODE_E2E_TESTING) {
      // write the CCloud sign-in URL to a temp file for E2E tests since we can't reliably intercept
      // it across different platforms with Playwright+Electron
      try {
        const tempFilePath = join(tmpdir(), "vscode-e2e-ccloud-signin-url.txt");
        await writeFile(tempFilePath, signInUri);
        logger.info("E2E: wrote CCloud sign-in URL to temp file", { signInUri, tempFilePath });
      } catch (error) {
        logger.error("E2E: failed to write CCloud sign-in URL to temp file", error);
      }
    }

    // this will block until we handle the URI event or the user cancels
    const authCallback: AuthCallbackEvent | undefined = await this.browserAuthFlow(signInUri);

    if (authCallback === undefined) {
      // user cancelled the "Signing in ..." progress notification
      logger.debug("createSession() user cancelled the operation");
      throw new CCloudSignInError("User cancelled the authentication flow.");
    }

    if (authCallback.resetPassword) {
      // user reset their password, so we need to notify them to reauthenticate
      logger.debug("createSession() user reset their password");
      void showInfoNotificationWithButtons(
        "Your password has been reset. Please sign in again to Confluent Cloud.",
        { [CCLOUD_SIGN_IN_BUTTON_LABEL]: async () => await this.createSession() },
      );
      // no sidecar logs needed here, just exit early
      throw new CCloudSignInError("User reset their password.");
    }

    if (!authCallback.success) {
      // the user hit the "Authentication Failed" browser callback page, which should have more
      // details about the exact error (but those details aren't sent to the extension in the URI)
      const authFailedMsg = "Confluent Cloud authentication failed. See browser for details.";
      void vscode.window.showErrorMessage(authFailedMsg);
      logUsage(UserEvent.CCloudAuthentication, {
        status: "authentication failed",
      });
      throw await this.signInError(authFailedMsg);
    }

    logUsage(UserEvent.CCloudAuthentication, {
      status: "signed in",
    });

    // sign-in completed, wait for the connection to become usable
    const authenticatedConnection: Connection | null =
      await waitForConnectionToBeStable(CCLOUD_CONNECTION_ID);

    // these three are all odd edge-cases that shouldn't happen if authentication completed,
    // but if they do, we need to gather sidecar logs to help debug
    if (!authenticatedConnection) {
      throw await this.signInError(
        "CCloud connection failed to become usable after authentication.",
      );
    }
    const ccloudStatus: CCloudStatus | undefined = authenticatedConnection.status.ccloud;
    if (!ccloudStatus) {
      throw await this.signInError("Authenticated connection has no status information.");
    }
    const userInfo: UserInfo | undefined = ccloudStatus.user;
    if (!userInfo) {
      throw await this.signInError("Authenticated connection has no CCloud user.");
    }

    // User signed in successfully so we send an identify event to Segment and LaunchDarkly
    sendTelemetryIdentifyEvent({
      eventName: UserEvent.CCloudAuthentication,
      userInfo,
      session: undefined,
    });
    (await getLaunchDarklyClient())?.identify({ key: userInfo.id });

    void vscode.window.showInformationMessage(
      `Successfully signed in to Confluent Cloud as ${ccloudStatus.user?.username}`,
    );
    logger.debug("successfully authenticated with Confluent Cloud");
    // update the connected state in the secret store so other workspaces can be notified of the
    // change and the middleware doesn't get an outdated state before the handler can update it
    await getResourceManager().setCCloudState(ccloudStatus.state);
    const session = convertToAuthSession(authenticatedConnection);
    await this.handleSessionCreated(session, true);
    ccloudConnected.fire(true);

    observabilityContext.ccloudAuthCompleted = true;
    observabilityContext.ccloudAuthExpiration = ccloudStatus.requires_authentication_at;
    observabilityContext.ccloudSignInCount++;

    return session;
  }

  /**
   * Whenever `vscode.authentication.getSession()` is called with our {@link AUTH_PROVIDER_ID}, this
   * method will be called to get the current session.
   * @remarks We don't use `scopes` at all here, since the sidecar manages all connection->access
   * token and scope information.
   */
  async getSessions(): Promise<vscode.AuthenticationSession[]> {
    logger.debug("getSessions()");

    let connection: Connection | null = null;
    let sessionSecret: string | undefined;
    let authComplete: string | undefined;

    const secretStorage: vscode.SecretStorage = getSecretStorage();
    // check with the sidecar to see if we have an existing CCloud connection, and also check in to
    // see what the (persistent, cross-workspace) secret store says about existence of a session
    [connection, sessionSecret, authComplete] = await Promise.all([
      getCCloudConnection(),
      secretStorage.get(SecretStorageKeys.AUTH_SESSION_EXISTS),
      secretStorage.get(SecretStorageKeys.AUTH_COMPLETED),
    ]);

    if (
      connection &&
      connection.status.ccloud?.state &&
      [ConnectedState.None, ConnectedState.Failed].includes(connection.status.ccloud.state)
    ) {
      // the connection is unusable, so the auth provider needs to act like there isn't actually a
      // connection and the user needs to sign in
      logger.debug("getSessions() found connection with unusable state", {
        state: connection.status.ccloud.state,
      });
      connection = null;
    }

    const connectionExists: boolean = !!connection; // sidecar says we have a connection
    const cachedSessionExists: boolean = !!this._session; // we have a cached session
    const sessionSecretExists: boolean = !!sessionSecret || !!authComplete;
    if (sessionSecretExists && !connectionExists) {
      // NOTE: this may happen if the user was previously signed in, then VS Code was closed and the
      // sidecar process was stopped, because the secrets would still exist in storage. In this case,
      // we need to remove the secret so that the user can sign in again (and other workspaces will
      // react to the actual change in secret state).
      logger.debug("getSessions() session secret exists but no connection found, removing secret");
      // WARNING: if you add a value below, also add it to the if block, otherwise it may not trigger the onChange event when setting later
      await Promise.all([
        secretStorage.delete(SecretStorageKeys.AUTH_SESSION_EXISTS),
        secretStorage.delete(SecretStorageKeys.AUTH_COMPLETED),
        // don't check this in the if block above since it changes with AUTH_COMPLETED
        secretStorage.delete(SecretStorageKeys.AUTH_PASSWORD_RESET),
        // we don't need to check for this up above, just clear it out if we don't have a connection
        secretStorage.delete(SecretStorageKeys.CCLOUD_STATE),
      ]);
    } else if (!sessionSecretExists && connectionExists) {
      // NOTE: this should never happen, because in order for the connection to be made with the
      // sidecar, we should have also stored the secret, so we mainly just want to log this
      logger.error("getSessions() no session secret found but connection exists");
    }

    // NOTE: if either of these two are true, it's due to a change in the auth state outside of the
    // user signing in (createSession) or out (removeSession) from the Accounts action in **this**
    // workspace (e.g. they signed in or out from another workspace) and we caught this from another
    // part of the codebase attempting to get the auth session, so we need to update our internal state
    // and inform any listeners
    const changedToConnected: boolean = connectionExists && !cachedSessionExists;
    const changedToDisconnected: boolean = !connectionExists && cachedSessionExists;
    const logBody = {
      connectionExists,
      cachedSessionExists,
      changedToConnected,
      changedToDisconnected,
      sessionSecretExists,
    };
    logger.debug("getSessions() local auth state change check", logBody);

    // Do this before possibly firing event, 'cause event listeners may pivot
    // off of the context value.
    await this.updateContextValue(connectionExists);

    if (changedToConnected || changedToDisconnected) {
      logger.debug("getSessions() auth state changed, firing ccloudConnected event", logBody);
      // inform any listeners whether or not we have a CCloud connection (auth session)
      ccloudConnected.fire(!!connection);
    }

    if (!connection) {
      if (changedToDisconnected) {
        // NOTE: this will mainly happen if something goes wrong with the connection or the sidecar
        // process and the poller notices the connection is gone
        logger.debug("getSessions() transitioned from connected to disconnected", logBody);
        await this.handleSessionRemoved(true);
      }
      logger.debug("getSessions() no connection found");
      return [];
    }

    const session = convertToAuthSession(connection);

    if (changedToConnected) {
      // This transition is either very rare or impossible to get into altogether, because changes
      // from disconnected->connected will update secret state or go through `createSession()`, and
      // we should have received a websocket message from the sidecar about the transition
      logger.debug("getSessions() transitioned from disconnected to connected", logBody);
      await this.handleSessionCreated(session, true);
    }

    logger.debug("getSessions() returning session");
    return [session];
  }

  /**
   * Remove a connection from the sidecar and update the provider's internal state.
   * @remarks This is only called after a user chooses to "Sign out" from the Accounts menu and
   * continues past the confirmation dialog that appears.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async removeSession(sessionId: string): Promise<void> {
    logger.debug("removeSession()");
    // make sure the sidecar says we have a connection first
    const existingConnection: Connection | null = await getCCloudConnection();
    if (!existingConnection) {
      if (this._session) {
        logger.debug("removeSession() no sidecar CCloud connection, but we have a cached session");
        // if we have a cached session but no connection, we need to clear it
        // (this is rare but could happen if the connection was removed from another workspace)
        await this.handleSessionRemoved(true);
      }
      return;
    }

    logUsage(UserEvent.CCloudAuthentication, {
      status: "signed out",
    });

    // tell the sidecar to delete the connection and update the connected state "secret" in storage
    // to prevent any last-minute requests from passing through the middleware
    await Promise.all([
      deleteCCloudConnection(),
      getSecretStorage().delete(SecretStorageKeys.CCLOUD_STATE),
    ]);
    await this.handleSessionRemoved(true);
    ccloudConnected.fire(false);
    observabilityContext.ccloudSignOutCount++;
  }

  /**
   * Set up event listeners for this provider.
   */
  setEventListeners(context: vscode.ExtensionContext): vscode.Disposable[] {
    const resourceManager = getResourceManager();

    // watch for changes in the stored auth session that may occur from other workspaces/windows
    // NOTE: the onDidChangeSessions event does not appear cross-workspace, so this needs to stay
    const secretsOnDidChangeSub: vscode.Disposable = context.secrets.onDidChange(
      async ({ key }: vscode.SecretStorageChangeEvent) => {
        if (
          [
            SecretStorageKeys.AUTH_SESSION_EXISTS,
            SecretStorageKeys.AUTH_COMPLETED,
            SecretStorageKeys.AUTH_PASSWORD_RESET,
            SecretStorageKeys.CCLOUD_STATE,
          ].includes(key as SecretStorageKeys)
        ) {
          logger.debug(`storage change detected for key: ${key}`);
        }

        switch (key) {
          case SecretStorageKeys.AUTH_SESSION_EXISTS: {
            // another workspace noticed a change in the connected state, so we need to update our internal
            // state and notify any listeners in this extension instance
            await this.handleSessionSecretChange();
            break;
          }
          case SecretStorageKeys.AUTH_COMPLETED: {
            // the user has completed the auth flow in some way, whether in this window or another --
            // (e.g they started the auth flow in one window and another handled the callback URI) --
            // so we need to notify any listeners in this extension instance that the auth flow has
            // completed to resolve any promises that may still be waiting
            const [success, resetPassword]: [boolean, boolean] = await Promise.all([
              resourceManager.getAuthFlowCompleted(),
              resourceManager.getAuthFlowPasswordReset(),
            ]);
            this._onAuthFlowCompletedSuccessfully.fire({ success, resetPassword });

            if (!success) {
              // log current preferences to help debug any auth issues
              const preferences = loadPreferencesFromWorkspaceConfig();
              logger.debug(
                `authProvider: ${SecretStorageKeys.AUTH_COMPLETED} changed (success=${success}); current sidecar preferences:`,
                { preferences },
              );
            }
            break;
          }
        }
      },
    );

    // general listener for the URI handling event, which is used to resolve any auth flow promises
    // and will trigger the secrets.onDidChange event described above
    const ccloudAuthCallbackSub: vscode.Disposable = ccloudAuthCallback.event(
      async (uri) => await this.handleCCloudAuthCallback(uri),
    );

    // if any other part of the extension notices that our current CCloud connection transitions from
    // SUCCESS to FAILED/NONE, we need to remove the session
    const ccloudAuthSessionInvalidatedSub: vscode.Disposable = ccloudAuthSessionInvalidated.event(
      async () => {
        logger.debug("ccloudAuthSessionInvalidated event fired");
        // don't delete the actual CCloud connection, just remove it from the authentication provider
        // so we can continue to use the same sign_in_uri until the user explicitly signs out
        await this.handleSessionRemoved(true);
        ccloudConnected.fire(false);
      },
    );

    return [secretsOnDidChangeSub, ccloudAuthCallbackSub, ccloudAuthSessionInvalidatedSub];
  }

  /**
   * Start the browser-based authentication flow. This will open the sign-in URI in the user's
   * default browser for the user to complete authentication.
   *
   * @param uri The URI to open in the browser.
   *
   * @returns A promise that resolves to a `boolean` indicating whether the authentication flow was
   * successful, or `undefined` if the user cancelled the operation.
   */
  async browserAuthFlow(uri: string): Promise<AuthCallbackEvent | undefined> {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Signing in to [Confluent Cloud](${uri})...`,
        cancellable: true,
      },
      async (_, token): Promise<AuthCallbackEvent | undefined> => {
        if (!process.env.CONFLUENT_VSCODE_E2E_TESTING) {
          // E2E tests will handle the CCloud login browser interaction separately, and leaving this
          // enabled will result in a new browser tab opened for every @ccloud-tagged test that's
          // never filled, submitted, or closed
          await vscode.env.openExternal(vscode.Uri.parse(uri));
        }
        // keep progress notification open until one of two things happens:
        // - we handle the auth completion event and resolve with the callback query params
        // - user clicks the "Cancel" button from the notification
        const [authCallback, cancelled] = await Promise.race([
          this.waitForUriHandling().then((authCallback): [AuthCallbackEvent, boolean] => [
            authCallback,
            false,
          ]),
          this.waitForCancellationRequest(token).then((): [AuthCallbackEvent, boolean] => [
            { success: false, resetPassword: false } as AuthCallbackEvent,
            true,
          ]),
        ]);
        if (cancelled) return;
        // user completed the auth flow, so we need to resolve the promise with the callback
        // query params
        logger.debug("browserAuthFlow() user completed the auth flow", authCallback);
        return authCallback;
      },
    );
  }

  /**
   * Wait for the user to complete the authentication flow in the browser and resolve the promise,
   * whether triggered from this workspace or another.
   */
  waitForUriHandling(): Promise<AuthCallbackEvent> {
    return new Promise<AuthCallbackEvent>((resolve) => {
      // this will only fire if the auth flow didn't initially start in another window entirely and
      // we're just reacting to a change in secret state
      const sub = this._onAuthFlowCompletedSuccessfully.event((event: AuthCallbackEvent) => {
        logger.debug("handling _onAuthFlowCompletedSuccessfully event", event);
        sub.dispose();
        resolve(event);
      });
    });
  }

  /** Only used for when the user clicks "Cancel" during the "Signing in..." progress notification. */
  private waitForCancellationRequest(token: vscode.CancellationToken): Promise<void> {
    return new Promise<void>((resolve) =>
      token.onCancellationRequested(async () => {
        resolve();
      }),
    );
  }

  /**
   * Add the session to the provider's internal state and notify event listeners.
   * Optionally update the "secret" in storage to reflect the new session across workspaces so their
   * `secrets.onDidChange` listeners can be triggered.
   * @param session The session to add.
   * @param updateSecret Whether or not to update the secret in storage. (NOTE: Setting this to `true`
   * will trigger the `secrets.onDidChange` listener, including in other workspaces.)
   */
  private async handleSessionCreated(
    session: vscode.AuthenticationSession,
    updateSecret: boolean = false,
  ) {
    // First some workspace-scoped actions ...
    logger.debug("handleSessionCreated()", { updateSecret });
    // the following calls are all workspace-scoped
    this._session = session;
    this._onDidChangeSessions.fire({
      added: [session],
      removed: [],
      changed: [],
    });
    await this.updateContextValue(true);

    // updating secrets is cross-workspace-scoped
    if (updateSecret) {
      await getSecretStorage().store(SecretStorageKeys.AUTH_SESSION_EXISTS, "true");
    }
  }

  /**
   * Remove the session from the provider's internal state and notify event listeners.
   * Optionally update the "secret" in storage to reflect the new session across workspaces so their
   * `secrets.onDidChange` listeners can be triggered.
   * @param updateSecret Whether or not to update the secret in storage. (NOTE: Setting this to `true`
   * will trigger the `secrets.onDidChange` listener, including in other workspaces.)
   */
  private async handleSessionRemoved(updateSecret: boolean = false) {
    // the following calls are all workspace-scoped
    logger.debug("handleSessionRemoved()", { updateSecret });
    await this.updateContextValue(false);
    await clearCurrentCCloudResources();
    if (!this._session) {
      logger.debug("handleSessionRemoved(): no cached `_session` to remove; this shouldn't happen");
    } else {
      this._onDidChangeSessions.fire({
        added: [],
        removed: [this._session],
        changed: [],
      });
      this._session = null;
    }

    // updating secrets is cross-workspace-scoped
    if (updateSecret) {
      const secretStorage: vscode.SecretStorage = getSecretStorage();
      await Promise.all([
        secretStorage.delete(SecretStorageKeys.AUTH_SESSION_EXISTS),
        secretStorage.delete(SecretStorageKeys.AUTH_COMPLETED),
        secretStorage.delete(SecretStorageKeys.AUTH_PASSWORD_RESET),
      ]);
    }
  }

  /**
   * When the stored session secret changes, update the internal session state and notify listeners.
   * This is useful for when the session is added or removed from another workspace and this instance
   * of the extension (and auth provider) needs to be updated to match.
   */
  private async handleSessionSecretChange() {
    logger.debug("handleSessionSecretChange()");
    const session = await vscode.authentication.getSession(AUTH_PROVIDER_ID, [], {
      createIfNone: false,
    });
    if (!session) {
      // SCENARIO 1: user signed out / auth session was removed
      // if we had a session before, we need to remove it, as well as inform the Accounts action to
      // show the sign-in badge again
      if (this._session) {
        this.handleSessionRemoved();
      } else {
        logger.debug(
          "No auth session, and no cached _session (for this extension instance) found to remove; not taking any action",
        );
      }
    } else {
      // SCENARIO 2: user signed in / auth session was added
      // add a new auth session to the Accounts action and populate this instance's cached session
      // state
      this.handleSessionCreated(session);
    }
  }

  /**
   * Inform the UI whether or not the user is connected to CCloud.
   *
   * NOTE: We debated handling this elsewhere in the code, but being that the auth provider is the
   * source of truth for connection status, it makes sense to handle it here despite the fact that
   * it's mainly a UI concern.
   */
  private async updateContextValue(connected: boolean) {
    await setContextValue(ContextValues.ccloudConnectionAvailable, connected);
  }

  /**
   * Handle the URI event for the authentication callback.
   * @param uri The URI that was handled.
   */
  async handleCCloudAuthCallback(uri: vscode.Uri): Promise<void> {
    const queryParams = new URLSearchParams(uri.query);
    const callbackEvent: AuthCallbackEvent = {
      success: queryParams.get("success") === "true",
      resetPassword: queryParams.get("reset_password") === "true",
    };
    logger.debug("handled authCallback URI; calling `setAuthFlowCompleted()`", callbackEvent);
    await getResourceManager().setAuthFlowCompleted(callbackEvent);

    if (callbackEvent.resetPassword) {
      // clear any existing auth session so the user can sign in again with their new password
      await Promise.all([
        deleteCCloudConnection(),
        getSecretStorage().delete(SecretStorageKeys.CCLOUD_STATE),
      ]);
      ccloudAuthSessionInvalidated.fire();
      void showInfoNotificationWithButtons(
        "Your password has been reset. Please sign in again to Confluent Cloud.",
        { [CCLOUD_SIGN_IN_BUTTON_LABEL]: async () => await this.createSession() },
      );
    }
  }

  /**
   * Create a {@link CCloudSignInError} and gather sidecar logs to send to Sentry, for when a sign-in
   * error occurs during {@linkcode ConfluentCloudAuthProvider.createSession `createSession()`}.
   * @param message The error message to include in the {@link CCloudSignInError}.
   * @returns A {@link CCloudSignInError} for the caller to throw and escape `createSession()`
   */
  async signInError(message: string): Promise<CCloudSignInError> {
    const error = new CCloudSignInError(message);
    const sidecarLogs: string[] = await getLastSidecarLogLines();
    await logError(error, message, { extra: { sidecarLogs } });
    return error;
  }
}

/** Converts a {@link Connection} to a {@link vscode.AuthenticationSession}. */
export function convertToAuthSession(connection: Connection): vscode.AuthenticationSession {
  logger.debug("convertToAuthSession()", connection.status.ccloud?.state);
  // NOTE: accessToken is just the connection ID; the sidecar manages the actual access token.
  // we don't want to store the token status or anything that might change, because we may end up
  // seeing "Grant ____ permissions" in the Accounts action, which would be confusing to the user
  const ccloudUser: UserInfo | undefined = connection.status.ccloud?.user;
  if (!ccloudUser) {
    logger.error("convertToAuthSession() connection has no CCloud user, which should never happen");
    throw new Error("Connection has no CCloud user.");
  }
  if (!ccloudUser.id || !ccloudUser.username) {
    logger.error(
      "convertToAuthSession() connection has CCloud user with no id or username, which should never happen",
    );
    throw new Error("Connection has CCloud user with no id or username.");
  }
  const session: vscode.AuthenticationSession = {
    id: CCLOUD_CONNECTION_ID,
    accessToken: CCLOUD_CONNECTION_ID,
    account: {
      id: ccloudUser.id,
      label: ccloudUser.username,
    },
    scopes: [],
  };
  return session;
}
