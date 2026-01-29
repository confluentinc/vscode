/**
 * OAuth2 configuration for Confluent Cloud authentication.
 *
 * Contains endpoints, client IDs, and token lifetimes for
 * production, staging, and development environments.
 */

import type { OAuthConfig } from "./types";

/**
 * CCloud environment identifier.
 */
export enum CCloudEnvironment {
  /** Production environment (confluent.cloud). */
  PRODUCTION = "production",
  /** Staging environment (confluent-dev.io). */
  STAGING = "staging",
  /** Development environment (confluent-dev.io). */
  DEVELOPMENT = "development",
}

/**
 * Token lifetime constants in seconds.
 */
export const TOKEN_LIFETIMES = {
  /** ID token lifetime: 60 seconds. */
  ID_TOKEN: 60,

  /** Control plane token lifetime: 300 seconds (5 minutes). */
  CONTROL_PLANE_TOKEN: 300,

  /** Data plane token lifetime: 300 seconds (5 minutes). */
  DATA_PLANE_TOKEN: 300,

  /** Refresh token absolute lifetime: 28800 seconds (8 hours). */
  REFRESH_TOKEN_ABSOLUTE: 28800,
} as const;

/**
 * OAuth flow constants.
 */
export const OAUTH_CONSTANTS = {
  /** Maximum number of token refresh attempts before requiring re-authentication. */
  MAX_REFRESH_ATTEMPTS: 50,

  /** Interval for checking token expiration: 5 seconds. */
  TOKEN_CHECK_INTERVAL_MS: 5000,

  /** Buffer time before token expiry to trigger refresh: 30 seconds. */
  TOKEN_REFRESH_BUFFER_MS: 30000,

  /** PKCE code verifier length in bytes. */
  CODE_VERIFIER_LENGTH: 32,

  /** OAuth state parameter length in bytes. */
  STATE_LENGTH: 32,

  /** PKCE code challenge method. */
  CODE_CHALLENGE_METHOD: "S256" as const,

  /** OAuth scopes to request. */
  OAUTH_SCOPE: "email openid offline_access",

  /** Local callback server port. */
  CALLBACK_SERVER_PORT: 26636,

  /** Flow timeout: 5 minutes. */
  FLOW_TIMEOUT_MS: 300000,
} as const;

/**
 * OAuth client IDs by environment.
 * These are public client IDs for the VS Code extension.
 */
const CLIENT_IDS: Record<CCloudEnvironment, string> = {
  [CCloudEnvironment.PRODUCTION]: "Q93zdbI3FnltpEa9G1gg6tiMuoDDBkwS",
  [CCloudEnvironment.STAGING]: "S5PWFB5AQoLRg7fmsCxtBrGhYwTTzmAu",
  [CCloudEnvironment.DEVELOPMENT]: "cUmAgrkbAZSqSiy38JE7Ya3i7FwXmyUF",
};

/**
 * OAuth authorization endpoints by environment.
 */
const AUTHORIZE_URIS: Record<CCloudEnvironment, string> = {
  [CCloudEnvironment.PRODUCTION]: "https://login.confluent.io/oauth/authorize",
  [CCloudEnvironment.STAGING]: "https://login-stag.confluent-dev.io/oauth/authorize",
  [CCloudEnvironment.DEVELOPMENT]: "https://login.confluent-dev.io/oauth/authorize",
};

/**
 * OAuth token endpoints by environment.
 */
const TOKEN_URIS: Record<CCloudEnvironment, string> = {
  [CCloudEnvironment.PRODUCTION]: "https://login.confluent.io/oauth/token",
  [CCloudEnvironment.STAGING]: "https://login-stag.confluent-dev.io/oauth/token",
  [CCloudEnvironment.DEVELOPMENT]: "https://login.confluent-dev.io/oauth/token",
};

/**
 * Control plane API base URLs by environment.
 */
const CONTROL_PLANE_URIS: Record<CCloudEnvironment, string> = {
  [CCloudEnvironment.PRODUCTION]: "https://api.confluent.cloud",
  [CCloudEnvironment.STAGING]: "https://api.stag.cpdev.cloud",
  [CCloudEnvironment.DEVELOPMENT]: "https://api.devel.cpdev.cloud",
};

