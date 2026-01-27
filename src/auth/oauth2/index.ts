/**
 * OAuth2 module for Confluent Cloud authentication.
 *
 * Provides PKCE-based OAuth2 authentication flow for CCloud,
 * including token management, callback handling, and credential resolution.
 */

// Types
export {
  isOAuthError,
  type AuthenticatedOrganization,
  type AuthenticatedUser,
  type ControlPlaneTokenExchangeRequest,
  type ControlPlaneTokenExchangeResponse,
  type DataPlaneTokenExchangeRequest,
  type DataPlaneTokenExchangeResponse,
  type IdTokenExchangeRequest,
  type IdTokenExchangeResponse,
  type OAuthCallbackResult,
  type OAuthConfig,
  type OAuthError,
  type OAuthFlowState,
  type OAuthTokens,
  type PKCEParams,
  type TokenRefreshRequest,
  type TokenRefreshResponse,
} from "./types";

// Configuration
export {
  calculateTokenExpiry,
  CALLBACK_URIS,
  CCloudEnvironment,
  CONTROL_PLANE_ENDPOINTS,
  detectEnvironment,
  getOAuthConfig,
  getTimeUntilExpiry,
  isTokenExpiring,
  OAUTH_CONSTANTS,
  TOKEN_LIFETIMES,
} from "./config";

// PKCE
export {
  base64UrlEncode,
  buildAuthorizationUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  generatePKCEParams,
  generateRandomString,
  generateState,
  validateState,
  verifyCodeChallenge,
} from "./pkce";

// Token Manager
export { TokenManager, type AllTokenStatus, type TokenStatus } from "./tokenManager";

// Token Exchange
export {
  exchangeCodeForIdToken,
  exchangeControlPlaneTokenForDataPlaneToken,
  exchangeIdTokenForControlPlaneToken,
  performFullTokenExchange,
  performTokenRefresh,
  refreshTokens,
  TokenExchangeError,
  type ControlPlaneExchangeOptions,
  type DataPlaneExchangeOptions,
} from "./tokenExchange";

// Callback Server
export { OAuthCallbackServer, type CallbackHandler } from "./callbackServer";

// URI Handler
export {
  createCallbackUri,
  createErrorCallbackUri,
  OAuthUriHandler,
  type UriCallbackHandler,
} from "./uriHandler";

// Auth Service
export { AuthService, AuthState, type AuthOptions, type AuthResult } from "./authService";
