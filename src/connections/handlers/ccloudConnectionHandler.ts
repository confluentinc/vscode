/**
 * Connection handler for Confluent Cloud (CCloud) connections.
 *
 * Handles OAuth-based authentication with Confluent Cloud, including
 * session management, token refresh, and organization/resource discovery.
 */

import type { Disposable } from "vscode";
import { AuthService, type AuthResult } from "../../authn/oauth2/authService";
import { TokenManager } from "../../authn/oauth2/tokenManager";
import { ContextValues, setContextValue } from "../../context/values";
import { ccloudConnected } from "../../emitters";
import { Logger } from "../../logging";
import type { ConnectionSpec } from "../spec";
import {
  ConnectedState,
  type CCloudStatus,
  type CCloudUser,
  type ConnectionStatus,
} from "../types";
import { ConnectionHandler, type ConnectionTestResult } from "./connectionHandler";

/** Maximum session lifetime in seconds (8 hours). */
const MAX_SESSION_LIFETIME_SECONDS = 28800;

/** Result of OAuth authentication flow. */
interface OAuthFlowResult {
  success: boolean;
  user?: CCloudUser;
  error?: string;
}

/**
 * Handles connections to Confluent Cloud via OAuth authentication.
 *
 * CCloud connections:
 * - Use OAuth2 PKCE flow for authentication
 * - Have time-limited sessions (8 hours maximum)
 * - Track organization and user information
 * - Support automatic token refresh
 */
export class CCloudConnectionHandler extends ConnectionHandler {
  /** Flag indicating if connection is currently active. */
  private _connected = false;

  /** CCloud-specific status including user info. */
  private _ccloudStatus: CCloudStatus = { state: ConnectedState.NONE };

  /** Number of refresh attempts made. */
  private _refreshAttempts = 0;

  /** Timestamp when authentication is required. */
  private _requiresAuthenticationAt?: Date;

  /** Subscription to AuthService events. */
  private _authServiceSubscriptions: Disposable[] = [];

  /**
   * Promise that resolves when the handler has finished initializing from
   * existing auth state. Callers should await this before checking status
   * if they need accurate state immediately after construction.
   */
  readonly initialized: Promise<void>;

  /**
   * Creates a new CCloud connection handler.
   * @param spec The connection specification with optional ccloud config.
   */
  constructor(spec: ConnectionSpec) {
    super(spec);
    this.subscribeToAuthServiceEvents();
    // Initialize from existing auth state (handles extension restart with valid tokens)
    // Store the promise so callers can await it if needed
    this.initialized = this.initializeFromExistingAuth();
  }

  /**
   * Initializes the handler from existing auth state if available.
   * This handles the case where the extension restarts with valid tokens stored.
   * Since onAuthenticated only fires when auth *completes*, we need to check
   * for existing auth state at construction time.
   */
  private async initializeFromExistingAuth(): Promise<void> {
    const logger = new Logger("ccloudConnectionHandler");
    const authService = AuthService.getInstance();

    // Only initialize if AuthService reports authenticated state
    const isAuthenticated = authService.isAuthenticated();
    if (!isAuthenticated) {
      logger.debug("initializeFromExistingAuth: AuthService not authenticated, skipping", {
        authState: authService.getState(),
      });
      return;
    }

    // Get user info from tokens
    const user = await this.getUserFromTokens();
    if (!user) {
      logger.debug("initializeFromExistingAuth: Failed to get user from tokens");
      return;
    }

    logger.debug("initializeFromExistingAuth: Setting status to SUCCESS", {
      username: user.username,
    });

    // Initialize status from existing tokens
    this._ccloudStatus = {
      state: ConnectedState.SUCCESS,
      user,
    };
    this._requiresAuthenticationAt = await this.getSessionExpiryFromTokens();
    this._refreshAttempts = 0;
    this._connected = true;
    this.updateStatus({ ccloud: this._ccloudStatus });

    // Set context value and fire connected event so the UI updates
    // This is necessary because onAuthenticated only fires when auth *completes*,
    // not when we rehydrate from existing tokens
    await setContextValue(ContextValues.ccloudConnectionAvailable, true);
    ccloudConnected.fire(true);
  }

