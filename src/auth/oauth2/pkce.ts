/**
 * PKCE (Proof Key for Code Exchange) implementation for OAuth2.
 *
 * Provides cryptographic functions for generating code verifiers,
 * code challenges, and state parameters used in the OAuth2 PKCE flow.
 */

import * as crypto from "crypto";
import type { OAuthConfig, PKCEParams } from "./types";
import { OAUTH_CONSTANTS } from "./config";

/**
 * Generates a cryptographically secure random string encoded as base64url.
 * @param lengthBytes The number of random bytes to generate.
 * @returns A base64url-encoded string.
 */
export function generateRandomString(lengthBytes: number): string {
  const buffer = crypto.randomBytes(lengthBytes);
  return base64UrlEncode(buffer);
}

/**
 * Encodes a buffer as base64url (RFC 4648 Section 5).
 * Base64url is URL-safe: uses '-' instead of '+', '_' instead of '/', and no padding.
 * @param buffer The buffer to encode.
 * @returns The base64url-encoded string.
 */
export function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generates a PKCE code verifier.
 * The verifier is a cryptographically random string of the configured length.
 * @returns A base64url-encoded code verifier.
 */
export function generateCodeVerifier(): string {
  return generateRandomString(OAUTH_CONSTANTS.CODE_VERIFIER_LENGTH);
}

/**
 * Generates a PKCE code challenge from a code verifier using SHA-256.
 * @param codeVerifier The code verifier to hash.
 * @returns A base64url-encoded SHA-256 hash of the verifier.
 */
export function generateCodeChallenge(codeVerifier: string): string {
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  return base64UrlEncode(hash);
}

/**
 * Generates a random state parameter for CSRF protection.
 * @returns A base64url-encoded random state string.
 */
export function generateState(): string {
  return generateRandomString(OAUTH_CONSTANTS.STATE_LENGTH);
}

/**
 * Generates complete PKCE parameters for an OAuth2 authorization request.
 * @returns An object containing the code verifier, code challenge, method, and state.
 */
export function generatePKCEParams(): PKCEParams {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: OAUTH_CONSTANTS.CODE_CHALLENGE_METHOD,
    state: generateState(),
  };
}

/**
 * Builds an OAuth2 authorization URL with PKCE parameters.
 * @param config The OAuth configuration containing endpoints and client ID.
 * @param pkce The PKCE parameters to include in the URL.
 * @returns The complete authorization URL.
 */
export function buildAuthorizationUrl(config: OAuthConfig, pkce: PKCEParams): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    code_challenge: pkce.codeChallenge,
    code_challenge_method: pkce.codeChallengeMethod,
    state: pkce.state,
  });

  return `${config.authorizeUri}?${params.toString()}`;
}

/**
 * Verifies that a code challenge matches a code verifier.
 * Used for testing and validation purposes.
 * @param codeVerifier The original code verifier.
 * @param codeChallenge The code challenge to verify.
 * @returns true if the challenge matches the verifier.
 */
export function verifyCodeChallenge(codeVerifier: string, codeChallenge: string): boolean {
  const expectedChallenge = generateCodeChallenge(codeVerifier);
  return expectedChallenge === codeChallenge;
}

/**
 * Validates that a state parameter matches the expected value.
 * Used to prevent CSRF attacks in the OAuth callback.
 * @param receivedState The state received in the callback.
 * @param expectedState The state sent with the authorization request.
 * @returns true if the states match.
 */
export function validateState(receivedState: string, expectedState: string): boolean {
  // Use constant-time comparison to prevent timing attacks
  if (receivedState.length !== expectedState.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(receivedState), Buffer.from(expectedState));
}
