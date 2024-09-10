import * as vscode from "vscode";
import { Connection } from "./clients/sidecar";
import { AUTH_PROVIDER_ID, CCLOUD_CONNECTION_ID } from "./constants";
import { getExtensionContext } from "./context";
import { ccloudAuthSessionInvalidated, ccloudConnected } from "./emitters";
import { Logger } from "./logging";
import { openExternal, pollCCloudConnectionAuth } from "./sidecar/authStatusPolling";
import {
  createCCloudConnection,
  deleteCCloudConnection,
  getCCloudConnection,
} from "./sidecar/connections";
import { getStorageManager } from "./storage";
import { AUTH_COMPLETED_KEY, AUTH_SESSION_EXISTS_KEY } from "./storage/constants";
import { getResourceManager } from "./storage/resourceManager";
import { getUriHandler } from "./uriHandler";

const logger = new Logger("authProvider");

export class ConfluentCloudAuthProvider implements vscode.AuthenticationProvider {
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
      throw new Error("ExtensionContext not set yet");
    }

    const resourceManager = getResourceManager();
    // watch for changes in the stored auth session that may occur from other workspaces/windows
    // NOTE: the onDidChangeSessions event does not appear cross-workspace, so this needs to stay
    context.secrets.onDidChange(async ({ key }: vscode.SecretStorageChangeEvent) => {
      logger.debug("authProvider: secrets.onDidChange event", { key });
      switch (key) {
        case AUTH_SESSION_EXISTS_KEY: {
          // another workspace noticed a change in the auth status, so we need to update our internal
          // state and notify any listeners in this extension instance
          await this.handleSessionSecretChange();
          break;
        }
        case AUTH_COMPLETED_KEY: {
          // the user has completed the auth flow in some way, whether in this window or another --
          // (e.g they started the auth flow in one window and another handled the callback URI) --
          // so we need to notify any listeners in this extension instance that the auth flow has
          // completed to resolve any promises that may still be waiting
          const success: boolean = await resourceManager.getAuthFlowCompleted();
          this._onAuthFlowCompletedSuccessfully.fire(success);
          break;
        }
        default:
          logger.warn("authProvider: secrets.onDidChange event not handled", { key });
      }
    });
    // general listener for the URI handling event, which is used to resolve any auth flow promises
    // and will trigger the secrets.onDidChange event described above
    getUriHandler().event(async (uri: vscode.Uri) => {
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
    // VALID_TOKEN to INVALID_TOKEN/NO_TOKEN, we need to remove the session and stop polling
    ccloudAuthSessionInvalidated.event(async () => {
      logger.debug("ccloudAuthSessionInvalidated event fired");
      await this.removeSession(CCLOUD_CONNECTION_ID);
    });
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
    const existingConnection: Connection | null = await getCCloudConnection();
    if (!existingConnection) {
      connection = await createCCloudConnection();
    } else {
      connection = existingConnection;
    }

    const signInUri: string | undefined = connection.metadata?.sign_in_uri;
    if (!signInUri) {
      throw new Error("Failed to create new connection. Please try again.");
    }

    try {
      // this will block until we handle the URI event or the user cancels
      await this.browserAuthFlow(signInUri);
    } catch (e) {
      if (e instanceof Error) {
        await vscode.window.showErrorMessage(e.message);
        // TODO(shoup): remove this once we're managing a persistent connection and transitioning
        // between NO_TOKEN->VALID_TOKEN->NO_TOKEN instead of creating/deleting connections
        await deleteCCloudConnection();
      }
      // this won't re-notify the user of the error, so no issue with re-throwing while showing the
      // error notification above (if it exists)
      throw e;
    }

    const authenticatedConnection = await getCCloudConnection();
    if (!authenticatedConnection) {
      throw new Error("Failed to find created connection");
    }

    // we want to continue regardless of whether or not the user dismisses the notification,
    // so we aren't awaiting this:
    vscode.window.showInformationMessage(
      `Successfully logged in to Confluent Cloud as ${authenticatedConnection.status.authentication.user?.username}`,
    );
    logger.debug("createSession() successfully authenticated with Confluent Cloud");
    const session = convertToAuthSession(authenticatedConnection);
    await this.handleSessionCreated(session, true);
    ccloudConnected.fire(true);
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
    const storageManager = getStorageManager();
    // check with the sidecar to see if we have an existing CCloud connection, and also check in to
    // see what the (persistent, cross-workspace) secret store says about existence of a session
    const [connection, sessionSecret] = await Promise.all([
      getCCloudConnection(),
      storageManager.getSecret(AUTH_SESSION_EXISTS_KEY),
    ]);

    const connectionExists: boolean = !!connection; // sidecar says we have a connection
    const cachedSessionExists: boolean = !!this._session; // we have a cached session
    const sessionSecretExists: boolean = !!sessionSecret;
    if (sessionSecretExists && !connectionExists) {
      // NOTE: this may happen if the user was previously signed in, then VS Code was closed and the
      // sidecar process was stopped, because the secrets would still exist in storage. In this case,
      // we need to remove the secret so that the user can sign in again (and other workspaces will
      // react to the actual change in secret state).
      logger.debug("getSessions() session secret exists but no connection found, removing secret");
      await Promise.all([
        storageManager.deleteSecret(AUTH_SESSION_EXISTS_KEY),
        storageManager.deleteSecret(AUTH_COMPLETED_KEY),
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
    };
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

    await deleteCCloudConnection();
    await this.handleSessionRemoved(true);
    ccloudConnected.fire(false);
  }

  async browserAuthFlow(uri: string) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Logging in to [Confluent Cloud](${uri})...`,
        cancellable: true,
      },
      async (_, token) => {
        await openExternal(vscode.Uri.parse(uri));
        // keep progress notification open until one of two things happens:
        // - we handle the auth completion event and resolve/reject based on success value
        // - user clicks the "Cancel" button from the notification
        await Promise.race([this.waitForUriHandling(), this.waitForCancellationRequest(token)]);
      },
    );
  }

  /**
   * Wait for the user to complete the authentication flow in the browser and resolve the promise,
   * whether triggered from this workspace or another.
   */
  waitForUriHandling(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // this will only fire if the auth flow didn't initially start from the Accounts action, or
      // if it was done in another window entirely -- see
      this._onAuthFlowCompletedSuccessfully.event((success: boolean) => {
        logger.debug("handling _onAuthFlowCompletedSuccessfully event", { success });
        if (success) {
          resolve();
        } else {
          reject(new Error("Authentication failed, see browser for details"));
        }
      });
    });
  }

  /** Only used for when the user clicks "Cancel" during the "Logging in..." progress notification. */
  private waitForCancellationRequest(token: vscode.CancellationToken): Promise<void> {
    return new Promise<void>((_, reject) =>
      token.onCancellationRequested(async () => {
        // TODO(shoup): remove this once we're managing a persistent connection and transitioning
        // between NO_TOKEN->VALID_TOKEN->NO_TOKEN instead of creating/deleting connections
        await deleteCCloudConnection();
        reject();
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
    // the following three calls are all workspace-scoped
    this._session = session;
    this._onDidChangeSessions.fire({
      added: [session],
      removed: [],
      changed: [],
    });
    pollCCloudConnectionAuth.start();

    // updating secrets is cross-workspace-scoped
    if (updateSecret) {
      await getStorageManager().setSecret(AUTH_SESSION_EXISTS_KEY, "true");
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
    // the following three calls are all workspace-scoped
    logger.debug("handleSessionRemoved()", { updateSecret });
    pollCCloudConnectionAuth.stop();
    if (!this._session) {
      logger.error("handleSessionRemoved(): no cached `_session` to remove; this shouldn't happen");
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
        storageManager.deleteSecret(AUTH_SESSION_EXISTS_KEY),
        storageManager.deleteSecret(AUTH_COMPLETED_KEY),
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
    const session = await getAuthSession();
    if (!session) {
      // SCENARIO 1: user logged out / auth session was removed
      // if we had a session before, we need to remove it and stop polling for auth status, as well
      // as inform the Accounts action to show the sign-in badge again
      if (this._session) {
        this.handleSessionRemoved();
      } else {
        logger.warn("No cached session found to remove; should we still fire the event?");
      }
    } else {
      // SCENARIO 2: user logged in / auth session was added
      // add a new auth session to the Accounts action, populate this instance's cached session state,
      // and start polling for auth status
      this.handleSessionCreated(session);
    }
  }
}

/** Converts a {@link Connection} to a {@link vscode.AuthenticationSession}. */
function convertToAuthSession(connection: Connection): vscode.AuthenticationSession {
  logger.debug("convertToAuthSession()", connection.status.authentication.status);
  const session: vscode.AuthenticationSession = {
    id: CCLOUD_CONNECTION_ID,
    accessToken: connection.status.authentication.status,
    account: {
      id: connection.status.authentication.user?.id ?? "unk user id",
      label: connection.status.authentication.user?.username ?? "unk username",
    },
    scopes: [],
  };
  return session;
}

/** Convenience function to get the latest CCloud session via the Authentication API. */
export async function getAuthSession(): Promise<vscode.AuthenticationSession | undefined> {
  // Will immediately cascade call into ConfluentCloudAuthProvider.getSessions().
  return await vscode.authentication.getSession(AUTH_PROVIDER_ID, [], {
    createIfNone: false,
  });
}

export function getAuthProvider(): ConfluentCloudAuthProvider {
  return ConfluentCloudAuthProvider.getInstance();
}