  /**
   * Subscribes to AuthService events to update connection status
   * when authentication state changes externally (e.g., from browser callback).
   */
  private subscribeToAuthServiceEvents(): void {
    const authService = AuthService.getInstance();

    // When authentication completes successfully, update our status
    this._authServiceSubscriptions.push(
      authService.onAuthenticated(async () => {
        // Only update if we're not already connected (avoid duplicate updates)
        if (this._ccloudStatus.state !== ConnectedState.SUCCESS) {
          const user = await this.getUserFromTokens();
          this._ccloudStatus = {
            state: ConnectedState.SUCCESS,
            user: user ?? { id: "unknown", username: "authenticated-user" },
          };
          this._requiresAuthenticationAt = await this.getSessionExpiryFromTokens();
          this._refreshAttempts = 0;
          this._connected = true;
          this.updateStatus({ ccloud: this._ccloudStatus });

          // Set context value and fire connected event so the UI updates immediately.
          // Without this, the Resources view shows "(No connection)" until createSession()
          // finishes waiting for waitForConnectionToBeStable().
          await setContextValue(ContextValues.ccloudConnectionAvailable, true);
          ccloudConnected.fire(true);
        }
      }),
    );

    // When authentication fails, update our status
    this._authServiceSubscriptions.push(
      authService.onAuthenticationFailed((error) => {
        // Only update if we're not already in a failed state
        if (
          this._ccloudStatus.state !== ConnectedState.FAILED &&
          this._ccloudStatus.state !== ConnectedState.EXPIRED
        ) {
          this._ccloudStatus = {
            state: ConnectedState.FAILED,
            errors: [{ message: error }],
          };
          this._connected = false;
          this.updateStatus({ ccloud: this._ccloudStatus });
        }
      }),
    );

    // When session expires, update our status
    this._authServiceSubscriptions.push(
      authService.onSessionExpired(() => {
        this._ccloudStatus = {
          state: ConnectedState.EXPIRED,
          user: this._ccloudStatus.user,
          errors: [{ message: "Session expired" }],
        };
        this._connected = false;
        this.updateStatus({ ccloud: this._ccloudStatus });
      }),
    );
  }

  /**
   * Initiates OAuth authentication with Confluent Cloud.
   * This will trigger the browser-based OAuth flow.
   */
  async connect(): Promise<void> {
    // Update status to attempting
    this._ccloudStatus = { state: ConnectedState.ATTEMPTING };
    this.updateStatus({ ccloud: this._ccloudStatus });

    try {
      const authResult = await this.performOAuthFlow();

      if (authResult.success) {
        // Get user info from tokens if available
        const user = await this.getUserFromTokens();

        this._ccloudStatus = {
          state: ConnectedState.SUCCESS,
          user: user ?? authResult.user,
        };
        this._requiresAuthenticationAt = await this.getSessionExpiryFromTokens();
        this._refreshAttempts = 0;
        this._connected = true;
      } else {
        this._ccloudStatus = {
          state: ConnectedState.FAILED,
          errors: authResult.error ? [{ message: authResult.error }] : undefined,
        };
        this._connected = false;
      }

      this.updateStatus({ ccloud: this._ccloudStatus });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._ccloudStatus = {
        state: ConnectedState.FAILED,
        errors: [{ message: `Authentication failed: ${message}` }],
      };
      this._connected = false;
      this.updateStatus({ ccloud: this._ccloudStatus });
    }
  }

  /**
   * Disconnects from Confluent Cloud and clears session.
   */
  async disconnect(): Promise<void> {
    // Sign out from AuthService to clear tokens
    try {
      const authService = AuthService.getInstance();
      await authService.signOut();
    } catch {
      // Continue with disconnect even if signOut fails
    }

    this._connected = false;
    this._ccloudStatus = { state: ConnectedState.NONE };
    this._requiresAuthenticationAt = undefined;
    this._refreshAttempts = 0;
    this.updateStatus({ ccloud: this._ccloudStatus });
  }

