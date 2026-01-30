/**
 * Token Manager for OAuth2 token lifecycle management.
 *
 * Handles secure storage, retrieval, expiration tracking, and refresh
 * coordination for OAuth tokens using VS Code's SecretStorage API.
 */

import * as vscode from "vscode";
import type { AuthenticatedOrganization, AuthenticatedUser, OAuthTokens } from "./types";
import { isTokenExpiring, getTimeUntilExpiry, OAUTH_CONSTANTS } from "./config";

/**
 * Storage key prefix for token data.
 */
const TOKEN_STORAGE_KEY = "confluent.oauth.tokens";

/**
 * Serialized token format for storage.
 * Dates are stored as ISO strings.
 */
interface SerializedTokens {
  idToken: string;
  controlPlaneToken?: string;
  dataPlaneToken?: string;
  refreshToken: string;
  idTokenExpiresAt: string;
  controlPlaneTokenExpiresAt?: string;
  dataPlaneTokenExpiresAt?: string;
  refreshTokenExpiresAt: string;
  user?: AuthenticatedUser;
  organization?: AuthenticatedOrganization;
}

/**
 * Token status for a specific token type.
 */
export interface TokenStatus {
  /** Whether the token exists. */
  exists: boolean;
  /** Whether the token is expired or expiring soon. */
  expiring: boolean;
  /** Time until expiration in milliseconds (negative if expired). */
  timeUntilExpiry: number;
  /** The expiration date (if token exists). */
  expiresAt?: Date;
}

/**
 * Overall token status for all token types.
 */
export interface AllTokenStatus {
  /** ID token status. */
  idToken: TokenStatus;
  /** Control plane token status. */
  controlPlaneToken: TokenStatus;
  /** Data plane token status (optional). */
  dataPlaneToken?: TokenStatus;
  /** Refresh token status. */
  refreshToken: TokenStatus;
  /** Whether the session is valid (refresh token not expired). */
  sessionValid: boolean;
  /** Whether any token needs refresh. */
  needsRefresh: boolean;
}

/**
 * Events emitted by TokenManager.
 */
export interface TokenManagerEvents {
  /** Emitted when tokens are stored or updated. */
  onTokensUpdated: vscode.Event<OAuthTokens>;
  /** Emitted when tokens are cleared. */
  onTokensCleared: vscode.Event<void>;
  /** Emitted when a token is expiring soon and needs refresh. */
  onTokenExpiring: vscode.Event<{
    tokenType: string;
    expiresAt: Date;
  }>;
  /** Emitted when the refresh token expires (session ended). */
  onSessionExpired: vscode.Event<void>;
}

/**
 * Manages OAuth token storage, retrieval, and lifecycle.
 */
export class TokenManager implements vscode.Disposable {
  private static instance: TokenManager | null = null;
  private secretStorage: vscode.SecretStorage | null = null;
  private cachedTokens: OAuthTokens | null = null;
  private expirationTimer: ReturnType<typeof setInterval> | null = null;
  private refreshAttempts = 0;
  private readonly disposables: vscode.Disposable[] = [];

  // Event emitters
  private readonly _onTokensUpdated = new vscode.EventEmitter<OAuthTokens>();
  private readonly _onTokensCleared = new vscode.EventEmitter<void>();
  private readonly _onTokenExpiring = new vscode.EventEmitter<{
    tokenType: string;
    expiresAt: Date;
  }>();
  private readonly _onSessionExpired = new vscode.EventEmitter<void>();

  /** Emitted when tokens are stored or updated. */
  readonly onTokensUpdated = this._onTokensUpdated.event;
  /** Emitted when tokens are cleared. */
  readonly onTokensCleared = this._onTokensCleared.event;
  /** Emitted when a token is expiring soon and needs refresh. */
  readonly onTokenExpiring = this._onTokenExpiring.event;
  /** Emitted when the refresh token expires (session ended). */
  readonly onSessionExpired = this._onSessionExpired.event;

  private constructor() {
    this.disposables.push(
      this._onTokensUpdated,
      this._onTokensCleared,
      this._onTokenExpiring,
      this._onSessionExpired,
    );
  }

