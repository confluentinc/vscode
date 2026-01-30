/**
 * OAuth2 types for Confluent Cloud authentication.
 *
 * Defines the token structures, PKCE parameters, and exchange interfaces
 * used in the OAuth2 PKCE flow.
 */

/**
 * OAuth tokens received from authentication flow.
 * Includes ID token, control plane token, data plane token, and refresh token.
 *
 * Note: Control plane and data plane tokens are optional during the initial
 * authentication flow. They will be obtained on-demand when making API calls.
 */
export interface OAuthTokens {
  /** JWT ID token from initial OAuth exchange. */
  idToken: string;

  /** Control plane access token for CCloud management APIs (obtained on-demand). */
  controlPlaneToken?: string;

  /** Data plane access token for Kafka/SR operations (obtained on-demand). */
  dataPlaneToken?: string;

  /** Refresh token for obtaining new tokens. */
  refreshToken: string;

  /** Timestamp when the ID token expires. */
  idTokenExpiresAt: Date;

  /** Timestamp when the control plane token expires (if present). */
  controlPlaneTokenExpiresAt?: Date;

  /** Timestamp when the data plane token expires (if present). */
  dataPlaneTokenExpiresAt?: Date;

  /** Absolute timestamp when refresh token expires (8 hours from initial auth). */
  refreshTokenExpiresAt: Date;
}

/**
 * PKCE (Proof Key for Code Exchange) parameters.
 * Used to secure the OAuth authorization code flow.
 */
export interface PKCEParams {
  /** Random code verifier (32 bytes, base64url encoded). */
  codeVerifier: string;

  /** SHA-256 hash of code verifier (base64url encoded). */
  codeChallenge: string;

  /** Code challenge method (always "S256"). */
  codeChallengeMethod: "S256";

  /** Random state parameter for CSRF protection. */
  state: string;
}

/**
 * OAuth configuration for a specific CCloud environment.
 */
export interface OAuthConfig {
  /** Authorization endpoint URL. */
  authorizeUri: string;

  /** Token endpoint URL for code exchange. */
  tokenUri: string;

  /** CCloud base URL for session/login endpoints (e.g., https://confluent.cloud). */
  ccloudBaseUri: string;

  /** Control plane API base URL (e.g., https://api.confluent.cloud). */
  controlPlaneUri: string;

  /** OAuth client ID. */
  clientId: string;

  /** Redirect URI for OAuth callback. */
  redirectUri: string;

  /** OAuth scopes to request. */
  scope: string;
}

/**
 * Request to exchange authorization code for ID token.
 */
export interface IdTokenExchangeRequest {
  /** Grant type (always "authorization_code"). */
  grantType: "authorization_code";

  /** OAuth client ID. */
  clientId: string;

  /** Authorization code from callback. */
  code: string;

  /** PKCE code verifier. */
  codeVerifier: string;

  /** Redirect URI used in authorization request. */
  redirectUri: string;
}

/**
 * Response from ID token exchange.
 */
export interface IdTokenExchangeResponse {
  /** Access token (not typically used directly). */
  accessToken: string;

  /** Refresh token for obtaining new tokens. */
  refreshToken: string;

  /** JWT ID token containing user claims. */
  idToken: string;

  /** Granted OAuth scopes. */
  scope: string;

  /** Token expiration time in seconds. */
  expiresIn: number;

  /** Token type (typically "Bearer"). */
  tokenType: string;
}

/**
 * Request to exchange ID token for control plane token.
 */
export interface ControlPlaneTokenExchangeRequest {
  /** JWT ID token. */
  idToken: string;

  /** Optional organization resource ID. */
  orgResourceId?: string;
}

/**
 * User details from control plane authentication.
 */
export interface AuthenticatedUser {
  /** User's resource ID. */
  id: string;

  /** User's email address. */
  email: string;

  /** User's first name. */
  firstName?: string;

  /** User's last name. */
  lastName?: string;

  /** Whether this is a service account. */
  serviceAccount?: boolean;

  /** Social connection provider (e.g., "google", "github"). */
  socialConnection?: string;

  /** Authentication type. */
  authType?: string;
}

/**
 * Organization details from control plane authentication.
 */
export interface AuthenticatedOrganization {
  /** Organization resource ID. */
  id: string;

  /** Organization name. */
  name: string;

  /** Whether this is the user's current organization. */
  current?: boolean;
}

/**
 * Response from control plane token exchange.
 */
export interface ControlPlaneTokenExchangeResponse {
  /** Control plane access token (from auth_token cookie). */
  token: string;

  /** Authenticated user details. */
  user: AuthenticatedUser;

  /** Organization details. */
  organization?: AuthenticatedOrganization;

  /** New refresh token (if issued). */
  refreshToken?: string;

  /** Error details if exchange failed. */
  error?: OAuthError;
}

/**
 * Request to exchange control plane token for data plane token.
 */
export interface DataPlaneTokenExchangeRequest {
  /** Control plane token for authorization. */
  controlPlaneToken: string;

  /** Optional cluster ID for cluster-specific token. */
  clusterId?: string;
}

/**
 * Response from data plane token exchange.
 */
export interface DataPlaneTokenExchangeResponse {
  /** Data plane access token. */
  token: string;

  /** Regional token (if applicable). */
  regionalToken?: string;

  /** Error details if exchange failed. */
  error?: OAuthError;
}

/**
 * Request to refresh tokens using refresh token.
 */
export interface TokenRefreshRequest {
  /** Grant type (always "refresh_token"). */
  grantType: "refresh_token";

  /** OAuth client ID. */
  clientId: string;

  /** Refresh token. */
  refreshToken: string;
}

/**
 * Response from token refresh.
 */
export interface TokenRefreshResponse {
  /** New access token. */
  accessToken: string;

  /** New refresh token (if rotated). */
  refreshToken?: string;

  /** New ID token. */
  idToken: string;

  /** Token expiration time in seconds. */
  expiresIn: number;

  /** Token type (typically "Bearer"). */
  tokenType: string;
}

/**
 * OAuth error response.
 */
export interface OAuthError {
  /** Error code. */
  error: string;

  /** Human-readable error description. */
  errorDescription?: string;

  /** URI with more information about the error. */
  errorUri?: string;
}

/**
 * Result of an OAuth callback (success or error).
 */
export interface OAuthCallbackResult {
  /** Whether the callback was successful. */
  success: boolean;

  /** Authorization code (if successful). */
  code?: string;

  /** State parameter from authorization request. */
  state?: string;

  /** Error details (if failed). */
  error?: OAuthError;
}

/**
 * OAuth flow state for tracking in-progress authentication.
 */
export interface OAuthFlowState {
  /** PKCE parameters for this flow. */
  pkce: PKCEParams;

  /** Timestamp when flow was initiated. */
  initiatedAt: Date;

  /** Whether this flow has been completed. */
  completed: boolean;

  /** Organization ID if specified. */
  organizationId?: string;
}

/**
 * Checks if an object is an OAuthError.
 */
export function isOAuthError(obj: unknown): obj is OAuthError {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "error" in obj &&
    typeof (obj as OAuthError).error === "string"
  );
}
