import * as assert from "assert";
import {
  generateRandomString,
  base64UrlEncode,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generatePKCEParams,
  buildAuthorizationUrl,
  verifyCodeChallenge,
  validateState,
} from "./pkce";
import { OAUTH_CONSTANTS, getOAuthConfig, CCloudEnvironment } from "./config";
import type { PKCEParams } from "./types";

describe("authn/oauth2/pkce", function () {
  describe("base64UrlEncode()", function () {
    it("should encode buffer to base64url format", function () {
      const buffer = Buffer.from("hello world");
      const encoded = base64UrlEncode(buffer);

      // Should not contain + or / or =
      assert.ok(!encoded.includes("+"));
      assert.ok(!encoded.includes("/"));
      assert.ok(!encoded.includes("="));
    });

    it("should produce URL-safe characters only", function () {
      // Test with bytes that would produce + and / in standard base64
      const buffer = Buffer.from([0xfb, 0xff, 0xfe]); // Would produce +/+= in standard base64
      const encoded = base64UrlEncode(buffer);

      // Should only contain alphanumeric, -, and _
      assert.ok(/^[A-Za-z0-9_-]+$/.test(encoded));
    });

    it("should encode empty buffer to empty string", function () {
      const encoded = base64UrlEncode(Buffer.from([]));
      assert.strictEqual(encoded, "");
    });
  });

  describe("generateRandomString()", function () {
    it("should generate string of appropriate length", function () {
      const result = generateRandomString(32);
      // Base64 encodes 3 bytes to 4 characters, so 32 bytes -> ~43 chars
      assert.ok(result.length >= 40);
      assert.ok(result.length <= 44);
    });

    it("should generate different strings each time", function () {
      const result1 = generateRandomString(32);
      const result2 = generateRandomString(32);

      assert.notStrictEqual(result1, result2);
    });

    it("should produce URL-safe characters only", function () {
      const result = generateRandomString(64);
      assert.ok(/^[A-Za-z0-9_-]+$/.test(result));
    });

    it("should handle different lengths", function () {
      const short = generateRandomString(8);
      const long = generateRandomString(64);

      assert.ok(short.length < long.length);
    });
  });

  describe("generateCodeVerifier()", function () {
    it("should generate verifier of correct length", function () {
      const verifier = generateCodeVerifier();
      // 32 bytes -> base64url -> ~43 characters
      assert.ok(verifier.length >= 40);
      assert.ok(verifier.length <= 44);
    });

    it("should generate unique verifiers", function () {
      const verifiers = new Set<string>();

      for (let i = 0; i < 100; i++) {
        verifiers.add(generateCodeVerifier());
      }

      assert.strictEqual(verifiers.size, 100);
    });

    it("should produce URL-safe characters only", function () {
      const verifier = generateCodeVerifier();
      assert.ok(/^[A-Za-z0-9_-]+$/.test(verifier));
    });
  });

  describe("generateCodeChallenge()", function () {
    it("should generate challenge from verifier", function () {
      const verifier = "test-verifier-string";
      const challenge = generateCodeChallenge(verifier);

      assert.ok(challenge.length > 0);
      assert.ok(/^[A-Za-z0-9_-]+$/.test(challenge));
    });

    it("should produce consistent challenges for same verifier", function () {
      const verifier = "consistent-verifier";
      const challenge1 = generateCodeChallenge(verifier);
      const challenge2 = generateCodeChallenge(verifier);

      assert.strictEqual(challenge1, challenge2);
    });

    it("should produce different challenges for different verifiers", function () {
      const challenge1 = generateCodeChallenge("verifier-one");
      const challenge2 = generateCodeChallenge("verifier-two");

      assert.notStrictEqual(challenge1, challenge2);
    });

    it("should produce SHA-256 base64url hash (43 characters)", function () {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);

      // SHA-256 produces 32 bytes -> base64url -> 43 characters
      assert.strictEqual(challenge.length, 43);
    });
  });

  describe("generateState()", function () {
    it("should generate state of correct length", function () {
      const state = generateState();
      // 32 bytes -> base64url -> ~43 characters
      assert.ok(state.length >= 40);
      assert.ok(state.length <= 44);
    });

    it("should generate unique states", function () {
      const states = new Set<string>();

      for (let i = 0; i < 100; i++) {
        states.add(generateState());
      }

      assert.strictEqual(states.size, 100);
    });

    it("should produce URL-safe characters only", function () {
      const state = generateState();
      assert.ok(/^[A-Za-z0-9_-]+$/.test(state));
    });
  });

  describe("generatePKCEParams()", function () {
    it("should generate complete PKCE parameters", function () {
      const params = generatePKCEParams();

      assert.ok(params.codeVerifier);
      assert.ok(params.codeChallenge);
      assert.ok(params.state);
      assert.strictEqual(params.codeChallengeMethod, "S256");
    });

    it("should have matching verifier and challenge", function () {
      const params = generatePKCEParams();
      const regeneratedChallenge = generateCodeChallenge(params.codeVerifier);

      assert.strictEqual(params.codeChallenge, regeneratedChallenge);
    });

    it("should use S256 code challenge method", function () {
      const params = generatePKCEParams();

      assert.strictEqual(params.codeChallengeMethod, OAUTH_CONSTANTS.CODE_CHALLENGE_METHOD);
    });

    it("should generate unique parameters each time", function () {
      const params1 = generatePKCEParams();
      const params2 = generatePKCEParams();

      assert.notStrictEqual(params1.codeVerifier, params2.codeVerifier);
      assert.notStrictEqual(params1.codeChallenge, params2.codeChallenge);
      assert.notStrictEqual(params1.state, params2.state);
    });
  });

  describe("buildAuthorizationUrl()", function () {
    const config = getOAuthConfig(CCloudEnvironment.PRODUCTION);
    const pkce: PKCEParams = {
      codeVerifier: "test-verifier",
      codeChallenge: "test-challenge",
      codeChallengeMethod: "S256",
      state: "test-state",
    };

    it("should build URL with correct base", function () {
      const url = buildAuthorizationUrl(config, pkce);

      assert.ok(url.startsWith(config.authorizeUri));
    });

    it("should include response_type=code", function () {
      const url = buildAuthorizationUrl(config, pkce);

      assert.ok(url.includes("response_type=code"));
    });

    it("should include client_id", function () {
      const url = buildAuthorizationUrl(config, pkce);

      assert.ok(url.includes(`client_id=${config.clientId}`));
    });

    it("should include encoded redirect_uri", function () {
      const url = buildAuthorizationUrl(config, pkce);

      assert.ok(url.includes("redirect_uri="));
      // The redirect URI should be encoded
      assert.ok(url.includes(encodeURIComponent(config.redirectUri)));
    });

    it("should include scope", function () {
      const url = buildAuthorizationUrl(config, pkce);

      // Scopes are URL encoded (spaces become +)
      assert.ok(url.includes("scope="));
    });

    it("should include code_challenge", function () {
      const url = buildAuthorizationUrl(config, pkce);

      assert.ok(url.includes(`code_challenge=${pkce.codeChallenge}`));
    });

    it("should include code_challenge_method=S256", function () {
      const url = buildAuthorizationUrl(config, pkce);

      assert.ok(url.includes("code_challenge_method=S256"));
    });

    it("should include state", function () {
      const url = buildAuthorizationUrl(config, pkce);

      assert.ok(url.includes(`state=${pkce.state}`));
    });

    it("should work with different environments", function () {
      const stagingConfig = getOAuthConfig(CCloudEnvironment.STAGING);
      const url = buildAuthorizationUrl(stagingConfig, pkce);

      assert.ok(url.startsWith(stagingConfig.authorizeUri));
      assert.ok(url.includes("stag"));
    });

    it("should produce valid URL", function () {
      const url = buildAuthorizationUrl(config, pkce);
      const parsed = new URL(url);

      assert.strictEqual(parsed.protocol, "https:");
      assert.ok(parsed.searchParams.has("response_type"));
      assert.ok(parsed.searchParams.has("client_id"));
      assert.ok(parsed.searchParams.has("redirect_uri"));
      assert.ok(parsed.searchParams.has("scope"));
      assert.ok(parsed.searchParams.has("code_challenge"));
      assert.ok(parsed.searchParams.has("code_challenge_method"));
      assert.ok(parsed.searchParams.has("state"));
    });
  });

  describe("verifyCodeChallenge()", function () {
    it("should return true for matching verifier and challenge", function () {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);

      assert.strictEqual(verifyCodeChallenge(verifier, challenge), true);
    });

    it("should return false for non-matching verifier and challenge", function () {
      const verifier = generateCodeVerifier();
      const wrongChallenge = generateCodeChallenge("different-verifier");

      assert.strictEqual(verifyCodeChallenge(verifier, wrongChallenge), false);
    });

    it("should verify PKCE params correctly", function () {
      const params = generatePKCEParams();

      assert.strictEqual(verifyCodeChallenge(params.codeVerifier, params.codeChallenge), true);
    });
  });

  describe("validateState()", function () {
    it("should return true for matching states", function () {
      const state = generateState();

      assert.strictEqual(validateState(state, state), true);
    });

    it("should return false for different states", function () {
      const state1 = generateState();
      const state2 = generateState();

      assert.strictEqual(validateState(state1, state2), false);
    });

    it("should return false for different length states", function () {
      const state1 = "short";
      const state2 = "this-is-a-longer-state";

      assert.strictEqual(validateState(state1, state2), false);
    });

    it("should be case sensitive", function () {
      const state = "TestState123";

      assert.strictEqual(validateState(state, "teststate123"), false);
    });

    it("should handle empty strings", function () {
      assert.strictEqual(validateState("", ""), true);
      assert.strictEqual(validateState("", "something"), false);
    });
  });
});
