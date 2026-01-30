/**
 * OAuth2 Authentication Service for Confluent Cloud.
 *
 * Coordinates the OAuth2 PKCE flow, managing callback handling from both
 * the VS Code URI handler and local HTTP server, token exchange, and
 * session management.
 */

import * as vscode from "vscode";
import type { OAuthCallbackResult, OAuthConfig, OAuthFlowState, OAuthTokens } from "./types";
import { CCloudEnvironment, getOAuthConfig, OAUTH_CONSTANTS } from "./config";
import { validateState } from "./pkce";
import { PKCEStateManager } from "./pkceStateManager";
import { TokenManager } from "./tokenManager";
import { performFullTokenExchange, performTokenRefresh, TokenExchangeError } from "./tokenExchange";
import { OAuthCallbackServer } from "./callbackServer";

/**
 * Authentication state for the service.
 */
export enum AuthState {
  /** No authentication in progress or completed. */
  UNAUTHENTICATED = "unauthenticated",
  /** Authentication flow in progress. */
  AUTHENTICATING = "authenticating",
  /** Successfully authenticated with valid tokens. */
  AUTHENTICATED = "authenticated",
  /** Authentication failed. */
  FAILED = "failed",
  /** Session expired (refresh token expired). */
  EXPIRED = "expired",
}

/**
 * Options for starting authentication.
 */
export interface AuthOptions {
  /** CCloud environment to authenticate against. */
  environment?: CCloudEnvironment;
  /** Organization ID to select. */
  organizationId?: string;
  /** Whether to use the local callback server (false uses VS Code URI). */
  useLocalServer?: boolean;
}

/**
 * Result of an authentication attempt.
 */
export interface AuthResult {
  /** Whether authentication was successful. */
  success: boolean;
  /** Error message if failed. */
  error?: string;
  /** The authenticated tokens (if successful). */
  tokens?: OAuthTokens;
}

/**
 * OAuth2 Authentication Service.
 *
 * Singleton service that manages the complete OAuth2 PKCE authentication
 * flow for Confluent Cloud, including:
 * - Starting the OAuth flow and opening the browser
 * - Handling callbacks from both URI handler and HTTP server
 * - Exchanging authorization codes for tokens
 * - Managing token refresh and session expiration
 */
export class AuthService implements vscode.Disposable {
  private static instance: AuthService | null = null;
  private state: AuthState = AuthState.UNAUTHENTICATED;
  private pendingFlow: OAuthFlowState | null = null;
  private flowTimeout: ReturnType<typeof setTimeout> | null = null;
  private flowResolver: ((result: AuthResult) => void) | null = null;
  private config: OAuthConfig | null = null;
  private environment: CCloudEnvironment = CCloudEnvironment.PRODUCTION;

  private tokenManager: TokenManager;
  private pkceStateManager: PKCEStateManager;
  private callbackServer: OAuthCallbackServer | null = null;

  private readonly disposables: vscode.Disposable[] = [];

  // Event emitters
  private readonly _onStateChanged = new vscode.EventEmitter<AuthState>();
  private readonly _onAuthenticated = new vscode.EventEmitter<OAuthTokens>();
  private readonly _onAuthenticationFailed = new vscode.EventEmitter<string>();
  private readonly _onSessionExpired = new vscode.EventEmitter<void>();

  /** Emitted when the authentication state changes. */
  readonly onStateChanged = this._onStateChanged.event;
  /** Emitted when authentication succeeds. */
  readonly onAuthenticated = this._onAuthenticated.event;
  /** Emitted when authentication fails. */
  readonly onAuthenticationFailed = this._onAuthenticationFailed.event;
  /** Emitted when the session expires. */
  readonly onSessionExpired = this._onSessionExpired.event;

  private constructor() {
    this.tokenManager = TokenManager.getInstance();
    this.pkceStateManager = PKCEStateManager.getInstance();

    this.disposables.push(
      this._onStateChanged,
      this._onAuthenticated,
      this._onAuthenticationFailed,
      this._onSessionExpired,
    );

    // Listen for token events
    this.disposables.push(
      this.tokenManager.onSessionExpired(() => {
        this.setState(AuthState.EXPIRED);
        this._onSessionExpired.fire();
      }),
    );
  }

