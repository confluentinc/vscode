/**
 * PKCE State Manager for persisting OAuth flow state.
 *
 * Stores PKCE parameters (code verifier, state) in VS Code SecretStorage
 * so they persist across extension restarts. This allows the auth callback
 * to complete token exchange even if VS Code was restarted during the
 * browser-based authentication flow.
 */

import type * as vscode from "vscode";
import type { OAuthConfig, PKCEParams } from "./types";
import { generatePKCEParams, buildAuthorizationUrl } from "./pkce";
import { getOAuthConfig, type CCloudEnvironment } from "./config";

/** Storage key for PKCE state. */
const PKCE_STATE_STORAGE_KEY = "confluent.oauth.pkce";

/** Maximum age for PKCE state in milliseconds (10 minutes). */
const PKCE_STATE_MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Serialized PKCE state for storage.
 */
interface SerializedPKCEState {
  /** The PKCE parameters. */
  pkce: PKCEParams;
  /** The built authorization URL. */
  signInUri: string;
  /** ISO timestamp when the state was created. */
  createdAt: string;
  /** The CCloud environment this state was created for. */
  environment: CCloudEnvironment;
  /** Optional organization ID. */
  organizationId?: string;
}

/**
 * PKCE state with metadata.
 */
export interface PKCEState {
  /** The PKCE parameters. */
  pkce: PKCEParams;
  /** The built authorization URL. */
  signInUri: string;
  /** When the state was created. */
  createdAt: Date;
  /** The CCloud environment. */
  environment: CCloudEnvironment;
  /** Optional organization ID. */
  organizationId?: string;
}

/**
 * Manages PKCE state persistence in VS Code SecretStorage.
 *
 * The PKCE code verifier must be kept secret and available for the
 * token exchange step after the OAuth callback. This manager stores
 * the PKCE state securely and provides methods to:
 * - Create new PKCE state and sign-in URI
 * - Retrieve existing state for token exchange
 * - Clear state after successful auth or expiration
 */
export class PKCEStateManager implements vscode.Disposable {
  private static instance: PKCEStateManager | null = null;
  private secretStorage: vscode.SecretStorage | null = null;
  private cachedState: PKCEState | null = null;

  private constructor() {}

  /**
   * Gets the singleton instance of PKCEStateManager.
   */
  static getInstance(): PKCEStateManager {
    if (!PKCEStateManager.instance) {
      PKCEStateManager.instance = new PKCEStateManager();
    }
    return PKCEStateManager.instance;
  }

  /**
   * Resets the singleton instance (for testing).
   */
  static resetInstance(): void {
    if (PKCEStateManager.instance) {
      PKCEStateManager.instance.dispose();
      PKCEStateManager.instance = null;
    }
  }

  /**
   * Initializes the manager with VS Code's SecretStorage.
   * @param secretStorage The VS Code SecretStorage instance.
   */
  async initialize(secretStorage: vscode.SecretStorage): Promise<void> {
    this.secretStorage = secretStorage;
    // Load and validate any existing state
    await this.loadState();
  }

  /**
   * Gets or creates a sign-in URI for CCloud authentication.
   *
   * If valid PKCE state already exists, returns the existing sign-in URI.
   * Otherwise, generates new PKCE parameters and builds a new sign-in URI.
   *
   * @param environment The CCloud environment to authenticate against.
   * @param organizationId Optional organization ID to pre-select.
   * @param forceNew Force creation of new PKCE state even if existing state is valid.
   * @returns The sign-in URI to open in the browser.
   */
  async getOrCreateSignInUri(
    environment: CCloudEnvironment,
    organizationId?: string,
    forceNew = false,
  ): Promise<string> {
    // Check for existing valid state
    if (!forceNew) {
      const existingState = await this.getState();
      if (existingState && existingState.environment === environment) {
        // If organization ID matches (or both are undefined), reuse existing state
        if (existingState.organizationId === organizationId) {
          return existingState.signInUri;
        }
      }
    }

    // Generate new PKCE parameters
    const pkce = generatePKCEParams();
    const config = getOAuthConfig(environment);
    const signInUri = buildAuthorizationUrl(config, pkce);

    // Store the new state
    const state: PKCEState = {
      pkce,
      signInUri,
      createdAt: new Date(),
      environment,
      organizationId,
    };

    await this.storeState(state);
    return signInUri;
  }

