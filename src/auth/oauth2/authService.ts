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
import { buildAuthorizationUrl, generatePKCEParams, validateState } from "./pkce";
import { TokenManager } from "./tokenManager";
import { performFullTokenExchange, performTokenRefresh, TokenExchangeError } from "./tokenExchange";
import { OAuthCallbackServer } from "./callbackServer";
import { OAuthUriHandler } from "./uriHandler";

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
  private callbackServer: OAuthCallbackServer | null = null;
  private uriHandler: OAuthUriHandler;

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
    this.uriHandler = new OAuthUriHandler();

    this.disposables.push(
      this._onStateChanged,
      this._onAuthenticated,
      this._onAuthenticationFailed,
      this._onSessionExpired,
      this.uriHandler,
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
    // Initialize token manager
    await this.tokenManager.initialize(context.secrets);

    // Register URI handler
    this.uriHandler.activate(context);
    this.uriHandler.onCallback((result) => this.handleCallback(result));

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
    const useLocalServer = options.useLocalServer ?? false;

    this.config = getOAuthConfig(this.environment, !useLocalServer);

    // Generate PKCE parameters
    const pkce = generatePKCEParams();

    // Create flow state
    this.pendingFlow = {
      pkce,
      initiatedAt: new Date(),
      completed: false,
      organizationId: options.organizationId,
    };

    // Set up callback handlers
    if (useLocalServer) {
      try {
        this.callbackServer = new OAuthCallbackServer();
        await this.callbackServer.start();
        this.callbackServer.onCallback((result) => this.handleCallback(result));
        this.disposables.push(this.callbackServer);
      } catch (error) {
        return {
          success: false,
          error: `Failed to start callback server: ${error}`,
        };
      }
    }

    // Build and open authorization URL
    const authUrl = buildAuthorizationUrl(this.config, pkce);

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
    if (!this.pendingFlow || this.pendingFlow.completed) {
      return;
    }

    // Validate state
    if (callbackResult.state) {
      if (!validateState(callbackResult.state, this.pendingFlow.pkce.state)) {
        this.completeFlow({
          success: false,
          error: "State mismatch - possible CSRF attack",
        });
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
      return;
    }

    if (!callbackResult.code) {
      this.completeFlow({
        success: false,
        error: "No authorization code received",
      });
      return;
    }

    // Exchange code for tokens
    try {
      const tokens = await performFullTokenExchange(
        this.config!,
        callbackResult.code,
        this.pendingFlow.pkce.codeVerifier,
        { organizationId: this.pendingFlow.organizationId },
      );

      // Store tokens
      await this.tokenManager.storeTokens(tokens);

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
   * Signs out by clearing all tokens.
   */
  async signOut(): Promise<void> {
    await this.tokenManager.clearTokens();
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
   */
  private cleanupFlow(): void {
    if (this.flowTimeout) {
      clearTimeout(this.flowTimeout);
      this.flowTimeout = null;
    }

    if (this.callbackServer) {
      this.callbackServer.stop().catch(() => {});
      this.callbackServer = null;
    }

    this.pendingFlow = null;
    this.flowResolver = null;
  }
}