  /**
   * Tests CCloud connectivity without establishing a full session.
   * @returns The result of the connection test.
   */
  async testConnection(): Promise<ConnectionTestResult> {
    // For CCloud, testing means checking if we can authenticate
    // This is a lighter-weight check than full connect()
    try {
      const result = await this.validateCCloudConfig();
      return {
        success: result.success,
        error: result.error,
        status: {
          ccloud: {
            state: result.success ? ConnectedState.SUCCESS : ConnectedState.FAILED,
            errors: result.error ? [{ message: result.error }] : undefined,
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Connection test failed: ${message}`,
        status: {
          ccloud: {
            state: ConnectedState.FAILED,
            errors: [{ message }],
          },
        },
      };
    }
  }

  /**
   * Gets the current detailed status of the CCloud connection.
   * @returns The current connection status.
   */
  async getStatus(): Promise<ConnectionStatus> {
    return { ccloud: this._ccloudStatus };
  }

  /**
   * Refreshes OAuth tokens if they are expired or about to expire.
   * @returns true if tokens were refreshed, false otherwise.
   */
  async refreshCredentials(): Promise<boolean> {
    const tokenManager = TokenManager.getInstance();

    // Check if we've exceeded max refresh attempts
    if (tokenManager.hasExceededMaxRefreshAttempts()) {
      this._ccloudStatus = {
        state: ConnectedState.EXPIRED,
        user: this._ccloudStatus.user,
        errors: [{ message: "Maximum refresh attempts exceeded" }],
      };
      this._connected = false;
      this.updateStatus({ ccloud: this._ccloudStatus });
      return false;
    }

    // Check if refresh is needed
    if (!this.isTokenExpiringSoon()) {
      return false;
    }

    try {
      const authService = AuthService.getInstance();
      const result = await authService.refreshTokens();

      if (result.success) {
        this._refreshAttempts++;
        this._requiresAuthenticationAt = await this.getSessionExpiryFromTokens();
        return true;
      } else {
        // If refresh fails, check if session has expired
        const isValid = await tokenManager.isSessionValid();
        if (!isValid) {
          this._ccloudStatus = {
            state: ConnectedState.EXPIRED,
            user: this._ccloudStatus.user,
            errors: [{ message: result.error ?? "Session expired" }],
          };
          this._connected = false;
          this.updateStatus({ ccloud: this._ccloudStatus });
        }
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._ccloudStatus = {
        ...this._ccloudStatus,
        errors: [{ message: `Token refresh failed: ${message}` }],
      };
      this.updateStatus({ ccloud: this._ccloudStatus });
      return false;
    }
  }

  /**
   * Checks if the connection is currently usable.
   * @returns true if authenticated and session is valid.
   */
  isConnected(): boolean {
    return this._connected && this._ccloudStatus.state === ConnectedState.SUCCESS;
  }

  /**
   * Gets the overall connected state.
   * @returns The current connected state.
   */
  getOverallState(): ConnectedState {
    return this._ccloudStatus.state;
  }

  /**
   * Gets the authenticated user information.
   * @returns The user info if authenticated, undefined otherwise.
   */
  getUser(): CCloudUser | undefined {
    return this._ccloudStatus.user;
  }

  /**
   * Gets the timestamp when re-authentication is required.
   * @returns The expiry date or undefined if not authenticated.
   */
  getSessionExpiry(): Date | undefined {
    return this._requiresAuthenticationAt;
  }

  /**
   * Checks if the session has expired.
   * @returns true if session has expired.
   */
  isSessionExpired(): boolean {
    if (!this._requiresAuthenticationAt) {
      return false;
    }
    return new Date() >= this._requiresAuthenticationAt;
  }

  /**
   * Performs the OAuth2 PKCE authentication flow.
   * Uses the AuthService to handle the complete OAuth flow.
   */
  private async performOAuthFlow(): Promise<OAuthFlowResult> {
    // First validate the configuration
    const validationResult = await this.validateCCloudConfig();
    if (!validationResult.success) {
      return { success: false, error: validationResult.error };
    }

    // Get the AuthService and initiate authentication
    const authService = AuthService.getInstance();

    // Check if we're already authenticated
    if (authService.isAuthenticated()) {
      const user = await this.getUserFromTokens();
      return {
        success: true,
        user: user ?? { id: "unknown", username: "authenticated-user" },
      };
    }

    // Start the OAuth flow
    const result: AuthResult = await authService.authenticate({
      organizationId: this._spec.ccloudConfig?.organizationId,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Get user info from the authenticated session
    const user = await this.getUserFromTokens();
    return {
      success: true,
      user: user ?? { id: "unknown", username: "authenticated-user" },
    };
  }

  /**
   * Validates the CCloud connection configuration.
   */
  private async validateCCloudConfig(): Promise<{ success: boolean; error?: string }> {
    // Validate that this is a CCloud connection
    if (this._spec.type !== "CCLOUD") {
      return { success: false, error: "Invalid connection type for CCloud handler" };
    }

    // TODO: Additional validation in Phase 2:
    // - Validate organization ID if provided
    // - Check network connectivity to CCloud endpoints

    return { success: true };
  }

  /**
   * Calculates when the session will expire.
   * Sessions have a maximum lifetime of 8 hours.
   */
  private calculateSessionExpiry(): Date {
    const expiry = new Date();
    expiry.setSeconds(expiry.getSeconds() + MAX_SESSION_LIFETIME_SECONDS);
    return expiry;
  }

  /**
   * Checks if tokens are about to expire and need refresh.
   * Tokens are considered "expiring soon" if less than 5 minutes remain.
   */
  private isTokenExpiringSoon(): boolean {
    if (!this._requiresAuthenticationAt) {
      return false;
    }
    const fiveMinutesFromNow = new Date();
    fiveMinutesFromNow.setMinutes(fiveMinutesFromNow.getMinutes() + 5);
    return this._requiresAuthenticationAt <= fiveMinutesFromNow;
  }

  /**
   * Gets user information from the stored tokens.
   * Uses the user info from the control plane token exchange response,
   * which contains the correct CCloud user ID (e.g., u-abc123).
   */
  private async getUserFromTokens(): Promise<CCloudUser | undefined> {
    const tokenManager = TokenManager.getInstance();
    const tokens = await tokenManager.getTokens();

    if (!tokens) {
      return undefined;
    }

    // Prefer user info from control plane token exchange (has correct resource_id)
    if (tokens.user) {
      return {
        id: tokens.user.id,
        username: tokens.user.email,
        firstName: tokens.user.firstName,
        lastName: tokens.user.lastName,
        socialConnection: tokens.user.socialConnection,
        authType: tokens.user.authType,
      };
    }

    // Fallback to decoding ID token if user info not stored (legacy tokens)
    if (!tokens.idToken) {
      return undefined;
    }

    try {
      // Decode the JWT ID token to get user claims
      const parts = tokens.idToken.split(".");
      if (parts.length !== 3) {
        return undefined;
      }

      // Decode the payload (middle part)
      const payload = JSON.parse(atob(parts[1]));

      return {
        id: payload.sub ?? payload.user_id ?? "unknown",
        username: payload.email ?? payload.preferred_username ?? "unknown",
        firstName: payload.given_name,
        lastName: payload.family_name,
        socialConnection: payload.social_connection,
        authType: payload.auth_type,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Gets the session expiry time from the TokenManager.
   * Returns the refresh token expiry as the session end time.
   */
  private async getSessionExpiryFromTokens(): Promise<Date> {
    const tokenManager = TokenManager.getInstance();
    const status = await tokenManager.getTokenStatus();

    // Use refresh token expiry as the session expiry
    if (status.refreshToken.expiresAt) {
      return status.refreshToken.expiresAt;
    }

    // Fallback to calculated expiry
    return this.calculateSessionExpiry();
  }

  /**
   * Disposes of the handler and cleans up resources.
   */
  dispose(): void {
    // Clean up AuthService subscriptions
    for (const subscription of this._authServiceSubscriptions) {
      subscription.dispose();
    }
    this._authServiceSubscriptions = [];

    // Clear session state before disposing
    this._connected = false;
    this._ccloudStatus = { state: ConnectedState.NONE };
    this._requiresAuthenticationAt = undefined;
    this._refreshAttempts = 0;
    super.dispose();
  }
}