  /**
   * Gets the singleton instance of TokenManager.
   * @returns The TokenManager instance.
   */
  static getInstance(): TokenManager {
    if (!TokenManager.instance) {
      TokenManager.instance = new TokenManager();
    }
    return TokenManager.instance;
  }

  /**
   * Resets the singleton instance (for testing).
   */
  static resetInstance(): void {
    if (TokenManager.instance) {
      TokenManager.instance.dispose();
      TokenManager.instance = null;
    }
  }

  /**
   * Initializes the TokenManager with VS Code's SecretStorage.
   * Must be called before using other methods.
   * @param secretStorage The VS Code SecretStorage instance.
   */
  async initialize(secretStorage: vscode.SecretStorage): Promise<void> {
    this.secretStorage = secretStorage;

    // Load any existing tokens
    await this.loadTokens();

    // Start expiration monitoring
    this.startExpirationMonitor();
  }

  /**
   * Stores OAuth tokens securely.
   * @param tokens The tokens to store.
   */
  async storeTokens(tokens: OAuthTokens): Promise<void> {
    if (!this.secretStorage) {
      throw new Error("TokenManager not initialized. Call initialize() first.");
    }

    const serialized = this.serializeTokens(tokens);
    await this.secretStorage.store(TOKEN_STORAGE_KEY, JSON.stringify(serialized));

    this.cachedTokens = tokens;
    this.refreshAttempts = 0;
    this._onTokensUpdated.fire(tokens);
  }

  /**
   * Retrieves stored OAuth tokens.
   * @returns The stored tokens, or null if none exist.
   */
  async getTokens(): Promise<OAuthTokens | null> {
    if (this.cachedTokens) {
      return this.cachedTokens;
    }

    return this.loadTokens();
  }

  /**
   * Clears all stored tokens.
   */
  async clearTokens(): Promise<void> {
    if (!this.secretStorage) {
      throw new Error("TokenManager not initialized. Call initialize() first.");
    }

    await this.secretStorage.delete(TOKEN_STORAGE_KEY);
    this.cachedTokens = null;
    this.refreshAttempts = 0;
    this._onTokensCleared.fire();
  }

  /**
   * Gets the current ID token if valid.
   * @returns The ID token or null if expired/missing.
   */
  async getIdToken(): Promise<string | null> {
    const tokens = await this.getTokens();
    if (!tokens) {
      return null;
    }

    if (isTokenExpiring(tokens.idTokenExpiresAt)) {
      return null;
    }

    return tokens.idToken;
  }

  /**
   * Gets the current control plane token if valid.
   * @returns The control plane token or null if expired/missing.
   */
  async getControlPlaneToken(): Promise<string | null> {
    const tokens = await this.getTokens();
    if (!tokens || !tokens.controlPlaneToken || !tokens.controlPlaneTokenExpiresAt) {
      return null;
    }

    if (isTokenExpiring(tokens.controlPlaneTokenExpiresAt)) {
      return null;
    }

    return tokens.controlPlaneToken;
  }

  /**
   * Gets the current data plane token if valid.
   * @returns The data plane token or null if expired/missing/not present.
   */
  async getDataPlaneToken(): Promise<string | null> {
    const tokens = await this.getTokens();
    if (!tokens || !tokens.dataPlaneToken || !tokens.dataPlaneTokenExpiresAt) {
      return null;
    }

    if (isTokenExpiring(tokens.dataPlaneTokenExpiresAt)) {
      return null;
    }

    return tokens.dataPlaneToken;
  }

  /**
   * Gets the refresh token.
   * @returns The refresh token or null if expired/missing.
   */
  async getRefreshToken(): Promise<string | null> {
    const tokens = await this.getTokens();
    if (!tokens) {
      return null;
    }

    // Refresh token expired = session over
    if (isTokenExpiring(tokens.refreshTokenExpiresAt, 0)) {
      return null;
    }

    return tokens.refreshToken;
  }

  /**
   * Checks if the session is still valid (refresh token not expired).
   * @returns true if the session can be refreshed.
   */
  async isSessionValid(): Promise<boolean> {
    const refreshToken = await this.getRefreshToken();
    return refreshToken !== null;
  }

