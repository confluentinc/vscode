import * as assert from "assert";
import {
  CCloudEnvironment,
  TOKEN_LIFETIMES,
  OAUTH_CONSTANTS,
  CALLBACK_URIS,
  CONTROL_PLANE_ENDPOINTS,
  getOAuthConfig,
  detectEnvironment,
  calculateTokenExpiry,
  isTokenExpiring,
  getTimeUntilExpiry,
} from "./config";

describe("auth/oauth2/config", function () {
  describe("TOKEN_LIFETIMES", function () {
    it("should have correct ID token lifetime (60 seconds)", function () {
      assert.strictEqual(TOKEN_LIFETIMES.ID_TOKEN, 60);
    });

    it("should have correct control plane token lifetime (300 seconds)", function () {
      assert.strictEqual(TOKEN_LIFETIMES.CONTROL_PLANE_TOKEN, 300);
    });

    it("should have correct data plane token lifetime (300 seconds)", function () {
      assert.strictEqual(TOKEN_LIFETIMES.DATA_PLANE_TOKEN, 300);
    });

    it("should have correct refresh token lifetime (28800 seconds = 8 hours)", function () {
      assert.strictEqual(TOKEN_LIFETIMES.REFRESH_TOKEN_ABSOLUTE, 28800);
    });
  });

  describe("OAUTH_CONSTANTS", function () {
    it("should have max refresh attempts of 50", function () {
      assert.strictEqual(OAUTH_CONSTANTS.MAX_REFRESH_ATTEMPTS, 50);
    });

    it("should have code verifier length of 32 bytes", function () {
      assert.strictEqual(OAUTH_CONSTANTS.CODE_VERIFIER_LENGTH, 32);
    });

    it("should have state length of 32 bytes", function () {
      assert.strictEqual(OAUTH_CONSTANTS.STATE_LENGTH, 32);
    });

    it("should use S256 code challenge method", function () {
      assert.strictEqual(OAUTH_CONSTANTS.CODE_CHALLENGE_METHOD, "S256");
    });

    it("should have correct OAuth scope", function () {
      assert.strictEqual(OAUTH_CONSTANTS.OAUTH_SCOPE, "email openid offline_access");
    });

    it("should use port 26636 for callback server", function () {
      assert.strictEqual(OAUTH_CONSTANTS.CALLBACK_SERVER_PORT, 26636);
    });
  });

  describe("CALLBACK_URIS", function () {
    it("should have VS Code URI handler", function () {
      assert.strictEqual(
        CALLBACK_URIS.VSCODE_URI,
        "vscode://confluentinc.vscode-confluent/authCallback",
      );
    });

    it("should have local server URI on port 26636", function () {
      assert.ok(CALLBACK_URIS.LOCAL_SERVER.includes("127.0.0.1:26636"));
      assert.ok(CALLBACK_URIS.LOCAL_SERVER.includes("callback-vscode-docs"));
    });
  });

  describe("CONTROL_PLANE_ENDPOINTS", function () {
    it("should have sessions endpoint", function () {
      assert.strictEqual(CONTROL_PLANE_ENDPOINTS.SESSIONS, "/api/sessions");
    });

    it("should have check JWT endpoint", function () {
      assert.strictEqual(CONTROL_PLANE_ENDPOINTS.CHECK_JWT, "/api/check_jwt");
    });

    it("should have access tokens endpoint", function () {
      assert.strictEqual(CONTROL_PLANE_ENDPOINTS.ACCESS_TOKENS, "/api/access_tokens");
    });
  });

  describe("getOAuthConfig()", function () {
    it("should return production config by default", function () {
      const config = getOAuthConfig();

      assert.ok(config.authorizeUri.includes("login.confluent.io"));
      assert.ok(config.tokenUri.includes("login.confluent.io"));
      assert.ok(config.controlPlaneUri.includes("api.confluent.cloud"));
      assert.ok(config.clientId.length > 0);
    });

    it("should return production config for PRODUCTION environment", function () {
      const config = getOAuthConfig(CCloudEnvironment.PRODUCTION);

      assert.strictEqual(config.authorizeUri, "https://login.confluent.io/oauth/authorize");
      assert.strictEqual(config.tokenUri, "https://login.confluent.io/oauth/token");
      assert.strictEqual(config.controlPlaneUri, "https://api.confluent.cloud");
    });

    it("should return staging config for STAGING environment", function () {
      const config = getOAuthConfig(CCloudEnvironment.STAGING);

      assert.ok(config.authorizeUri.includes("stag"));
      assert.ok(config.tokenUri.includes("stag"));
      assert.ok(config.controlPlaneUri.includes("stag"));
    });

    it("should return development config for DEVELOPMENT environment", function () {
      const config = getOAuthConfig(CCloudEnvironment.DEVELOPMENT);

      assert.ok(config.authorizeUri.includes("confluent-dev.io"));
      assert.ok(config.controlPlaneUri.includes("devel"));
    });

    it("should use VS Code URI by default", function () {
      const config = getOAuthConfig(CCloudEnvironment.PRODUCTION, true);

      assert.strictEqual(config.redirectUri, CALLBACK_URIS.VSCODE_URI);
    });

    it("should use local server URI when requested", function () {
      const config = getOAuthConfig(CCloudEnvironment.PRODUCTION, false);

      assert.strictEqual(config.redirectUri, CALLBACK_URIS.LOCAL_SERVER);
    });

    it("should have correct OAuth scope", function () {
      const config = getOAuthConfig();

      assert.strictEqual(config.scope, "email openid offline_access");
    });
  });

  describe("detectEnvironment()", function () {
    it("should return PRODUCTION for undefined", function () {
      assert.strictEqual(detectEnvironment(undefined), CCloudEnvironment.PRODUCTION);
    });

    it("should return PRODUCTION for empty string", function () {
      assert.strictEqual(detectEnvironment(""), CCloudEnvironment.PRODUCTION);
    });

    it("should return PRODUCTION for confluent.cloud", function () {
      assert.strictEqual(detectEnvironment("confluent.cloud"), CCloudEnvironment.PRODUCTION);
    });

    it("should return STAGING for stag in path", function () {
      assert.strictEqual(detectEnvironment("stag.cpdev.cloud"), CCloudEnvironment.STAGING);
    });

    it("should return STAGING for staging in path", function () {
      assert.strictEqual(detectEnvironment("staging.example.com"), CCloudEnvironment.STAGING);
    });

    it("should return DEVELOPMENT for devel in path", function () {
      assert.strictEqual(detectEnvironment("devel.cpdev.cloud"), CCloudEnvironment.DEVELOPMENT);
    });

    it("should return DEVELOPMENT for dev in path", function () {
      assert.strictEqual(detectEnvironment("dev.example.com"), CCloudEnvironment.DEVELOPMENT);
    });

    it("should be case insensitive", function () {
      assert.strictEqual(detectEnvironment("STAG.CPDEV.CLOUD"), CCloudEnvironment.STAGING);
      assert.strictEqual(detectEnvironment("DEVEL.CPDEV.CLOUD"), CCloudEnvironment.DEVELOPMENT);
    });
  });

  describe("calculateTokenExpiry()", function () {
    it("should calculate expiry from now by default", function () {
      const before = Date.now();
      const expiry = calculateTokenExpiry(60);
      const after = Date.now();

      assert.ok(expiry.getTime() >= before + 60000);
      assert.ok(expiry.getTime() <= after + 60000);
    });

    it("should calculate expiry from specified date", function () {
      const baseDate = new Date("2024-01-01T00:00:00Z");
      const expiry = calculateTokenExpiry(3600, baseDate);

      assert.strictEqual(expiry.getTime(), baseDate.getTime() + 3600000);
    });

    it("should handle zero lifetime", function () {
      const baseDate = new Date("2024-01-01T00:00:00Z");
      const expiry = calculateTokenExpiry(0, baseDate);

      assert.strictEqual(expiry.getTime(), baseDate.getTime());
    });
  });

  describe("isTokenExpiring()", function () {
    it("should return true for already expired token", function () {
      const expired = new Date(Date.now() - 1000);

      assert.strictEqual(isTokenExpiring(expired), true);
    });

    it("should return true for token expiring within buffer", function () {
      const expiringSoon = new Date(Date.now() + 10000); // 10 seconds from now
      const bufferMs = 30000; // 30 second buffer

      assert.strictEqual(isTokenExpiring(expiringSoon, bufferMs), true);
    });

    it("should return false for token not expiring soon", function () {
      const expiresLater = new Date(Date.now() + 300000); // 5 minutes from now
      const bufferMs = 30000; // 30 second buffer

      assert.strictEqual(isTokenExpiring(expiresLater, bufferMs), false);
    });

    it("should use default buffer of 30 seconds", function () {
      const expiresIn25Seconds = new Date(Date.now() + 25000);
      const expiresIn35Seconds = new Date(Date.now() + 35000);

      assert.strictEqual(isTokenExpiring(expiresIn25Seconds), true);
      assert.strictEqual(isTokenExpiring(expiresIn35Seconds), false);
    });
  });

  describe("getTimeUntilExpiry()", function () {
    it("should return positive for future expiry", function () {
      const futureExpiry = new Date(Date.now() + 60000);
      const timeUntil = getTimeUntilExpiry(futureExpiry);

      assert.ok(timeUntil > 0);
      assert.ok(timeUntil <= 60000);
    });

    it("should return negative for past expiry", function () {
      const pastExpiry = new Date(Date.now() - 60000);
      const timeUntil = getTimeUntilExpiry(pastExpiry);

      assert.ok(timeUntil < 0);
    });

    it("should return approximately zero for now", function () {
      const now = new Date();
      const timeUntil = getTimeUntilExpiry(now);

      assert.ok(Math.abs(timeUntil) < 100); // Within 100ms tolerance
    });
  });
});