  /**
   * Gets the singleton instance of AuthService.
   */
  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Resets the singleton instance (for testing).
   */
  static resetInstance(): void {
    if (AuthService.instance) {
      AuthService.instance.dispose();
      AuthService.instance = null;
    }
  }

  /**
   * Initializes the auth service with VS Code context.
   * @param context The extension context.
   */
  async initialize(context: vscode.ExtensionContext): Promise<void> {
    // Initialize token manager and PKCE state manager
    await Promise.all([
      this.tokenManager.initialize(context.secrets),
      this.pkceStateManager.initialize(context.secrets),
    ]);

    // Note: We don't register a URI handler here because the extension already has one
    // (UriEventHandler in src/uriHandler.ts) that fires the ccloudAuthCallback event.
    // The ConfluentCloudAuthProvider handles those events and calls handleCCloudAuthCallback.

    // Check if we have existing tokens
    const existingTokens = await this.tokenManager.getTokens();
    if (existingTokens) {
      const isValid = await this.tokenManager.isSessionValid();
      if (isValid) {
        this.setState(AuthState.AUTHENTICATED);
      } else {
        this.setState(AuthState.EXPIRED);
      }
    }
  }

  /**
   * Gets or creates a sign-in URI for CCloud authentication.
   *
   * This method generates PKCE parameters and stores them securely so that
   * the token exchange can complete even if VS Code restarts during the
   * browser-based authentication flow.
   *
   * Also starts the local callback server to receive the OAuth callback from CCloud.
   *
   * @param environment The CCloud environment to authenticate against.
   * @param organizationId Optional organization ID to pre-select.
   * @param forceNew Force creation of new PKCE state even if existing state is valid.
   * @returns The sign-in URI to open in the browser.
   */
  async getOrCreateSignInUri(
    environment: CCloudEnvironment = CCloudEnvironment.PRODUCTION,
    organizationId?: string,
    forceNew = false,
  ): Promise<string> {
    // Ensure the callback server is running to receive the OAuth callback
    await this.ensureCallbackServerRunning();

    return this.pkceStateManager.getOrCreateSignInUri(environment, organizationId, forceNew);
  }

  /**
   * Ensures the local OAuth callback server is running.
   * The server receives callbacks from CCloud on port 26636.
   */
  private async ensureCallbackServerRunning(): Promise<void> {
    if (this.callbackServer?.isRunning()) {
      return;
    }

    try {
      this.callbackServer = new OAuthCallbackServer();
      await this.callbackServer.start();
      this.callbackServer.onCallback((result) => this.handleCallback(result));
      this.disposables.push(this.callbackServer);
    } catch (error) {
      // Log but don't throw - the callback server might already be running from another source
      // or we might be in a web environment where it's not needed
      console.warn("Failed to start OAuth callback server:", error);
    }
  }