  /**
   * Gets the authenticated user info from stored tokens.
   * @returns User info from control plane token exchange, or null if not available.
   */
  async getUser(): Promise<AuthenticatedUser | null> {
    const tokens = await this.getTokens();
    return tokens?.user ?? null;
  }

  /**
   * Gets the authenticated organization info from stored tokens.
   * @returns Organization info from control plane token exchange, or null if not available.
   */
  async getOrganization(): Promise<AuthenticatedOrganization | null> {
    const tokens = await this.getTokens();
    return tokens?.organization ?? null;
  }

  /**
   * Gets the status of all tokens.
   * @returns Detailed status of each token type.
   */
  async getTokenStatus(): Promise<AllTokenStatus> {
    const tokens = await this.getTokens();

    const createStatus = (expiresAt?: Date): TokenStatus => {
      if (!expiresAt) {
        return {
          exists: false,
          expiring: true,
          timeUntilExpiry: -1,
        };
      }

      return {
        exists: true,
        expiring: isTokenExpiring(expiresAt),
        timeUntilExpiry: getTimeUntilExpiry(expiresAt),
        expiresAt,
      };
    };

    const idToken = createStatus(tokens?.idTokenExpiresAt);
    const controlPlaneToken = createStatus(tokens?.controlPlaneTokenExpiresAt);
    const refreshToken = createStatus(tokens?.refreshTokenExpiresAt);

    const dataPlaneToken = tokens?.dataPlaneTokenExpiresAt
      ? createStatus(tokens.dataPlaneTokenExpiresAt)
      : undefined;

    const sessionValid = refreshToken.exists && !isTokenExpiring(tokens!.refreshTokenExpiresAt, 0);
    const needsRefresh =
      sessionValid && (idToken.expiring || controlPlaneToken.expiring || dataPlaneToken?.expiring);

    return {
      idToken,
      controlPlaneToken,
      dataPlaneToken,
      refreshToken,
      sessionValid,
      needsRefresh: needsRefresh ?? false,
    };
  }

  /**
   * Updates specific tokens without replacing all tokens.
   * Useful for updating just the data plane token after exchange.
   * @param updates Partial token updates.
   */
  async updateTokens(updates: Partial<OAuthTokens>): Promise<void> {
    const tokens = await this.getTokens();
    if (!tokens) {
      throw new Error("No tokens to update. Store tokens first.");
    }

    const updated: OAuthTokens = {
      ...tokens,
      ...updates,
    };

    await this.storeTokens(updated);
  }

  /**
   * Increments and returns the refresh attempt count.
   * Used to track refresh attempts for the max attempt limit.
   * @returns The new refresh attempt count.
   */
  incrementRefreshAttempts(): number {
    this.refreshAttempts++;
    return this.refreshAttempts;
  }

  /**
   * Gets the current refresh attempt count.
   * @returns The number of refresh attempts.
   */
  getRefreshAttempts(): number {
    return this.refreshAttempts;
  }

  /**
   * Checks if refresh attempts have exceeded the maximum.
   * @returns true if max attempts reached.
   */
  hasExceededMaxRefreshAttempts(): boolean {
    return this.refreshAttempts >= OAUTH_CONSTANTS.MAX_REFRESH_ATTEMPTS;
  }

  /**
   * Resets the refresh attempt counter.
   */
  resetRefreshAttempts(): void {
    this.refreshAttempts = 0;
  }

  /**
   * Disposes of resources.
   */
  dispose(): void {
    this.stopExpirationMonitor();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.disposables.length = 0;
    this.cachedTokens = null;
    this.secretStorage = null;
    TokenManager.instance = null;
  }

