import * as vscode from "vscode";
import { Connection } from "./clients/sidecar";
import { AUTH_PROVIDER_ID, CCLOUD_CONNECTION_ID } from "./constants";
import { ccloudConnected } from "./emitters";
import { Logger } from "./logging";
import { getSidecar } from "./sidecar";
import {
  createCCloudConnection,
  getCCloudConnection,
  openExternal,
  pollCCloudConnectionAuth,
} from "./sidecar/connections";
import { getStorageManager } from "./storage";
import { UriEventHandler } from "./uriHandler";

const logger = new Logger("authProvider");

/** This is what appears in "Sign in with <label> to use Confluent" from the Accounts action. */
const AUTH_PROVIDER_LABEL = "Confluent Cloud";

export class ConfluentCloudAuthProvider implements vscode.AuthenticationProvider {
  private _uriHandler = new UriEventHandler();

  // tells VS Code which sessions have been added, removed, or changed for this extension instance
  // NOTE: does not trigger cross-workspace events
  private _onDidChangeSessions =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  get onDidChangeSessions() {
    return this._onDidChangeSessions.event;
  }

  /** Only used as a way to kick off cross-workspace events. Only ever set to "true" or deleted. */
  private sessionKey = "authSession";
  /** Used to check for changes in auth state between extension instance and sidecar. */
  private _session: vscode.AuthenticationSession | null = null;

  constructor(private context: vscode.ExtensionContext) {
    const providerDisposable = vscode.authentication.registerAuthenticationProvider(
      AUTH_PROVIDER_ID,
      AUTH_PROVIDER_LABEL,
      this,
      {
        supportsMultipleAccounts: false, // this is the default, but just to be explicit
      },
    );
    const uriHandlerDisposable = vscode.window.registerUriHandler(this._uriHandler);
    context.subscriptions.push(providerDisposable, uriHandlerDisposable);

    // watch for changes in the stored auth session that may occur from other workspaces/windows
    // NOTE: the onDidChangeSessions event does not appear cross-workspace, so this needs to stay
    context.secrets.onDidChange(async (e) => {
      if (e.key === this.sessionKey) {
        await this.handleSessionSecretChange();
      }
    });
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
      throw new Error(`Failed to log in: ${e}`);
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
    // check with the sidecar to see if we have an existing CCloud connection
    const connection = await getCCloudConnection();

    const connectionExists: boolean = !!connection; // sidecar says we have a connection
    const cachedSessionExists: boolean = !!this._session; // we have a cached session

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
        logger.debug("getSessions() transitioned from connected to disconnected", logBody);
        await this.handleSessionRemoved(true);
      }
      logger.debug("getSessions() no connection found");
      return [];
    }

    const session = convertToAuthSession(connection);
    if (changedToConnected) {
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

    const client = (await getSidecar()).getConnectionsResourceApi();
    try {
      await client.gatewayV1ConnectionsIdDelete({ id: CCLOUD_CONNECTION_ID });
    } catch (e) {
      logger.error("Error deleting connection", e);
    }

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
        await Promise.race([
          new Promise<void>((_, reject) => token.onCancellationRequested(() => reject())),
          new Promise<void>((resolve) => {
            this._uriHandler.event(async (event) => {
              await this.handleAuthCallback(event);
              resolve();
            });
          }),
        ]);
      },
    );
  }

  private handleAuthCallback(uri: vscode.Uri) {
    const query = new URLSearchParams(uri.query);
    if (!query.has("authCallback")) {
      return;
    }
    logger.debug("Got auth callback URI", query);
    // nothing else to do here; this resolves and the browserAuthFlow() promise is resolved
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
      await getStorageManager().setSecret(this.sessionKey, "true");
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
      await getStorageManager().deleteSecret(this.sessionKey);
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
  return await vscode.authentication.getSession(AUTH_PROVIDER_ID, [], {
    createIfNone: false,
  });
}
