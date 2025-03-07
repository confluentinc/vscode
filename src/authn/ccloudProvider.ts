import * as vscode from "vscode";
import { Connection } from "../clients/sidecar";
import { AUTH_PROVIDER_ID, CCLOUD_CONNECTION_ID } from "../constants";
import { getExtensionContext } from "../context/extension";
import { observabilityContext } from "../context/observability";
import { ContextValues, setContextValue } from "../context/values";
import { ccloudAuthSessionInvalidated, ccloudConnected } from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { Logger } from "../logging";
import { fetchPreferences } from "../preferences/updates";
import {
  clearCurrentCCloudResources,
  createCCloudConnection,
  deleteCCloudConnection,
  getCCloudConnection,
} from "../sidecar/connections/ccloud";
import { waitForConnectionToBeStable } from "../sidecar/connections/watcher";
import { getStorageManager } from "../storage";
import { SecretStorageKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";
import { logUsage, UserEvent } from "../telemetry/events";
import { sendTelemetryIdentifyEvent } from "../telemetry/telemetry";
import { getUriHandler } from "../uriHandler";
import { openExternal } from "./ccloudStateHandling";

const logger = new Logger("authn.ccloudProvider");

/**
 * Authentication provider for Confluent Cloud, which handles syncing connection/auth states with the
 * sidecar.
 *
 * Main responsibilities:
 * - {@linkcode createSession()}: Create a CCloud {@link Connection} with the sidecar if one doesn't
 *  already exist, then start the browser-based authentication flow. For connections that exist
 *  already, we reuse the `sign_in_uri` from the {@link Connection}'s `metadata`.
 * - {@linkcode getSessions()}: Whenever `vscode.authentication.getSession()` is called with our
 *  `AUTH_PROVIDER_ID`, this method will be called to get the current session. We don't use `scopes`
 *  at all here, since the sidecar manages all connection->access token and scope information.
 * - {@linkcode removeSession()}: Deletes the connection from the sidecar and update the provider's
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
 * from the provider's internal state and stop polling for auth status (but not delete the connection)
 *
 * In general, once a user successfully authenticates for the first time, we will continue to reuse
 * that connection until they sign out. This is to avoid inconsistencies in `sign_in_uri` usage, so
 * after the initial transition from `NO_TOKEN` to `VALID_TOKEN`, any time the user may need to
 * reauthenticate will be with the same connection (and thus the same `sign_in_uri`). (E.g. after
 * token expiration or any other errors with the existing session that the sidecar cannot recover
 * from.) These will be transitions between `VALID_TOKEN` and `FAILED`/`INVALID_TOKEN` states. The
 * only way we get back to `NO_TOKEN` is by deleting the connection entirely and recreating a new one
 * (with a new `sign_in_uri`), which should only be done by the user signing out.
 */
export class ConfluentCloudAuthProvider implements vscode.AuthenticationProvider {
  /** Disposables belonging to this provider to be added to the extension context during activation,
   * cleaned up on extension deactivation. */
  disposables: vscode.Disposable[] = [];

  // tells VS Code which sessions have been added, removed, or changed for this extension instance
  // NOTE: does not trigger cross-workspace events
  private _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  get onDidChangeSessions() {
    return this._onDidChangeSessions.event;
  }

  // used to notify the extension when the user has completed the auth flow and resolve any promises
  private _onAuthFlowCompletedSuccessfully = new vscode.EventEmitter<boolean>();

  /** Used to check for changes in auth state between extension instance and sidecar. */
  private _session: vscode.AuthenticationSession | null = null;

  private static instance: ConfluentCloudAuthProvider | null = null;
  // private to enforce singleton pattern and avoid attempting to re-register the auth provider
  private constructor() {
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
    logger.debug("createSession()");
    let connection: Connection;

    // we should only ever have to create a connection when a user is signing in for the first
    // time or if they explicitly logged out and the connection is deleted -- see `.removeSession().
    const existingConnection: Connection | null = await getCCloudConnection();
    if (!existingConnection) {
      connection = await createCCloudConnection();
      logger.debug("createSession() created new connection");
    } else {
      connection = existingConnection;
      logger.debug("createSession() using existing connection for sign-in flow", {
        status: connection.status.authentication.status,
      });
    }

    const signInUri: string | undefined = connection.metadata?.sign_in_uri;
    if (!signInUri) {
      logger.error(
        "createSession() no sign-in URI found in connection metadata; this should not happen",
      );
      throw new Error("Failed to create new connection. Please try again.");
    }

    // this will block until we handle the URI event or the user cancels
    const success: boolean | undefined = await this.browserAuthFlow(signInUri);
    if (success === undefined) {
      // user cancelled the operation
      logger.debug("createSession() user cancelled the operation");
      return Promise.reject(new Error("User cancelled the authentication flow."));
    }
    if (!success) {
      const authFailedMsg = `Confluent Cloud authentication failed. See browser for details.`;
      vscode.window.showErrorMessage(authFailedMsg);
      logUsage(UserEvent.CCloudAuthentication, {
        status: "authentication failed",
      });
      return Promise.reject(new Error(authFailedMsg));
    }

    logUsage(UserEvent.CCloudAuthentication, {
      status: "signed in",
    });

    // sign-in completed, wait for the connection to become usable
    const authenticatedConnection = await waitForConnectionToBeStable(CCLOUD_CONNECTION_ID);
    if (!authenticatedConnection) {
      throw new Error("CCloud connection failed to become usable after authentication.");
    }

    // User signed in successfully so we send an identify event to Segment
    if (authenticatedConnection.status.authentication.user) {
      sendTelemetryIdentifyEvent({
        eventName: UserEvent.CCloudAuthentication,
        userInfo: authenticatedConnection.status.authentication.user,
        session: undefined,
      });
    }
    // we want to continue regardless of whether or not the user dismisses the notification,
    // so we aren't awaiting this:
    vscode.window.showInformationMessage(
      `Successfully signed in to Confluent Cloud as ${authenticatedConnection.status.authentication.user?.username}`,
    );
    logger.debug("createSession() successfully authenticated with Confluent Cloud");
    // update the auth status in the secret store so other workspaces can be notified of the change
    // and the middleware doesn't get an outdated status before the poller can update it
    await getResourceManager().setCCloudAuthStatus(
      authenticatedConnection.status.authentication.status,
    );
    const session = convertToAuthSession(authenticatedConnection);
    await this.handleSessionCreated(session, true);
    ccloudConnected.fire(true);

    observabilityContext.ccloudAuthCompleted = true;
    observabilityContext.ccloudAuthExpiration =
      authenticatedConnection.status.authentication.requires_authentication_at;
    observabilityContext.ccloudSignInCount++;

    return session;
  }

  /**
   * Whenever `vscode.authentication.getSession()` is called with our {@link AUTH_PROVIDER_ID}, this
   * method will be called to get the current session.
   * @remarks We don't use `scopes` at all here, since the sidecar manages all connection->access
   * token and scope information.
   */
  async getSessions(): Promise<readonly vscode.AuthenticationSession[]> {
    logger.debug("getSessions()");

    let connection: Connection | null = null;
    let sessionSecret: string | undefined;
    let authComplete: string | undefined;

    const storageManager = getStorageManager();
    // check with the sidecar to see if we have an existing CCloud connection, and also check in to
    // see what the (persistent, cross-workspace) secret store says about existence of a session
    [connection, sessionSecret, authComplete] = await Promise.all([
      getCCloudConnection(),
      storageManager.getSecret(SecretStorageKeys.AUTH_SESSION_EXISTS),
      storageManager.getSecret(SecretStorageKeys.AUTH_COMPLETED),
    ]);

    if (connection && ["NO_TOKEN", "FAILED"].includes(connection.status.authentication.status)) {
      // the connection is unusable, so the auth provider needs to act like there isn't actually a
      // connection and the user needs to sign in
      logger.debug("getSessions() found connection with unusable status", {
        status: connection.status.authentication.status,
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
        storageManager.deleteSecret(SecretStorageKeys.AUTH_SESSION_EXISTS),
        storageManager.deleteSecret(SecretStorageKeys.AUTH_COMPLETED),
        // we don't need to check for this up above, just clear it out if we don't have a connection
        storageManager.deleteSecret(SecretStorageKeys.CCLOUD_AUTH_STATUS),
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
    if (changedToConnected || changedToDisconnected) {
      logger.debug("getSessions() auth state changed, firing ccloudConnected event", logBody);
      // inform any listeners whether or not we have a CCloud connection (auth session)
      ccloudConnected.fire(!!connection);
    }

    this.updateContextValue(connectionExists);

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
      // TODO: possibly remove this check since this transition is either very rare or impossible to
      // get into altogether, because changes from disconnected->connected will update secret state
      // or go through `createSession()`, and the poller won't be running to notice this kind of change
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
        // if we have a cached session but no connection, we need to clear it and stop polling
        // (this is rare but could happen if the connection was removed from another workspace)
        await this.handleSessionRemoved(true);
      }
      return;
    }

    logUsage(UserEvent.CCloudAuthentication, {
      status: "signed out",
    });

    // tell the sidecar to delete the connection and update the auth status "secret" in storage
    // to prevent any last-minute requests from passing through the middleware
    await Promise.all([
      deleteCCloudConnection(),
      getStorageManager().deleteSecret(SecretStorageKeys.CCLOUD_AUTH_STATUS),
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
        logger.debug("authProvider: secrets.onDidChange event", { key });
        switch (key) {
          case SecretStorageKeys.AUTH_SESSION_EXISTS: {
            // another workspace noticed a change in the auth status, so we need to update our internal
            // state and notify any listeners in this extension instance
            await this.handleSessionSecretChange();
            break;
          }
          case SecretStorageKeys.AUTH_COMPLETED: {
            // the user has completed the auth flow in some way, whether in this window or another --
            // (e.g they started the auth flow in one window and another handled the callback URI) --
            // so we need to notify any listeners in this extension instance that the auth flow has
            // completed to resolve any promises that may still be waiting
            const success: boolean = await resourceManager.getAuthFlowCompleted();
            this._onAuthFlowCompletedSuccessfully.fire(success);

            if (!success) {
              // fetch+log current sidecar preferences to help debug any auth issues
              try {
                const preferences = await fetchPreferences();
                logger.debug(
                  `authProvider: ${SecretStorageKeys.AUTH_COMPLETED} changed (success=${success}); current sidecar preferences:`,
                  { preferences },
                );
              } catch {
                // fetchPreferences() will log the error before re-throwing; no need to do anything here
              }
            }
            break;
          }
        }
      },
    );

    // general listener for the URI handling event, which is used to resolve any auth flow promises
    // and will trigger the secrets.onDidChange event described above
    const uriHandlerSub: vscode.Disposable = getUriHandler().event(async (uri: vscode.Uri) => {
      if (uri.path === "/authCallback") {
        const queryParams = new URLSearchParams(uri.query);
        const success: boolean = queryParams.get("success") === "true";
        logger.debug("handled authCallback URI; calling `setAuthFlowCompleted()`", {
          success,
        });
        await resourceManager.setAuthFlowCompleted(success);
      }
    });

    // if any other part of the extension notices that our current CCloud connection transitions from
    // VALID_TOKEN to FAILED/NO_TOKEN, we need to remove the session and stop polling
    const ccloudAuthSessionInvalidatedSub: vscode.Disposable = ccloudAuthSessionInvalidated.event(
      async () => {
        logger.debug("ccloudAuthSessionInvalidated event fired");
        // don't delete the actual CCloud connection, just remove it from the authentication provider
        // so we can continue to use the same sign_in_uri until the user explicitly signs out
        await this.handleSessionRemoved(true);
        ccloudConnected.fire(false);
      },
    );

    return [secretsOnDidChangeSub, uriHandlerSub, ccloudAuthSessionInvalidatedSub];
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
  async browserAuthFlow(uri: string): Promise<boolean | undefined> {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Signing in to [Confluent Cloud](${uri})...`,
        cancellable: true,
      },
      async (_, token) => {
        await openExternal(vscode.Uri.parse(uri));
        // keep progress notification open until one of two things happens:
        // - we handle the auth completion event and resolve with the `success` value
        // - user clicks the "Cancel" button from the notification
        const [success, cancelled] = await Promise.race([
          this.waitForUriHandling().then((success) => [success, false]),
          this.waitForCancellationRequest(token).then(() => [false, true]),
        ]);
        if (cancelled) return;
        // user completed the auth flow, so we need to resolve the promise with the success value
        logger.debug("browserAuthFlow() user completed the auth flow", { success });
        return success;
      },
    );
  }

  /**
   * Wait for the user to complete the authentication flow in the browser and resolve the promise,
   * whether triggered from this workspace or another.
   */
  waitForUriHandling(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // this will only fire if the auth flow didn't initially start from the Accounts action, or
      // if it was done in another window entirely -- see
      const sub = this._onAuthFlowCompletedSuccessfully.event((success: boolean) => {
        logger.debug("handling _onAuthFlowCompletedSuccessfully event", { success });
        sub.dispose();
        resolve(success);
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
    this.updateContextValue(true);

    // updating secrets is cross-workspace-scoped
    if (updateSecret) {
      await getStorageManager().setSecret(SecretStorageKeys.AUTH_SESSION_EXISTS, "true");
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
    this.updateContextValue(false);
    await clearCurrentCCloudResources();
    if (!this._session) {
      logger.debug("handleSessionRemoved(): no cached `_session` to remove; this shouldn't happen");
    } else {
      this._onDidChangeSessions.fire({
        added: [],
        removed: [this._session!],
        changed: [],
      });
      this._session = null;
    }

    // updating secrets is cross-workspace-scoped
    if (updateSecret) {
      const storageManager = getStorageManager();
      await Promise.all([
        storageManager.deleteSecret(SecretStorageKeys.AUTH_SESSION_EXISTS),
        storageManager.deleteSecret(SecretStorageKeys.AUTH_COMPLETED),
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
      // if we had a session before, we need to remove it and stop polling for auth status, as well
      // as inform the Accounts action to show the sign-in badge again
      if (this._session) {
        this.handleSessionRemoved();
      } else {
        logger.debug(
          "No auth session, and no cached _session (for this extension instance) found to remove; not taking any action",
        );
      }
    } else {
      // SCENARIO 2: user signed in / auth session was added
      // add a new auth session to the Accounts action, populate this instance's cached session state,
      // and start polling for auth status
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
  private updateContextValue(connected: boolean) {
    // async, but we can fire-and-forget since we don't need to wait for this to complete
    setContextValue(ContextValues.ccloudConnectionAvailable, connected);
  }
}

/** Converts a {@link Connection} to a {@link vscode.AuthenticationSession}. */
function convertToAuthSession(connection: Connection): vscode.AuthenticationSession {
  logger.debug("convertToAuthSession()", connection.status.authentication.status);
  // NOTE: accessToken is just the connection ID; the sidecar manages the actual access token.
  // we don't want to store the token status or anything that might change, because we may end up
  // seeing "Grant ____ permissions" in the Accounts action, which would be confusing to the user
  const session: vscode.AuthenticationSession = {
    id: CCLOUD_CONNECTION_ID,
    accessToken: CCLOUD_CONNECTION_ID,
    account: {
      id: connection.status.authentication.user?.id ?? "unk user id",
      label: connection.status.authentication.user?.username ?? "unk username",
    },
    scopes: [],
  };
  return session;
}

export function getAuthProvider(): ConfluentCloudAuthProvider {
  return ConfluentCloudAuthProvider.getInstance();
}