  /**
   * Gets the current PKCE state if it exists and is valid.
   * @returns The PKCE state or null if none exists or expired.
   */
  async getState(): Promise<PKCEState | null> {
    if (this.cachedState && this.isStateValid(this.cachedState)) {
      return this.cachedState;
    }

    const state = await this.loadState();
    if (state && this.isStateValid(state)) {
      return state;
    }

    // State is expired or invalid, clear it
    if (state) {
      await this.clearState();
    }
    return null;
  }

  /**
   * Gets the code verifier for token exchange.
   * @returns The code verifier or null if no valid state exists.
   */
  async getCodeVerifier(): Promise<string | null> {
    const state = await this.getState();
    return state?.pkce.codeVerifier ?? null;
  }

  /**
   * Gets the state parameter for CSRF validation.
   * @returns The state parameter or null if no valid state exists.
   */
  async getStateParam(): Promise<string | null> {
    const state = await this.getState();
    return state?.pkce.state ?? null;
  }

  /**
   * Gets the OAuth config for the current PKCE state's environment.
   * @returns The OAuth config or null if no valid state exists.
   */
  async getConfig(): Promise<OAuthConfig | null> {
    const state = await this.getState();
    if (!state) {
      return null;
    }
    return getOAuthConfig(state.environment);
  }

  /**
   * Clears the stored PKCE state.
   * Should be called after successful token exchange or on auth failure.
   */
  async clearState(): Promise<void> {
    if (!this.secretStorage) {
      return;
    }

    await this.secretStorage.delete(PKCE_STATE_STORAGE_KEY);
    this.cachedState = null;
  }

  /**
   * Disposes of resources.
   */
  dispose(): void {
    this.cachedState = null;
    this.secretStorage = null;
    PKCEStateManager.instance = null;
  }

  /**
   * Checks if a PKCE state is still valid (not expired).
   */
  private isStateValid(state: PKCEState): boolean {
    const age = Date.now() - state.createdAt.getTime();
    return age < PKCE_STATE_MAX_AGE_MS;
  }

  /**
   * Stores PKCE state in secret storage.
   */
  private async storeState(state: PKCEState): Promise<void> {
    if (!this.secretStorage) {
      throw new Error("PKCEStateManager not initialized. Call initialize() first.");
    }

    const serialized: SerializedPKCEState = {
      pkce: state.pkce,
      signInUri: state.signInUri,
      createdAt: state.createdAt.toISOString(),
      environment: state.environment,
      organizationId: state.organizationId,
    };

    await this.secretStorage.store(PKCE_STATE_STORAGE_KEY, JSON.stringify(serialized));
    this.cachedState = state;
  }

  /**
   * Loads PKCE state from secret storage.
   */
  private async loadState(): Promise<PKCEState | null> {
    if (!this.secretStorage) {
      return null;
    }

    const stored = await this.secretStorage.get(PKCE_STATE_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    try {
      const serialized: SerializedPKCEState = JSON.parse(stored);
      const state: PKCEState = {
        pkce: serialized.pkce,
        signInUri: serialized.signInUri,
        createdAt: new Date(serialized.createdAt),
        environment: serialized.environment,
        organizationId: serialized.organizationId,
      };

      this.cachedState = state;
      return state;
    } catch {
      // Invalid stored data, clear it
      await this.secretStorage.delete(PKCE_STATE_STORAGE_KEY);
      return null;
    }
  }
}