  /**
   * Starts the OAuth authentication flow.
   * @param options Authentication options.
   * @returns A promise that resolves with the authentication result.
   */
  async authenticate(options: AuthOptions = {}): Promise<AuthResult> {
    if (this.state === AuthState.AUTHENTICATING) {
      return {
        success: false,
        error: "Authentication already in progress",
      };
    }

    this.environment = options.environment ?? CCloudEnvironment.PRODUCTION;

    // Use local server by default since CCloud doesn't support VS Code URI yet
    this.config = getOAuthConfig(this.environment);

    // Get or create PKCE state and ensure callback server is running
    const authUrl = await this.getOrCreateSignInUri(this.environment, options.organizationId);

    // Get the PKCE params from storage for the pending flow
    const pkceState = await this.pkceStateManager.getState();
    if (!pkceState) {
      return {
        success: false,
        error: "Failed to create PKCE state for authentication",
      };
    }

    // Create flow state using the stored PKCE params
    this.pendingFlow = {
      pkce: pkceState.pkce,
      initiatedAt: new Date(),
      completed: false,
      organizationId: options.organizationId,
    };

    this.setState(AuthState.AUTHENTICATING);

    // Create a promise that will be resolved when the flow completes
    const result = await new Promise<AuthResult>((resolve) => {
      this.flowResolver = resolve;

      // Set flow timeout
      this.flowTimeout = setTimeout(() => {
        this.cancelFlow("Authentication timed out");
      }, OAUTH_CONSTANTS.FLOW_TIMEOUT_MS);

      // Open browser
      vscode.env.openExternal(vscode.Uri.parse(authUrl)).then(
        (opened) => {
          if (!opened) {
            this.cancelFlow("Failed to open browser for authentication");
          }
        },
        (error) => {
          this.cancelFlow(`Failed to open browser: ${error}`);
        },
      );
    });

    // Clean up
    this.cleanupFlow();

    return result;
  }

  /**
   * Handles an OAuth callback from either the URI handler or HTTP server.
   * @param callbackResult The callback result to process.
   */
  async handleCallback(callbackResult: OAuthCallbackResult): Promise<void> {
    // Get PKCE state - either from pending flow or from storage
    // (storage is used if VS Code was restarted during auth flow)
    let codeVerifier: string | undefined;
    let expectedState: string | undefined;
    let organizationId: string | undefined;

    if (this.pendingFlow && !this.pendingFlow.completed) {
      codeVerifier = this.pendingFlow.pkce.codeVerifier;
      expectedState = this.pendingFlow.pkce.state;
      organizationId = this.pendingFlow.organizationId;
    } else {
      // Try to get PKCE state from storage (VS Code may have restarted)
      const storedState = await this.pkceStateManager.getState();
      if (storedState) {
        codeVerifier = storedState.pkce.codeVerifier;
        expectedState = storedState.pkce.state;
        organizationId = storedState.organizationId;

        // Reconstruct pending flow for completeFlow() to work
        this.pendingFlow = {
          pkce: storedState.pkce,
          initiatedAt: storedState.createdAt,
          completed: false,
          organizationId,
        };

        // Also set the config from stored environment
        this.config = getOAuthConfig(storedState.environment);
        this.environment = storedState.environment;
      }
    }

    if (!codeVerifier || !expectedState) {
      // No valid PKCE state found
      return;
    }

    if (this.pendingFlow?.completed) {
      return;
    }

    // Validate state
    if (callbackResult.state) {
      if (!validateState(callbackResult.state, expectedState)) {
        this.completeFlow({
          success: false,
          error: "State mismatch - possible CSRF attack",
        });
        // Clear stored PKCE state on validation failure
        await this.pkceStateManager.clearState();
        return;
      }
    }

    if (!callbackResult.success) {
      const errorMessage =
        callbackResult.error?.errorDescription ?? callbackResult.error?.error ?? "Unknown error";
      this.completeFlow({
        success: false,
        error: errorMessage,
      });
      // Clear stored PKCE state on failure
      await this.pkceStateManager.clearState();
      return;
    }

    if (!callbackResult.code) {
      this.completeFlow({
        success: false,
        error: "No authorization code received",
      });
      // Clear stored PKCE state on failure
      await this.pkceStateManager.clearState();
      return;
    }

    // Exchange code for tokens
    try {
      const tokens = await performFullTokenExchange(
        this.config!,
        callbackResult.code,
        codeVerifier,
        { organizationId },
      );

      // Store tokens and clear PKCE state (no longer needed)
      await Promise.all([
        this.tokenManager.storeTokens(tokens),
        this.pkceStateManager.clearState(),
      ]);

      this.completeFlow({
        success: true,
        tokens,
      });
    } catch (error) {
      const message =
        error instanceof TokenExchangeError
          ? error.oauthError?.errorDescription ?? error.message
          : String(error);

      this.completeFlow({
        success: false,
        error: message,
      });
      // Clear stored PKCE state on failure
      await this.pkceStateManager.clearState();
    }
  }

