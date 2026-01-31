import * as assert from "assert";
import { isOAuthError, type OAuthError, type OAuthTokens, type PKCEParams } from "./types";

describe("authn/oauth2/types", function () {
  describe("OAuthTokens interface", function () {
    it("should allow creating valid tokens object", function () {
      const now = new Date();
      const tokens: OAuthTokens = {
        idToken: "id-token-value",
        controlPlaneToken: "cp-token-value",
        dataPlaneToken: "dp-token-value",
        refreshToken: "refresh-token-value",
        idTokenExpiresAt: new Date(now.getTime() + 60000),
        controlPlaneTokenExpiresAt: new Date(now.getTime() + 300000),
        dataPlaneTokenExpiresAt: new Date(now.getTime() + 300000),
        refreshTokenExpiresAt: new Date(now.getTime() + 28800000),
      };

      assert.strictEqual(tokens.idToken, "id-token-value");
      assert.strictEqual(tokens.controlPlaneToken, "cp-token-value");
      assert.strictEqual(tokens.dataPlaneToken, "dp-token-value");
      assert.strictEqual(tokens.refreshToken, "refresh-token-value");
    });

    it("should allow tokens without data plane token", function () {
      const now = new Date();
      const tokens: OAuthTokens = {
        idToken: "id-token-value",
        controlPlaneToken: "cp-token-value",
        refreshToken: "refresh-token-value",
        idTokenExpiresAt: new Date(now.getTime() + 60000),
        controlPlaneTokenExpiresAt: new Date(now.getTime() + 300000),
        refreshTokenExpiresAt: new Date(now.getTime() + 28800000),
      };

      assert.strictEqual(tokens.dataPlaneToken, undefined);
      assert.strictEqual(tokens.dataPlaneTokenExpiresAt, undefined);
    });
  });

  describe("PKCEParams interface", function () {
    it("should allow creating valid PKCE params", function () {
      const pkce: PKCEParams = {
        codeVerifier: "random-verifier-string",
        codeChallenge: "sha256-hash-of-verifier",
        codeChallengeMethod: "S256",
        state: "random-state-string",
      };

      assert.strictEqual(pkce.codeVerifier, "random-verifier-string");
      assert.strictEqual(pkce.codeChallenge, "sha256-hash-of-verifier");
      assert.strictEqual(pkce.codeChallengeMethod, "S256");
      assert.strictEqual(pkce.state, "random-state-string");
    });
  });

  describe("isOAuthError()", function () {
    it("should return true for valid OAuth error", function () {
      const error: OAuthError = {
        error: "access_denied",
        errorDescription: "User denied access",
      };

      assert.strictEqual(isOAuthError(error), true);
    });

    it("should return true for minimal OAuth error", function () {
      const error = { error: "invalid_request" };

      assert.strictEqual(isOAuthError(error), true);
    });

    it("should return true for OAuth error with all fields", function () {
      const error: OAuthError = {
        error: "server_error",
        errorDescription: "Internal server error",
        errorUri: "https://example.com/error",
      };

      assert.strictEqual(isOAuthError(error), true);
    });

    it("should return false for null", function () {
      assert.strictEqual(isOAuthError(null), false);
    });

    it("should return false for undefined", function () {
      assert.strictEqual(isOAuthError(undefined), false);
    });

    it("should return false for string", function () {
      assert.strictEqual(isOAuthError("error"), false);
    });

    it("should return false for number", function () {
      assert.strictEqual(isOAuthError(42), false);
    });

    it("should return false for object without error field", function () {
      assert.strictEqual(isOAuthError({ message: "error" }), false);
    });

    it("should return false for object with non-string error field", function () {
      assert.strictEqual(isOAuthError({ error: 123 }), false);
    });

    it("should return false for empty object", function () {
      assert.strictEqual(isOAuthError({}), false);
    });
  });
});