  /**
   * Loads tokens from storage.
   */
  private async loadTokens(): Promise<OAuthTokens | null> {
    if (!this.secretStorage) {
      return null;
    }

    const stored = await this.secretStorage.get(TOKEN_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    try {
      const serialized: SerializedTokens = JSON.parse(stored);

      // Debug: Log what's in the serialized data (without exposing actual tokens)
      console.log("[tokenManager.loadTokens] Loaded from storage:", {
        hasIdToken: !!serialized.idToken,
        hasControlPlaneToken: !!serialized.controlPlaneToken,
        hasDataPlaneToken: !!serialized.dataPlaneToken,
        hasRefreshToken: !!serialized.refreshToken,
        refreshTokenLength: serialized.refreshToken?.length ?? 0,
        keys: Object.keys(serialized),
      });

      this.cachedTokens = this.deserializeTokens(serialized);
      return this.cachedTokens;
    } catch (error) {
      // Invalid stored data, clear it
      console.error("[tokenManager.loadTokens] Failed to parse stored tokens:", error);
      await this.secretStorage.delete(TOKEN_STORAGE_KEY);
      return null;
    }
  }

  /**
   * Serializes tokens for storage.
   */
  private serializeTokens(tokens: OAuthTokens): SerializedTokens {
    return {
      idToken: tokens.idToken,
      controlPlaneToken: tokens.controlPlaneToken,
      dataPlaneToken: tokens.dataPlaneToken,
      refreshToken: tokens.refreshToken,
      idTokenExpiresAt: tokens.idTokenExpiresAt.toISOString(),
      controlPlaneTokenExpiresAt: tokens.controlPlaneTokenExpiresAt?.toISOString(),
      dataPlaneTokenExpiresAt: tokens.dataPlaneTokenExpiresAt?.toISOString(),
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      user: tokens.user,
      organization: tokens.organization,
    };
  }

  /**
   * Deserializes tokens from storage.
   */
  private deserializeTokens(serialized: SerializedTokens): OAuthTokens {
    return {
      idToken: serialized.idToken,
      controlPlaneToken: serialized.controlPlaneToken,
      dataPlaneToken: serialized.dataPlaneToken,
      refreshToken: serialized.refreshToken,
      idTokenExpiresAt: new Date(serialized.idTokenExpiresAt),
      controlPlaneTokenExpiresAt: serialized.controlPlaneTokenExpiresAt
        ? new Date(serialized.controlPlaneTokenExpiresAt)
        : undefined,
      dataPlaneTokenExpiresAt: serialized.dataPlaneTokenExpiresAt
        ? new Date(serialized.dataPlaneTokenExpiresAt)
        : undefined,
      refreshTokenExpiresAt: new Date(serialized.refreshTokenExpiresAt),
      user: serialized.user,
      organization: serialized.organization,
    };
  }

  /**
   * Starts the token expiration monitor.
   */
  private startExpirationMonitor(): void {
    if (this.expirationTimer) {
      return;
    }

    this.expirationTimer = setInterval(
      () => this.checkTokenExpiration(),
      OAUTH_CONSTANTS.TOKEN_CHECK_INTERVAL_MS,
    );
  }

  /**
   * Stops the token expiration monitor.
   */
  private stopExpirationMonitor(): void {
    if (this.expirationTimer) {
      clearInterval(this.expirationTimer);
      this.expirationTimer = null;
    }
  }

  /**
   * Checks token expiration and emits appropriate events.
   */
  private async checkTokenExpiration(): Promise<void> {
    const tokens = await this.getTokens();
    if (!tokens) {
      return;
    }

    // Check refresh token first (session validity)
    if (isTokenExpiring(tokens.refreshTokenExpiresAt, 0)) {
      this._onSessionExpired.fire();
      return;
    }

    // Check other tokens for refresh needs
    if (isTokenExpiring(tokens.idTokenExpiresAt)) {
      this._onTokenExpiring.fire({ tokenType: "idToken", expiresAt: tokens.idTokenExpiresAt });
    }

    if (tokens.controlPlaneTokenExpiresAt && isTokenExpiring(tokens.controlPlaneTokenExpiresAt)) {
      this._onTokenExpiring.fire({
        tokenType: "controlPlaneToken",
        expiresAt: tokens.controlPlaneTokenExpiresAt,
      });
    }

    if (tokens.dataPlaneTokenExpiresAt && isTokenExpiring(tokens.dataPlaneTokenExpiresAt)) {
      this._onTokenExpiring.fire({
        tokenType: "dataPlaneToken",
        expiresAt: tokens.dataPlaneTokenExpiresAt,
      });
    }
  }
}