  /**
   * Refreshes the current authentication tokens.
   * @returns A promise that resolves with the refresh result.
   */
  async refreshTokens(): Promise<AuthResult> {
    const currentTokens = await this.tokenManager.getTokens();
    if (!currentTokens) {
      return {
        success: false,
        error: "No tokens to refresh",
      };
    }

    const isValid = await this.tokenManager.isSessionValid();
    if (!isValid) {
      this.setState(AuthState.EXPIRED);
      return {
        success: false,
        error: "Session expired - re-authentication required",
      };
    }

    if (this.tokenManager.hasExceededMaxRefreshAttempts()) {
      this.setState(AuthState.EXPIRED);
      return {
        success: false,
        error: "Maximum refresh attempts exceeded",
      };
    }

    try {
      this.tokenManager.incrementRefreshAttempts();

      const config = getOAuthConfig(this.environment);
      const newTokens = await performTokenRefresh(config, currentTokens);

      await this.tokenManager.storeTokens(newTokens);
      this.setState(AuthState.AUTHENTICATED);

      return {
        success: true,
        tokens: newTokens,
      };
    } catch (error) {
      const message =
        error instanceof TokenExchangeError
          ? error.oauthError?.errorDescription ?? error.message
          : String(error);

      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Signs out by clearing all tokens and PKCE state.
   */
  async signOut(): Promise<void> {
    await Promise.all([this.tokenManager.clearTokens(), this.pkceStateManager.clearState()]);
    this.setState(AuthState.UNAUTHENTICATED);
  }

  /**
   * Gets the current authentication state.
   */
  getState(): AuthState {
    return this.state;
  }

  /**
   * Gets the current tokens if authenticated.
   */
  async getTokens(): Promise<OAuthTokens | null> {
    return this.tokenManager.getTokens();
  }

  /**
   * Checks if the user is currently authenticated.
   */
  isAuthenticated(): boolean {
    return this.state === AuthState.AUTHENTICATED;
  }

  /**
   * Gets the configured environment.
   */
  getEnvironment(): CCloudEnvironment {
    return this.environment;
  }

  /**
   * Disposes of all resources.
   */
  dispose(): void {
    // Cancel any pending flow first
    if (this.pendingFlow && !this.pendingFlow.completed) {
      this.cancelFlow("Service disposed");
    }

    this.cleanupFlow();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.disposables.length = 0;
    AuthService.instance = null;
  }

  /**
   * Sets the authentication state and fires the event.
   */
  private setState(newState: AuthState): void {
    if (this.state !== newState) {
      this.state = newState;
      this._onStateChanged.fire(newState);
    }
  }

  /**
   * Completes the pending flow with a result.
   */
  private completeFlow(result: AuthResult): void {
    if (!this.pendingFlow || this.pendingFlow.completed) {
      return;
    }

    this.pendingFlow.completed = true;

    if (result.success) {
      this.setState(AuthState.AUTHENTICATED);
      if (result.tokens) {
        this._onAuthenticated.fire(result.tokens);
      }
    } else {
      this.setState(AuthState.FAILED);
      this._onAuthenticationFailed.fire(result.error ?? "Unknown error");
    }

    if (this.flowResolver) {
      this.flowResolver(result);
      this.flowResolver = null;
    }
  }

  /**
   * Cancels the pending flow with an error.
   */
  private cancelFlow(error: string): void {
    this.completeFlow({
      success: false,
      error,
    });
  }

  /**
   * Cleans up flow resources.
   * Note: Does not stop the callback server - it stays running to handle future callbacks.
   */
  private cleanupFlow(): void {
    if (this.flowTimeout) {
      clearTimeout(this.flowTimeout);
      this.flowTimeout = null;
    }

    // Don't stop the callback server - it needs to stay running to receive callbacks
    // even after the flow times out or is cancelled, since the user might still complete
    // the auth in the browser

    this.pendingFlow = null;
    this.flowResolver = null;
  }
}
