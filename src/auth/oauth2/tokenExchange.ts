/**
 * Token exchange operations for OAuth2 authentication.
 *
 * Handles the multi-step token exchange flow:
 * 1. Authorization code → ID token (via Auth0 token endpoint)
 * 2. ID token → Control plane token (via CCloud /api/sessions)
 * 3. Control plane token → Data plane token (via CCloud /api/access_tokens)
 * 4. Refresh token → New ID token (via Auth0 token endpoint)
 */

import type {
  ControlPlaneTokenExchangeResponse,
  DataPlaneTokenExchangeResponse,
  IdTokenExchangeResponse,
  OAuthConfig,
  OAuthError,
  OAuthTokens,
  TokenRefreshResponse,
} from "./types";
import { isOAuthError } from "./types";
import { calculateTokenExpiry, CONTROL_PLANE_ENDPOINTS, TOKEN_LIFETIMES } from "./config";

/**
 * Error thrown when token exchange fails.
 */
export class TokenExchangeError extends Error {
  constructor(
    message: string,
    public readonly oauthError?: OAuthError,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "TokenExchangeError";
  }
}

/**
 * Options for control plane token exchange.
 */
export interface ControlPlaneExchangeOptions {
  /** Optional organization ID to select. */
  organizationId?: string;
}

/**
 * Options for data plane token exchange.
 */
export interface DataPlaneExchangeOptions {
  /** Optional Kafka cluster ID for cluster-specific token. */
  clusterId?: string;
}

/**
 * Exchanges an authorization code for an ID token and refresh token.
 *
 * This is the first step in the OAuth flow after receiving the callback.
 *
 * @param config OAuth configuration with endpoints and client ID.
 * @param code Authorization code from the callback.
 * @param codeVerifier PKCE code verifier used in the authorization request.
 * @returns The token exchange response containing ID token and refresh token.
 * @throws TokenExchangeError if the exchange fails.
 */
export async function exchangeCodeForIdToken(
  config: OAuthConfig,
  code: string,
  codeVerifier: string,
): Promise<IdTokenExchangeResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    code_verifier: codeVerifier,
    redirect_uri: config.redirectUri,
  });

  const response = await fetch(config.tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await parseErrorResponse(response);
    throw new TokenExchangeError(
      `Failed to exchange code for ID token: ${errorBody?.error ?? response.statusText}`,
      errorBody,
      response.status,
    );
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    scope: data.scope,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
  };
}

/**
 * Exchanges an ID token for a control plane token.
 *
 * This is the second step, authenticating with the CCloud control plane.
 * The sessions endpoint is on the CCloud base URL (confluent.cloud), not the API URL.
 *
 * @param ccloudBaseUri Base URL of CCloud (e.g., https://confluent.cloud).
 * @param idToken JWT ID token from the OAuth provider.
 * @param options Optional settings like organization ID.
 * @returns The control plane token exchange response.
 * @throws TokenExchangeError if the exchange fails.
 */
export async function exchangeIdTokenForControlPlaneToken(
  ccloudBaseUri: string,
  idToken: string,
  options?: ControlPlaneExchangeOptions,
): Promise<ControlPlaneTokenExchangeResponse> {
  const url = `${ccloudBaseUri}${CONTROL_PLANE_ENDPOINTS.SESSIONS}`;

  const body: Record<string, string> = {
    id_token: idToken,
  };

  if (options?.organizationId) {
    body.org_resource_id = options.organizationId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await parseErrorResponse(response);
    throw new TokenExchangeError(
      `Failed to exchange ID token for control plane token: ${errorBody?.error ?? response.statusText}`,
      errorBody,
      response.status,
    );
  }

  const data = await response.json();

  // The control plane token is returned in the auth_token cookie
  const authToken = extractAuthTokenFromResponse(response, data);

  return {
    token: authToken,
    user: {
      id: data.user?.resource_id ?? data.user?.id,
      email: data.user?.email,
      firstName: data.user?.first_name,
      lastName: data.user?.last_name,
      serviceAccount: data.user?.service_account,
      socialConnection: data.user?.social_connection,
      authType: data.user?.auth_type,
    },
    organization: data.account
      ? {
          id: data.account.resource_id ?? data.account.id,
          name: data.account.name,
          current: data.account.current,
        }
      : undefined,
    refreshToken: data.refresh_token,
  };
}

