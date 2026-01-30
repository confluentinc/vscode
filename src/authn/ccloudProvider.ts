import { writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import * as vscode from "vscode";
import type { CCloudStatus, Connection, UserInfo } from "../connections";
import { ConnectedState } from "../connections";
import { AUTH_SCOPES, CCLOUD_CONNECTION_ID } from "../constants";
import { getExtensionContext } from "../context/extension";
import { observabilityContext } from "../context/observability";
import { ContextValues, setContextValue } from "../context/values";
import { ccloudAuthCallback, ccloudAuthSessionInvalidated, ccloudConnected } from "../emitters";
import { ExtensionContextNotSetError, logError } from "../errors";
import { getLaunchDarklyClient } from "../featureFlags/client";
import { Logger } from "../logging";
import { showInfoNotificationWithButtons } from "../notifications";
import { SecretStorageKeys } from "../storage/constants";
import type { CCloudSessionInfo } from "../storage/resourceManager";
import { getResourceManager } from "../storage/resourceManager";
import { getSecretStorage } from "../storage/utils";
import { logUsage, UserEvent } from "../telemetry/events";
import { sendTelemetryIdentifyEvent } from "../telemetry/telemetry";
import { DisposableCollection } from "../utils/disposables";
import {
  clearCurrentCCloudResources,
  createCCloudConnection,
  deleteCCloudConnection,
  getCCloudConnection,
  waitForConnectionToBeStable,
} from "./ccloudSession";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "./constants";
import { CCloudConnectionError } from "./errors";
import type { AuthCallbackEvent } from "./types";

/** Callback type for auth flow completion */
type AuthFlowCallback = (event: AuthCallbackEvent) => void;

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
 * Session persistence is handled via SecretStorage:
 * - CCloud session info (user id, username) is stored in SecretStorage for cross-workspace sync
 * - At extension activation, stored session info is used to rehydrate the auth session
 * - The sidecar connection state is the source of truth for whether the session is valid
 *
 * There are also some event listeners configured to handle changes in the auth state between the
 * extension instance and the sidecar, as well as between different workspaces:
 * - one for monitoring changes in the SecretStore, which is used to notify the extension when
 *   auth state changes in another workspace
 * - one for handling the URI handling event for OAuth callback
 * - one for handling the `ccloudAuthSessionInvalidated` event for session invalidation
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

  /**
   * Callback to notify when the auth flow completes. Set during browserAuthFlow() and
   * called from handleCCloudAuthCallback(). This enables cross-workspace auth completion
   * since the callback is stored on the singleton instance.
   */
  private _pendingAuthFlowCallback: AuthFlowCallback | null = null;

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
    // about for internal debugging/troubleshooting, we need to create a CCloudConnectionError with
    // `signInError()`. This also captures the last few lines of sidecar logs to send to Sentry
    // along with the error.
    // If we need to escape this flow without creating an AuthenticationSession, we still need to
    // throw an error but don't necessarily need to gather sidecar logs, so we can throw a
    // CCloudConnectionError directly if we don't want it to appear as an error notification.

    const signInUri: string | undefined = connection.metadata?.signInUri;
    if (!signInUri) {
      logger.error(
        "createSession() no sign-in URI found in connection metadata; this should not happen",
      );
      throw this.createAndLogConnectionError(
        "Failed to create new connection. Please try again.",
        connection,
      );
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
      throw new CCloudConnectionError("User cancelled the authentication flow.");
    }

    if (authCallback.resetPassword) {
      // user reset their password, so we need to notify them to reauthenticate
      logger.debug("createSession() user reset their password");
      void showInfoNotificationWithButtons(
        "Your password has been reset. Please sign in again to Confluent Cloud.",
        { [CCLOUD_SIGN_IN_BUTTON_LABEL]: async () => await this.createSession() },
      );
      // no sidecar logs needed here, just exit early
      throw new CCloudConnectionError("User reset their password.");
    }

    if (!authCallback.success) {
      // the user hit the "Authentication Failed" browser callback page, which should have more
      // details about the exact error (but those details aren't sent to the extension in the URI)
      const authFailedMsg = "Confluent Cloud authentication failed. See browser for details.";
      void vscode.window.showErrorMessage(authFailedMsg);
      logUsage(UserEvent.CCloudAuthentication, {
        status: "authentication failed",
      });
      throw this.createAndLogConnectionError(
        authFailedMsg,
        // no need to include the connection here since it likely has no useful info for this scenario
      );
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
      throw this.createAndLogConnectionError(
        "CCloud connection failed to become usable after authentication.",
        // no connection, so nothing to include here
      );
    }
    const ccloudStatus: CCloudStatus | undefined = authenticatedConnection.status.ccloud;
    if (!ccloudStatus) {
      throw this.createAndLogConnectionError(
        "Authenticated connection has no status information.",
        authenticatedConnection,
      );
    }
    const userInfo: UserInfo | undefined = ccloudStatus.user;
    if (!userInfo) {
      throw this.createAndLogConnectionError(
        "Authenticated connection has no CCloud user.",
        authenticatedConnection,
      );
    }

    // User signed in successfully so we send an identify event to Segment and LaunchDarkly
    sendTelemetryIdentifyEvent({
      eventName: UserEvent.CCloudAuthentication,
      userInfo,
      session: undefined,
    });

    const launchDarklyClient = await getLaunchDarklyClient();
    if (launchDarklyClient) {
      await launchDarklyClient.identify({ key: userInfo.id });
    }

    void vscode.window.showInformationMessage(
      `Successfully signed in to Confluent Cloud as ${ccloudStatus.user?.username}`,
    );
    logger.debug("successfully authenticated with Confluent Cloud");

    // Store the session info in SecretStorage for cross-workspace sync and rehydration
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudState(ccloudStatus.state);
    await resourceManager.setCCloudSession({
      userId: userInfo.id,
      username: userInfo.username,
    });

    const session = this.createAuthSession(userInfo);
    this._onDidChangeSessions.fire({
      added: [session],
      removed: [],
      changed: [],
    });
    await setContextValue(ContextValues.ccloudConnectionAvailable, true);
    ccloudConnected.fire(true);

    observabilityContext.ccloudAuthCompleted = true;
    observabilityContext.ccloudAuthExpiration = ccloudStatus.requiresAuthenticationAt;
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

    // Check if we have a usable sidecar connection
    let connection: Connection | null = await getCCloudConnection();

    if (
      connection &&
      connection.status.ccloud?.state &&
      [ConnectedState.NONE, ConnectedState.FAILED].includes(connection.status.ccloud.state)
    ) {
      // the connection is unusable, so the auth provider needs to act like there isn't actually a
      // connection and the user needs to sign in
      logger.debug("getSessions() found connection with unusable state", {
        state: connection.status.ccloud.state,
      });
      connection = null;
    }

    // Check stored session info for cross-workspace sync
    const resourceManager = getResourceManager();
    const storedSession: CCloudSessionInfo | null = await resourceManager.getCCloudSession();

    const connectionExists: boolean = !!connection;
    const storedSessionExists: boolean = !!storedSession;

    logger.debug("getSessions() state check", { connectionExists, storedSessionExists });

    // Update context value based on connection availability
    await setContextValue(ContextValues.ccloudConnectionAvailable, connectionExists);

    if (!connectionExists) {
      // No usable connection - clear any stale stored session
      if (storedSessionExists) {
        logger.debug("getSessions() clearing stale stored session");
        await resourceManager.setCCloudSession(null);
        await clearCurrentCCloudResources();
        ccloudConnected.fire(false);
      }
      logger.debug("getSessions() no connection found");
      return [];
    }

    // We have a connection - try to get user info from it
    const userInfo: UserInfo | undefined = connection!.status.ccloud?.user;
    if (!userInfo || !userInfo.id || !userInfo.username) {
      // Connection exists but has no valid user info - this is an error state
      logger.error("getSessions() connection exists but has no valid user info");
      this.createAndLogConnectionError(
        "CCloud connection exists but has no valid user info",
        connection ?? undefined,
      );
      return [];
    }

    // Update stored session if it differs from connection (cross-workspace sync)
    if (!storedSessionExists || storedSession!.userId !== userInfo.id) {
      logger.debug("getSessions() updating stored session from connection");
      await resourceManager.setCCloudSession({
        userId: userInfo.id,
        username: userInfo.username,
      });
      // Fire connected event for cross-workspace sync
      ccloudConnected.fire(true);
    }

    const session = this.createAuthSession(userInfo);
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

    // Get stored session info to include in the change event
    const resourceManager = getResourceManager();
    const storedSession: CCloudSessionInfo | null = await resourceManager.getCCloudSession();

    // make sure the sidecar says we have a connection first
    const existingConnection: Connection | null = await getCCloudConnection();
    if (!existingConnection) {
      if (storedSession) {
        logger.debug("removeSession() no sidecar connection, but we have a stored session");
        // Clear stored session and resources
        await this.clearSession(storedSession);
      }
      return;
    }

    logUsage(UserEvent.CCloudAuthentication, {
      status: "signed out",
    });

    // tell the sidecar to delete the connection and clear stored state
    await Promise.all([
      deleteCCloudConnection(),
      getSecretStorage().delete(SecretStorageKeys.CCLOUD_STATE),
    ]);

    await this.clearSession(storedSession);
    ccloudConnected.fire(false);
    observabilityContext.ccloudSignOutCount++;
  }

  /**
   * Clear the stored session and notify listeners.
   */
  private async clearSession(storedSession: CCloudSessionInfo | null): Promise<void> {
    logger.debug("clearSession()");

    const resourceManager = getResourceManager();
    await resourceManager.setCCloudSession(null);
    await setContextValue(ContextValues.ccloudConnectionAvailable, false);
    await clearCurrentCCloudResources();

    if (storedSession) {
      // Fire session change event with the removed session
      const session = this.createAuthSession({
        id: storedSession.userId,
        username: storedSession.username,
      });
      this._onDidChangeSessions.fire({
        added: [],
        removed: [session],
        changed: [],
      });
    }
  }

  /**
   * Set up event listeners for this provider.
   */
  setEventListeners(context: vscode.ExtensionContext): vscode.Disposable[] {
    // Watch for changes in the CCloud session secret that may occur from other workspaces/windows.
    // This is used to detect when a user signs in or out from another workspace.
    const secretsOnDidChangeSub: vscode.Disposable = context.secrets.onDidChange(
      async ({ key }: vscode.SecretStorageChangeEvent) => {
        if (key === SecretStorageKeys.CCLOUD_SESSION || key === SecretStorageKeys.CCLOUD_STATE) {
          logger.debug(`storage change detected for key: ${key}`);
          // Trigger getSessions to re-evaluate auth state
          // This will handle cross-workspace sync by reading from storage
          await this.handleSessionSecretChange();
        }
      },
    );

    // General listener for the URI handling event, which is used to resolve any pending auth flow
    const ccloudAuthCallbackSub: vscode.Disposable = ccloudAuthCallback.event(
      async (uri) => await this.handleCCloudAuthCallback(uri),
    );

    // if any other part of the extension notices that our current CCloud connection transitions from
    // SUCCESS to FAILED/NONE, we need to remove the session
    const ccloudAuthSessionInvalidatedSub: vscode.Disposable = ccloudAuthSessionInvalidated.event(
      async () => {
        logger.debug("ccloudAuthSessionInvalidated event fired");
        // don't delete the actual CCloud connection, just clear stored session
        // so we can continue to use the same sign_in_uri until the user explicitly signs out
        const storedSession = await getResourceManager().getCCloudSession();
        await this.clearSession(storedSession);
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
          this.waitForAuthCallback().then((authCallback): [AuthCallbackEvent, boolean] => [
            authCallback,
            false,
          ]),
          this.waitForCancellationRequest(token).then((): [AuthCallbackEvent, boolean] => [
            { success: false, resetPassword: false } as AuthCallbackEvent,
            true,
          ]),
        ]);
        if (cancelled) {
          this._pendingAuthFlowCallback = null;
          return;
        }
        // user completed the auth flow, so we need to resolve the promise with the callback
        // query params
        logger.debug("browserAuthFlow() user completed the auth flow", authCallback);
        return authCallback;
      },
    );
  }

  /**
   * Wait for the auth callback to be received (from handleCCloudAuthCallback).
   * This sets up a callback that will be invoked when the URI handler processes
   * the auth callback, whether from this workspace or another.
   */
  private waitForAuthCallback(): Promise<AuthCallbackEvent> {
    return new Promise<AuthCallbackEvent>((resolve) => {
      this._pendingAuthFlowCallback = (event: AuthCallbackEvent) => {
        logger.debug("waitForAuthCallback() received callback", event);
        this._pendingAuthFlowCallback = null;
        resolve(event);
      };
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
   * When the stored session secret changes, update the internal session state and notify listeners.
   * This is useful for when the session is added or removed from another workspace and this instance
   * of the extension (and auth provider) needs to be updated to match.
   */
  private async handleSessionSecretChange() {
    logger.debug("handleSessionSecretChange()");

    // Get fresh session state by calling getSessions which reads from storage and sidecar
    const sessions = await this.getSessions();
    const hasSession = sessions.length > 0;

    logger.debug("handleSessionSecretChange() result", { hasSession });

    // getSessions already handles firing appropriate events and updating state
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
    logger.debug("handled authCallback URI", callbackEvent);

    // Notify any pending auth flow via the callback
    if (this._pendingAuthFlowCallback) {
      this._pendingAuthFlowCallback(callbackEvent);
    }

    if (callbackEvent.resetPassword) {
      // clear any existing auth session so the user can sign in again with their new password
      await Promise.all([
        deleteCCloudConnection(),
        getSecretStorage().delete(SecretStorageKeys.CCLOUD_STATE),
      ]);
      const storedSession = await getResourceManager().getCCloudSession();
      await this.clearSession(storedSession);
      ccloudAuthSessionInvalidated.fire();
      void showInfoNotificationWithButtons(
        "Your password has been reset. Please sign in again to Confluent Cloud.",
        { [CCLOUD_SIGN_IN_BUTTON_LABEL]: async () => await this.createSession() },
      );
    }
  }

  /**
   * Create a {@link CCloudConnectionError} and gather sidecar logs to send to Sentry, for either:
   * - when a sign-in error occurs during {@linkcode ConfluentCloudAuthProvider.createSession `createSession()`}
   * - converting an existing {@link Connection} to an auth session fails in {@linkcode ConfluentCloudAuthProvider.getSessions `getSessions()`}
   * @param message The error message to include in the {@link CCloudConnectionError}.
   * @param connection Optional {@link Connection} to include in the error context.
   * @returns A {@link CCloudConnectionError} for the caller to throw and escape `createSession()`
   */
  createAndLogConnectionError(message: string, connection?: Connection): CCloudConnectionError {
    const error = new CCloudConnectionError(message);
    // we're including the connection here because it's missing information that we would otherwise
    // expect to have after a successful sign-in, so we need a closer look at what the rest of the
    // state looks like for debugging purposes
    logError(error, message, { extra: { connection } });
    return error;
  }

  /**
   * Create a VS Code AuthenticationSession from user info.
   * @param userInfo The CCloud user info (id and username required)
   */
  createAuthSession(userInfo: { id: string; username: string }): vscode.AuthenticationSession {
    // NOTE: accessToken is just the connection ID; the sidecar manages the actual access token.
    // we don't want to store the token status or anything that might change, because we may end up
    // seeing "Grant ____ permissions" in the Accounts action, which would be confusing to the user
    return {
      id: CCLOUD_CONNECTION_ID,
      accessToken: CCLOUD_CONNECTION_ID,
      account: {
        id: userInfo.id,
        label: userInfo.username,
      },
      scopes: AUTH_SCOPES,
    };
  }
}
