import * as assert from "assert";
import * as sinon from "sinon";
import {
  exchangeCodeForIdToken,
  exchangeIdTokenForControlPlaneToken,
  exchangeControlPlaneTokenForDataPlaneToken,
  refreshTokens,
  performFullTokenExchange,
  performTokenRefresh,
  TokenExchangeError,
} from "./tokenExchange";
import { getOAuthConfig, CCloudEnvironment, TOKEN_LIFETIMES } from "./config";
import type { OAuthConfig, OAuthTokens } from "./types";

describe("auth/oauth2/tokenExchange", function () {
  let config: OAuthConfig;
  let fetchStub: sinon.SinonStub;

  function mockFetchResponse(data: unknown, status = 200, headers?: HeadersInit): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Error",
      json: () => Promise.resolve(data),
      headers: new Headers(headers),
    } as Response;
  }

  function createValidTokens(): OAuthTokens {
    const now = new Date();
    return {
      idToken: "test-id-token",
      controlPlaneToken: "test-cp-token",
      dataPlaneToken: "test-dp-token",
      refreshToken: "test-refresh-token",
      idTokenExpiresAt: new Date(now.getTime() + TOKEN_LIFETIMES.ID_TOKEN * 1000),
      controlPlaneTokenExpiresAt: new Date(
        now.getTime() + TOKEN_LIFETIMES.CONTROL_PLANE_TOKEN * 1000,
      ),
      dataPlaneTokenExpiresAt: new Date(now.getTime() + TOKEN_LIFETIMES.DATA_PLANE_TOKEN * 1000),
      refreshTokenExpiresAt: new Date(
        now.getTime() + TOKEN_LIFETIMES.REFRESH_TOKEN_ABSOLUTE * 1000,
      ),
    };
  }

  beforeEach(function () {
    config = getOAuthConfig(CCloudEnvironment.PRODUCTION);
    fetchStub = sinon.stub(globalThis, "fetch");
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("TokenExchangeError", function () {
    it("should create error with message", function () {
      const error = new TokenExchangeError("test error");

      assert.strictEqual(error.message, "test error");
      assert.strictEqual(error.name, "TokenExchangeError");
    });

    it("should include OAuth error details", function () {
      const oauthError = { error: "invalid_grant", errorDescription: "Code expired" };
      const error = new TokenExchangeError("test error", oauthError, 400);

      assert.deepStrictEqual(error.oauthError, oauthError);
      assert.strictEqual(error.statusCode, 400);
    });
  });

  describe("exchangeCodeForIdToken()", function () {
    it("should exchange code for tokens", async function () {
      const mockResponse = {
        access_token: "access-token",
        refresh_token: "refresh-token",
        id_token: "id-token",
        scope: "openid email",
        expires_in: 60,
        token_type: "Bearer",
      };
      fetchStub.resolves(mockFetchResponse(mockResponse));

      const result = await exchangeCodeForIdToken(config, "auth-code", "code-verifier");

      assert.strictEqual(result.idToken, "id-token");
      assert.strictEqual(result.refreshToken, "refresh-token");
      assert.strictEqual(result.accessToken, "access-token");
      assert.strictEqual(result.tokenType, "Bearer");
    });

    it("should call token endpoint with correct parameters", async function () {
      fetchStub.resolves(mockFetchResponse({ id_token: "token" }));

      await exchangeCodeForIdToken(config, "auth-code", "code-verifier");

      assert.ok(fetchStub.calledOnce);
      const [url, options] = fetchStub.firstCall.args;
      assert.strictEqual(url, config.tokenUri);
      assert.strictEqual(options.method, "POST");
      assert.ok(options.body.includes("grant_type=authorization_code"));
      assert.ok(options.body.includes("code=auth-code"));
      assert.ok(options.body.includes("code_verifier=code-verifier"));
    });

    it("should throw TokenExchangeError on failure", async function () {
      const errorResponse = { error: "invalid_grant", error_description: "Code expired" };
      fetchStub.resolves(mockFetchResponse(errorResponse, 400));

      await assert.rejects(
        () => exchangeCodeForIdToken(config, "bad-code", "verifier"),
        TokenExchangeError,
      );
    });

    it("should include OAuth error in exception", async function () {
      const errorResponse = { error: "invalid_grant", error_description: "Code expired" };
      fetchStub.resolves(mockFetchResponse(errorResponse, 400));

      try {
        await exchangeCodeForIdToken(config, "bad-code", "verifier");
        assert.fail("Should have thrown");
      } catch (error) {
        assert.ok(error instanceof TokenExchangeError);
        assert.strictEqual(error.oauthError?.error, "invalid_grant");
        assert.strictEqual(error.statusCode, 400);
      }
    });
  });

  describe("exchangeIdTokenForControlPlaneToken()", function () {
    it("should exchange ID token for control plane token", async function () {
      const mockResponse = {
        token: "cp-token",
        user: {
          resource_id: "user-123",
          email: "test@example.com",
          first_name: "Test",
          last_name: "User",
        },
        account: {
          resource_id: "org-456",
          name: "Test Org",
        },
      };
      fetchStub.resolves(mockFetchResponse(mockResponse));

      const result = await exchangeIdTokenForControlPlaneToken(config.ccloudBaseUri, "id-token");

      assert.strictEqual(result.token, "cp-token");
      assert.strictEqual(result.user.id, "user-123");
      assert.strictEqual(result.user.email, "test@example.com");
      assert.strictEqual(result.organization?.id, "org-456");
    });

    it("should include organization ID when provided", async function () {
      fetchStub.resolves(mockFetchResponse({ token: "token", user: {} }));

      await exchangeIdTokenForControlPlaneToken(config.ccloudBaseUri, "id-token", {
        organizationId: "org-123",
      });

      const [, options] = fetchStub.firstCall.args;
      const body = JSON.parse(options.body);
      assert.strictEqual(body.org_resource_id, "org-123");
    });

    it("should call sessions endpoint", async function () {
      fetchStub.resolves(mockFetchResponse({ token: "token", user: {} }));

      await exchangeIdTokenForControlPlaneToken(config.ccloudBaseUri, "id-token");

      const [url] = fetchStub.firstCall.args;
      assert.ok(url.includes("/api/sessions"));
    });

    it("should throw TokenExchangeError on failure", async function () {
      fetchStub.resolves(mockFetchResponse({ error: "unauthorized" }, 401));

      await assert.rejects(
        () => exchangeIdTokenForControlPlaneToken(config.ccloudBaseUri, "bad-token"),
        TokenExchangeError,
      );
    });

    it("should extract token from auth_token field", async function () {
      const mockResponse = { auth_token: "auth-cp-token", user: {} };
      fetchStub.resolves(mockFetchResponse(mockResponse));

      const result = await exchangeIdTokenForControlPlaneToken(config.ccloudBaseUri, "id-token");

      assert.strictEqual(result.token, "auth-cp-token");
    });
  });

  describe("exchangeControlPlaneTokenForDataPlaneToken()", function () {
    it("should exchange control plane token for data plane token", async function () {
      const mockResponse = { token: "dp-token" };
      fetchStub.resolves(mockFetchResponse(mockResponse));

      const result = await exchangeControlPlaneTokenForDataPlaneToken(
        config.ccloudBaseUri,
        "cp-token",
      );

      assert.strictEqual(result.token, "dp-token");
    });

    it("should include cluster ID when provided", async function () {
      fetchStub.resolves(mockFetchResponse({ token: "token" }));

      await exchangeControlPlaneTokenForDataPlaneToken(config.ccloudBaseUri, "cp-token", {
        clusterId: "lkc-12345",
      });

      const [, options] = fetchStub.firstCall.args;
      const body = JSON.parse(options.body);
      assert.strictEqual(body.cluster_id, "lkc-12345");
    });

    it("should include authorization header", async function () {
      fetchStub.resolves(mockFetchResponse({ token: "token" }));

      await exchangeControlPlaneTokenForDataPlaneToken(config.ccloudBaseUri, "cp-token");

      const [, options] = fetchStub.firstCall.args;
      assert.strictEqual(options.headers.Authorization, "Bearer cp-token");
    });

    it("should call access_tokens endpoint", async function () {
      fetchStub.resolves(mockFetchResponse({ token: "token" }));

      await exchangeControlPlaneTokenForDataPlaneToken(config.ccloudBaseUri, "cp-token");

      const [url] = fetchStub.firstCall.args;
      assert.ok(url.includes("/api/access_tokens"));
    });

    it("should handle access_token field in response", async function () {
      const mockResponse = { access_token: "access-dp-token" };
      fetchStub.resolves(mockFetchResponse(mockResponse));

      const result = await exchangeControlPlaneTokenForDataPlaneToken(
        config.ccloudBaseUri,
        "cp-token",
      );

      assert.strictEqual(result.token, "access-dp-token");
    });

    it("should include regional token when present", async function () {
      const mockResponse = { token: "dp-token", regional_token: "regional-token" };
      fetchStub.resolves(mockFetchResponse(mockResponse));

      const result = await exchangeControlPlaneTokenForDataPlaneToken(
        config.ccloudBaseUri,
        "cp-token",
      );

      assert.strictEqual(result.regionalToken, "regional-token");
    });

    it("should throw TokenExchangeError on failure", async function () {
      fetchStub.resolves(mockFetchResponse({ error: "forbidden" }, 403));

      await assert.rejects(
        () => exchangeControlPlaneTokenForDataPlaneToken(config.ccloudBaseUri, "bad-token"),
        TokenExchangeError,
      );
    });
  });

  describe("refreshTokens()", function () {
    it("should refresh tokens", async function () {
      const mockResponse = {
        access_token: "new-access",
        refresh_token: "new-refresh",
        id_token: "new-id-token",
        expires_in: 60,
        token_type: "Bearer",
      };
      fetchStub.resolves(mockFetchResponse(mockResponse));

      const result = await refreshTokens(config, "old-refresh-token");

      assert.strictEqual(result.idToken, "new-id-token");
      assert.strictEqual(result.refreshToken, "new-refresh");
      assert.strictEqual(result.accessToken, "new-access");
    });

    it("should call token endpoint with refresh_token grant", async function () {
      fetchStub.resolves(mockFetchResponse({ id_token: "token" }));

      await refreshTokens(config, "refresh-token");

      const [url, options] = fetchStub.firstCall.args;
      assert.strictEqual(url, config.tokenUri);
      assert.ok(options.body.includes("grant_type=refresh_token"));
      assert.ok(options.body.includes("refresh_token=refresh-token"));
    });

    it("should throw TokenExchangeError on failure", async function () {
      fetchStub.resolves(mockFetchResponse({ error: "invalid_grant" }, 400));

      await assert.rejects(() => refreshTokens(config, "expired-token"), TokenExchangeError);
    });
  });

  describe("performFullTokenExchange()", function () {
    it("should perform complete token exchange flow", async function () {
      // Mock all three exchange calls
      fetchStub
        .onCall(0)
        .resolves(
          mockFetchResponse({
            id_token: "id-token",
            refresh_token: "refresh-token",
            access_token: "access",
            expires_in: 60,
          }),
        )
        .onCall(1)
        .resolves(
          mockFetchResponse({
            token: "cp-token",
            user: { resource_id: "user-1", email: "test@example.com" },
          }),
        )
        .onCall(2)
        .resolves(mockFetchResponse({ token: "dp-token" }));

      const result = await performFullTokenExchange(config, "auth-code", "code-verifier");

      assert.strictEqual(result.idToken, "id-token");
      assert.strictEqual(result.controlPlaneToken, "cp-token");
      assert.strictEqual(result.dataPlaneToken, "dp-token");
      assert.strictEqual(result.refreshToken, "refresh-token");
      assert.ok(result.idTokenExpiresAt instanceof Date);
      assert.ok(result.controlPlaneTokenExpiresAt instanceof Date);
      assert.ok(result.dataPlaneTokenExpiresAt instanceof Date);
      assert.ok(result.refreshTokenExpiresAt instanceof Date);
    });

    it("should continue without data plane token on failure", async function () {
      fetchStub
        .onCall(0)
        .resolves(mockFetchResponse({ id_token: "id-token", refresh_token: "refresh-token" }))
        .onCall(1)
        .resolves(mockFetchResponse({ token: "cp-token", user: {} }))
        .onCall(2)
        .resolves(mockFetchResponse({ error: "forbidden" }, 403));

      const result = await performFullTokenExchange(config, "auth-code", "code-verifier");

      assert.strictEqual(result.idToken, "id-token");
      assert.strictEqual(result.controlPlaneToken, "cp-token");
      assert.strictEqual(result.dataPlaneToken, undefined);
      assert.strictEqual(result.dataPlaneTokenExpiresAt, undefined);
    });

    it("should pass organization ID to control plane exchange", async function () {
      fetchStub
        .onCall(0)
        .resolves(mockFetchResponse({ id_token: "token", refresh_token: "refresh" }))
        .onCall(1)
        .resolves(mockFetchResponse({ token: "cp-token", user: {} }))
        .onCall(2)
        .resolves(mockFetchResponse({ token: "dp-token" }));

      await performFullTokenExchange(config, "code", "verifier", { organizationId: "org-123" });

      const [, cpOptions] = fetchStub.secondCall.args;
      const body = JSON.parse(cpOptions.body);
      assert.strictEqual(body.org_resource_id, "org-123");
    });

    it("should throw if ID token exchange fails", async function () {
      fetchStub.resolves(mockFetchResponse({ error: "invalid_code" }, 400));

      await assert.rejects(
        () => performFullTokenExchange(config, "bad-code", "verifier"),
        TokenExchangeError,
      );
    });

    it("should throw if control plane exchange fails", async function () {
      fetchStub
        .onCall(0)
        .resolves(mockFetchResponse({ id_token: "token", refresh_token: "refresh" }))
        .onCall(1)
        .resolves(mockFetchResponse({ error: "unauthorized" }, 401));

      await assert.rejects(
        () => performFullTokenExchange(config, "code", "verifier"),
        TokenExchangeError,
      );
    });

    it("should use refresh token from control plane response if provided", async function () {
      fetchStub
        .onCall(0)
        .resolves(
          mockFetchResponse({
            id_token: "id-token",
            refresh_token: "original-refresh",
          }),
        )
        .onCall(1)
        .resolves(
          mockFetchResponse({
            token: "cp-token",
            user: {},
            refresh_token: "new-refresh",
          }),
        )
        .onCall(2)
        .resolves(mockFetchResponse({ token: "dp-token" }));

      const result = await performFullTokenExchange(config, "code", "verifier");

      assert.strictEqual(result.refreshToken, "new-refresh");
    });
  });

  describe("performTokenRefresh()", function () {
    it("should refresh all tokens", async function () {
      const currentTokens = createValidTokens();

      fetchStub
        .onCall(0)
        .resolves(
          mockFetchResponse({
            id_token: "new-id-token",
            refresh_token: "new-refresh",
            access_token: "access",
          }),
        )
        .onCall(1)
        .resolves(mockFetchResponse({ token: "new-cp-token", user: {} }))
        .onCall(2)
        .resolves(mockFetchResponse({ token: "new-dp-token" }));

      const result = await performTokenRefresh(config, currentTokens);

      assert.strictEqual(result.idToken, "new-id-token");
      assert.strictEqual(result.controlPlaneToken, "new-cp-token");
      assert.strictEqual(result.dataPlaneToken, "new-dp-token");
    });

    it("should preserve original refresh token expiry", async function () {
      const currentTokens = createValidTokens();
      const originalRefreshExpiry = currentTokens.refreshTokenExpiresAt;

      fetchStub
        .onCall(0)
        .resolves(mockFetchResponse({ id_token: "token", refresh_token: "refresh" }))
        .onCall(1)
        .resolves(mockFetchResponse({ token: "cp-token", user: {} }))
        .onCall(2)
        .resolves(mockFetchResponse({ token: "dp-token" }));

      const result = await performTokenRefresh(config, currentTokens);

      assert.strictEqual(result.refreshTokenExpiresAt.getTime(), originalRefreshExpiry.getTime());
    });

    it("should skip data plane refresh if not needed", async function () {
      const currentTokens = createValidTokens();
      delete currentTokens.dataPlaneToken;
      delete currentTokens.dataPlaneTokenExpiresAt;

      fetchStub
        .onCall(0)
        .resolves(mockFetchResponse({ id_token: "token" }))
        .onCall(1)
        .resolves(mockFetchResponse({ token: "cp-token", user: {} }));

      const result = await performTokenRefresh(config, currentTokens);

      assert.strictEqual(fetchStub.callCount, 2);
      assert.strictEqual(result.dataPlaneToken, undefined);
    });

    it("should continue if data plane refresh fails", async function () {
      const currentTokens = createValidTokens();

      fetchStub
        .onCall(0)
        .resolves(mockFetchResponse({ id_token: "token" }))
        .onCall(1)
        .resolves(mockFetchResponse({ token: "cp-token", user: {} }))
        .onCall(2)
        .resolves(mockFetchResponse({ error: "forbidden" }, 403));

      const result = await performTokenRefresh(config, currentTokens);

      assert.strictEqual(result.idToken, "token");
      assert.strictEqual(result.controlPlaneToken, "cp-token");
      assert.strictEqual(result.dataPlaneToken, undefined);
    });

    it("should keep existing refresh token if none returned", async function () {
      const currentTokens = createValidTokens();

      fetchStub
        .onCall(0)
        .resolves(mockFetchResponse({ id_token: "token" })) // No refresh_token
        .onCall(1)
        .resolves(mockFetchResponse({ token: "cp-token", user: {} }));

      const result = await performTokenRefresh(config, currentTokens);

      assert.strictEqual(result.refreshToken, currentTokens.refreshToken);
    });
  });
});