/**
 * Exchanges a control plane token for a data plane token.
 *
 * This provides access to Kafka and Schema Registry operations.
 * The access_tokens endpoint is on the CCloud base URL (confluent.cloud), not the API URL.
 *
 * @param ccloudBaseUri Base URL of CCloud (e.g., https://confluent.cloud).
 * @param controlPlaneToken Control plane access token.
 * @param options Optional settings like cluster ID.
 * @returns The data plane token exchange response.
 * @throws TokenExchangeError if the exchange fails.
 */
export async function exchangeControlPlaneTokenForDataPlaneToken(
  ccloudBaseUri: string,
  controlPlaneToken: string,
  options?: DataPlaneExchangeOptions,
): Promise<DataPlaneTokenExchangeResponse> {
  const url = `${ccloudBaseUri}${CONTROL_PLANE_ENDPOINTS.ACCESS_TOKENS}`;

  const body: Record<string, unknown> = {};

  if (options?.clusterId) {
    body.cluster_id = options.clusterId;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${controlPlaneToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await parseErrorResponse(response);
    throw new TokenExchangeError(
      `Failed to exchange control plane token for data plane token: ${errorBody?.error ?? response.statusText}`,
      errorBody,
      response.status,
    );
  }

  const data = await response.json();

  return {
    token: data.token ?? data.access_token,
    regionalToken: data.regional_token,
  };
}

/**
 * Refreshes tokens using a refresh token.
 *
 * This is used to obtain new ID tokens when they expire.
 *
 * @param config OAuth configuration with endpoints and client ID.
 * @param refreshToken The refresh token to use.
 * @returns The token refresh response with new tokens.
 * @throws TokenExchangeError if the refresh fails.
 */
export async function refreshTokens(
  config: OAuthConfig,
  refreshToken: string,
): Promise<TokenRefreshResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });

  const response = await fetch(config.tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await parseErrorResponse(response);
    throw new TokenExchangeError(
      `Failed to refresh tokens: ${errorBody?.error ?? response.statusText}`,
      errorBody,
      response.status,
    );
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type,
  };
}

/**
 * Performs the complete token exchange flow from authorization code to full token set.
 *
 * Exchanges the authorization code for:
 * 1. ID token and refresh token (from Auth0)
 * 2. Control plane token (from CCloud /api/sessions)
 * 3. Data plane token is obtained on-demand when needed for Kafka/SR operations
 *
 * @param config OAuth configuration.
 * @param code Authorization code from callback.
 * @param codeVerifier PKCE code verifier.
 * @param options Optional settings for the exchange.
 * @returns OAuth tokens with ID token, control plane token, and refresh token.
 * @throws TokenExchangeError if the exchange fails.
 */
export async function performFullTokenExchange(
  config: OAuthConfig,
  code: string,
  codeVerifier: string,
  options?: ControlPlaneExchangeOptions & DataPlaneExchangeOptions,
): Promise<OAuthTokens> {
  const now = new Date();

  // Step 1: Exchange authorization code for ID token and refresh token from Auth0
  const idTokenResponse = await exchangeCodeForIdToken(config, code, codeVerifier);

  // Step 2: Exchange ID token for control plane token from CCloud
  const cpTokenResponse = await exchangeIdTokenForControlPlaneToken(
    config.ccloudBaseUri,
    idTokenResponse.idToken,
    { organizationId: options?.organizationId },
  );

  // Step 3: Exchange control plane token for data plane token
  let dataPlaneToken: string | undefined;
  let dataPlaneTokenExpiresAt: Date | undefined;

  try {
    const dpTokenResponse = await exchangeControlPlaneTokenForDataPlaneToken(
      config.ccloudBaseUri,
      cpTokenResponse.token,
      { clusterId: options?.clusterId },
    );
    dataPlaneToken = dpTokenResponse.token;
    dataPlaneTokenExpiresAt = calculateTokenExpiry(TOKEN_LIFETIMES.DATA_PLANE_TOKEN, now);
  } catch {
    // Data plane token is optional - continue without it if exchange fails
  }

  // Use refresh token from control plane response if provided (can be rotated)
  const refreshToken = cpTokenResponse.refreshToken ?? idTokenResponse.refreshToken;

  return {
    idToken: idTokenResponse.idToken,
    controlPlaneToken: cpTokenResponse.token,
    dataPlaneToken,
    refreshToken,
    idTokenExpiresAt: calculateTokenExpiry(TOKEN_LIFETIMES.ID_TOKEN, now),
    controlPlaneTokenExpiresAt: calculateTokenExpiry(TOKEN_LIFETIMES.CONTROL_PLANE_TOKEN, now),
    dataPlaneTokenExpiresAt,
    refreshTokenExpiresAt: calculateTokenExpiry(TOKEN_LIFETIMES.REFRESH_TOKEN_ABSOLUTE, now),
  };
}