/**
 * Callback URIs for OAuth redirect.
 */
export const CALLBACK_URIS = {
  /** VS Code URI handler (primary, works on web). */
  VSCODE_URI: "vscode://confluentinc.vscode-confluent/authCallback",

  /** Local HTTP server (fallback for desktop). */
  LOCAL_SERVER: `http://127.0.0.1:${OAUTH_CONSTANTS.CALLBACK_SERVER_PORT}/gateway/v1/callback-vscode-docs`,
} as const;

/**
 * Control plane API endpoints (relative to base URL).
 */
export const CONTROL_PLANE_ENDPOINTS = {
  /** Session creation (ID token → CP token). */
  SESSIONS: "/api/sessions",

  /** JWT validation. */
  CHECK_JWT: "/api/check_jwt",

  /** Access token creation (CP token → DP token). */
  ACCESS_TOKENS: "/api/access_tokens",

  /** Organization listing. */
  ORGANIZATIONS: "/api/org/v2/organizations",

  /** User info. */
  ME: "/api/iam/v2/users/me",
} as const;

/**
 * Gets the OAuth configuration for a specific environment.
 * @param environment The CCloud environment.
 * @param useVscodeUri Whether to use VS Code URI handler (true) or local server (false).
 * @returns The OAuth configuration for the environment.
 */
export function getOAuthConfig(
  environment: CCloudEnvironment = CCloudEnvironment.PRODUCTION,
  useVscodeUri = true,
): OAuthConfig {
  return {
    authorizeUri: AUTHORIZE_URIS[environment],
    tokenUri: TOKEN_URIS[environment],
    controlPlaneUri: CONTROL_PLANE_URIS[environment],
    clientId: CLIENT_IDS[environment],
    redirectUri: useVscodeUri ? CALLBACK_URIS.VSCODE_URI : CALLBACK_URIS.LOCAL_SERVER,
    scope: OAUTH_CONSTANTS.OAUTH_SCOPE,
  };
}

/**
 * Detects the CCloud environment from a base path or URL.
 * @param basePath The CCloud base path (e.g., "confluent.cloud", "stag.cpdev.cloud").
 * @returns The detected environment.
 */
export function detectEnvironment(basePath?: string): CCloudEnvironment {
  if (!basePath) {
    return CCloudEnvironment.PRODUCTION;
  }

  const lowerPath = basePath.toLowerCase();

  if (lowerPath.includes("stag") || lowerPath.includes("staging")) {
    return CCloudEnvironment.STAGING;
  }

  if (lowerPath.includes("devel") || lowerPath.includes("dev")) {
    return CCloudEnvironment.DEVELOPMENT;
  }

  return CCloudEnvironment.PRODUCTION;
}

/**
 * Calculates the expiration date for a token.
 * @param lifetimeSeconds The token lifetime in seconds.
 * @param fromDate The starting date (defaults to now).
 * @returns The expiration date.
 */
export function calculateTokenExpiry(lifetimeSeconds: number, fromDate = new Date()): Date {
  return new Date(fromDate.getTime() + lifetimeSeconds * 1000);
}

/**
 * Checks if a token is expired or will expire within the buffer period.
 * @param expiresAt The token expiration date.
 * @param bufferMs Buffer time before expiry to consider as "expiring" (default: 30s).
 * @returns true if the token is expired or expiring soon.
 */
export function isTokenExpiring(
  expiresAt: Date,
  bufferMs: number = OAUTH_CONSTANTS.TOKEN_REFRESH_BUFFER_MS,
): boolean {
  const now = new Date();
  const bufferDate = new Date(now.getTime() + bufferMs);
  return expiresAt <= bufferDate;
}

/**
 * Calculates the time until a token expires.
 * @param expiresAt The token expiration date.
 * @returns Time until expiry in milliseconds (negative if already expired).
 */
export function getTimeUntilExpiry(expiresAt: Date): number {
  return expiresAt.getTime() - Date.now();
}