/**
 * Performs a token refresh and returns updated tokens.
 *
 * @param config OAuth configuration.
 * @param currentTokens Current token set with refresh token.
 * @param options Optional settings for the exchange.
 * @returns Updated OAuth tokens.
 * @throws TokenExchangeError if refresh fails.
 */
export async function performTokenRefresh(
  config: OAuthConfig,
  currentTokens: OAuthTokens,
  options?: ControlPlaneExchangeOptions & DataPlaneExchangeOptions,
): Promise<OAuthTokens> {
  const now = new Date();

  // Step 1: Refresh to get new ID token
  const refreshResponse = await refreshTokens(config, currentTokens.refreshToken);

  // Step 2: Exchange new ID token for control plane token
  // Note: Sessions endpoint is on ccloudBaseUri, not controlPlaneUri
  const cpTokenResponse = await exchangeIdTokenForControlPlaneToken(
    config.ccloudBaseUri,
    refreshResponse.idToken,
    { organizationId: options?.organizationId },
  );

  // Step 3: Optionally refresh data plane token
  let dataPlaneToken: string | undefined;
  let dataPlaneTokenExpiresAt: Date | undefined;

  if (currentTokens.dataPlaneToken || options?.clusterId) {
    try {
      // Note: Access tokens endpoint is on ccloudBaseUri, not controlPlaneUri
      const dpTokenResponse = await exchangeControlPlaneTokenForDataPlaneToken(
        config.ccloudBaseUri,
        cpTokenResponse.token,
        { clusterId: options?.clusterId },
      );
      dataPlaneToken = dpTokenResponse.token;
      dataPlaneTokenExpiresAt = calculateTokenExpiry(TOKEN_LIFETIMES.DATA_PLANE_TOKEN, now);
    } catch {
      // Data plane token refresh is optional
    }
  }

  return {
    idToken: refreshResponse.idToken,
    controlPlaneToken: cpTokenResponse.token,
    dataPlaneToken,
    refreshToken: refreshResponse.refreshToken ?? currentTokens.refreshToken,
    idTokenExpiresAt: calculateTokenExpiry(TOKEN_LIFETIMES.ID_TOKEN, now),
    controlPlaneTokenExpiresAt: calculateTokenExpiry(TOKEN_LIFETIMES.CONTROL_PLANE_TOKEN, now),
    dataPlaneTokenExpiresAt,
    // Keep original refresh token expiry - it's an absolute timeout
    refreshTokenExpiresAt: currentTokens.refreshTokenExpiresAt,
  };
}

/**
 * Parses an error response body.
 */
async function parseErrorResponse(response: Response): Promise<OAuthError | undefined> {
  try {
    const body = await response.json();
    if (isOAuthError(body)) {
      return body;
    }

    // Handle different error formats from different endpoints
    if (body.error || body.message) {
      return {
        error: body.error ?? "unknown_error",
        errorDescription: body.error_description ?? body.message,
      };
    }
  } catch {
    // Body wasn't JSON
  }

  return undefined;
}

/**
 * Extracts the auth token from the response.
 * The token may be in the response body or cookies.
 */
function extractAuthTokenFromResponse(response: Response, data: Record<string, unknown>): string {
  // First check response body
  if (data.token) {
    return data.token as string;
  }
  if (data.auth_token) {
    return data.auth_token as string;
  }

  // Check for auth_token in cookies (would need server-side handling)
  // For browser/Node.js fetch, cookies are handled by the runtime
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    const authTokenMatch = setCookie.match(/auth_token=([^;]+)/);
    if (authTokenMatch) {
      return authTokenMatch[1];
    }
  }

  throw new TokenExchangeError("No auth token found in response");
}
