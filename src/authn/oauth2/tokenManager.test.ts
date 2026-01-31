import * as assert from "assert";
import * as sinon from "sinon";
import type * as vscode from "vscode";
import { TokenManager } from "./tokenManager";
import type { OAuthTokens } from "./types";
import { OAUTH_CONSTANTS, TOKEN_LIFETIMES } from "./config";

describe("authn/oauth2/tokenManager", function () {
  let tokenManager: TokenManager;
  let mockSecretStorage: sinon.SinonStubbedInstance<vscode.SecretStorage>;
  let storageData: Map<string, string>;

  function createValidTokens(overrides: Partial<OAuthTokens> = {}): OAuthTokens {
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
      ...overrides,
    };
  }

  beforeEach(function () {
    TokenManager.resetInstance();
    storageData = new Map();

    mockSecretStorage = {
      get: sinon.stub().callsFake((key: string) => Promise.resolve(storageData.get(key))),
      store: sinon.stub().callsFake((key: string, value: string) => {
        storageData.set(key, value);
        return Promise.resolve();
      }),
      delete: sinon.stub().callsFake((key: string) => {
        storageData.delete(key);
        return Promise.resolve();
      }),
      onDidChange: sinon.stub(),
    } as unknown as sinon.SinonStubbedInstance<vscode.SecretStorage>;

    tokenManager = TokenManager.getInstance();
  });

  afterEach(function () {
    TokenManager.resetInstance();
    sinon.restore();
  });

  describe("getInstance()", function () {
    it("should return singleton instance", function () {
      const instance1 = TokenManager.getInstance();
      const instance2 = TokenManager.getInstance();

      assert.strictEqual(instance1, instance2);
    });

    it("should return new instance after reset", function () {
      const instance1 = TokenManager.getInstance();
      TokenManager.resetInstance();
      const instance2 = TokenManager.getInstance();

      assert.notStrictEqual(instance1, instance2);
    });
  });

  describe("initialize()", function () {
    it("should set secret storage", async function () {
      await tokenManager.initialize(mockSecretStorage);

      // Should have attempted to load existing tokens
      assert.ok(mockSecretStorage.get.calledOnce);
    });

    it("should load existing tokens from storage", async function () {
      const tokens = createValidTokens();
      const serialized = {
        idToken: tokens.idToken,
        controlPlaneToken: tokens.controlPlaneToken,
        dataPlaneToken: tokens.dataPlaneToken,
        refreshToken: tokens.refreshToken,
        idTokenExpiresAt: tokens.idTokenExpiresAt.toISOString(),
        controlPlaneTokenExpiresAt: tokens.controlPlaneTokenExpiresAt!.toISOString(),
        dataPlaneTokenExpiresAt: tokens.dataPlaneTokenExpiresAt!.toISOString(),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      };
      storageData.set("confluent.oauth.tokens", JSON.stringify(serialized));

      await tokenManager.initialize(mockSecretStorage);

      const loaded = await tokenManager.getTokens();
      assert.strictEqual(loaded?.idToken, tokens.idToken);
      assert.strictEqual(loaded?.controlPlaneToken, tokens.controlPlaneToken);
    });
  });

  describe("storeTokens()", function () {
    beforeEach(async function () {
      await tokenManager.initialize(mockSecretStorage);
    });

    it("should store tokens in secret storage", async function () {
      const tokens = createValidTokens();

      await tokenManager.storeTokens(tokens);

      assert.ok(mockSecretStorage.store.calledOnce);
      const stored = storageData.get("confluent.oauth.tokens");
      assert.ok(stored);
    });

    it("should emit onTokensUpdated event", async function () {
      const tokens = createValidTokens();
      let eventFired = false;

      tokenManager.onTokensUpdated(() => {
        eventFired = true;
      });

      await tokenManager.storeTokens(tokens);

      assert.strictEqual(eventFired, true);
    });

    it("should reset refresh attempts", async function () {
      const tokens = createValidTokens();

      tokenManager.incrementRefreshAttempts();
      tokenManager.incrementRefreshAttempts();
      assert.strictEqual(tokenManager.getRefreshAttempts(), 2);

      await tokenManager.storeTokens(tokens);

      assert.strictEqual(tokenManager.getRefreshAttempts(), 0);
    });

    it("should throw if not initialized", async function () {
      TokenManager.resetInstance();
      const uninitializedManager = TokenManager.getInstance();
      const tokens = createValidTokens();

      await assert.rejects(
        () => uninitializedManager.storeTokens(tokens),
        /TokenManager not initialized/,
      );
    });
  });

  describe("getTokens()", function () {
    beforeEach(async function () {
      await tokenManager.initialize(mockSecretStorage);
    });

    it("should return null when no tokens stored", async function () {
      const tokens = await tokenManager.getTokens();

      assert.strictEqual(tokens, null);
    });

    it("should return stored tokens", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);

      const retrieved = await tokenManager.getTokens();

      assert.strictEqual(retrieved?.idToken, tokens.idToken);
      assert.strictEqual(retrieved?.refreshToken, tokens.refreshToken);
    });

    it("should return cached tokens on subsequent calls", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);

      await tokenManager.getTokens();
      await tokenManager.getTokens();

      // Second call should not hit storage again
      assert.strictEqual(mockSecretStorage.get.callCount, 1); // Only during initialize
    });
  });

  describe("clearTokens()", function () {
    beforeEach(async function () {
      await tokenManager.initialize(mockSecretStorage);
    });

    it("should delete tokens from storage", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);

      await tokenManager.clearTokens();

      assert.ok(mockSecretStorage.delete.calledOnce);
    });

    it("should emit onTokensCleared event", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);
      let eventFired = false;

      tokenManager.onTokensCleared(() => {
        eventFired = true;
      });

      await tokenManager.clearTokens();

      assert.strictEqual(eventFired, true);
    });

    it("should clear cached tokens", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);

      await tokenManager.clearTokens();

      const retrieved = await tokenManager.getTokens();
      assert.strictEqual(retrieved, null);
    });
  });

  describe("getIdToken()", function () {
    beforeEach(async function () {
      await tokenManager.initialize(mockSecretStorage);
    });

    it("should return null when no tokens", async function () {
      const token = await tokenManager.getIdToken();

      assert.strictEqual(token, null);
    });

    it("should return ID token when valid", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);

      const token = await tokenManager.getIdToken();

      assert.strictEqual(token, tokens.idToken);
    });

    it("should return null when ID token expired", async function () {
      const tokens = createValidTokens({
        idTokenExpiresAt: new Date(Date.now() - 1000),
      });
      await tokenManager.storeTokens(tokens);

      const token = await tokenManager.getIdToken();

      assert.strictEqual(token, null);
    });

    it("should return null when ID token expiring soon", async function () {
      const tokens = createValidTokens({
        idTokenExpiresAt: new Date(Date.now() + 10000), // 10 seconds, within buffer
      });
      await tokenManager.storeTokens(tokens);

      const token = await tokenManager.getIdToken();

      assert.strictEqual(token, null);
    });
  });

  describe("getControlPlaneToken()", function () {
    beforeEach(async function () {
      await tokenManager.initialize(mockSecretStorage);
    });

    it("should return null when no tokens", async function () {
      const token = await tokenManager.getControlPlaneToken();

      assert.strictEqual(token, null);
    });

    it("should return control plane token when valid", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);

      const token = await tokenManager.getControlPlaneToken();

      assert.strictEqual(token, tokens.controlPlaneToken);
    });

    it("should return null when token expired", async function () {
      const tokens = createValidTokens({
        controlPlaneTokenExpiresAt: new Date(Date.now() - 1000),
      });
      await tokenManager.storeTokens(tokens);

      const token = await tokenManager.getControlPlaneToken();

      assert.strictEqual(token, null);
    });
  });

  describe("getDataPlaneToken()", function () {
    beforeEach(async function () {
      await tokenManager.initialize(mockSecretStorage);
    });

    it("should return null when no tokens", async function () {
      const token = await tokenManager.getDataPlaneToken();

      assert.strictEqual(token, null);
    });

    it("should return data plane token when valid", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);

      const token = await tokenManager.getDataPlaneToken();

      assert.strictEqual(token, tokens.dataPlaneToken);
    });

    it("should return null when no data plane token", async function () {
      const tokens = createValidTokens();
      delete tokens.dataPlaneToken;
      delete tokens.dataPlaneTokenExpiresAt;
      await tokenManager.storeTokens(tokens);

      const token = await tokenManager.getDataPlaneToken();

      assert.strictEqual(token, null);
    });
  });

  describe("getRefreshToken()", function () {
    beforeEach(async function () {
      await tokenManager.initialize(mockSecretStorage);
    });

    it("should return null when no tokens", async function () {
      const token = await tokenManager.getRefreshToken();

      assert.strictEqual(token, null);
    });

    it("should return refresh token when valid", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);

      const token = await tokenManager.getRefreshToken();

      assert.strictEqual(token, tokens.refreshToken);
    });

    it("should return null when refresh token expired", async function () {
      const tokens = createValidTokens({
        refreshTokenExpiresAt: new Date(Date.now() - 1000),
      });
      await tokenManager.storeTokens(tokens);

      const token = await tokenManager.getRefreshToken();

      assert.strictEqual(token, null);
    });
  });

  describe("isSessionValid()", function () {
    beforeEach(async function () {
      await tokenManager.initialize(mockSecretStorage);
    });

    it("should return false when no tokens", async function () {
      const valid = await tokenManager.isSessionValid();

      assert.strictEqual(valid, false);
    });

    it("should return true when refresh token valid", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);

      const valid = await tokenManager.isSessionValid();

      assert.strictEqual(valid, true);
    });

    it("should return false when refresh token expired", async function () {
      const tokens = createValidTokens({
        refreshTokenExpiresAt: new Date(Date.now() - 1000),
      });
      await tokenManager.storeTokens(tokens);

      const valid = await tokenManager.isSessionValid();

      assert.strictEqual(valid, false);
    });
  });

  describe("getTokenStatus()", function () {
    beforeEach(async function () {
      await tokenManager.initialize(mockSecretStorage);
    });

    it("should return all tokens not existing when no tokens", async function () {
      const status = await tokenManager.getTokenStatus();

      assert.strictEqual(status.idToken.exists, false);
      assert.strictEqual(status.controlPlaneToken.exists, false);
      assert.strictEqual(status.refreshToken.exists, false);
      assert.strictEqual(status.sessionValid, false);
      assert.strictEqual(status.needsRefresh, false);
    });

    it("should return correct status for valid tokens", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);

      const status = await tokenManager.getTokenStatus();

      assert.strictEqual(status.idToken.exists, true);
      assert.strictEqual(status.idToken.expiring, false);
      assert.ok(status.idToken.timeUntilExpiry > 0);
      assert.strictEqual(status.sessionValid, true);
    });

    it("should indicate need for refresh when token expiring", async function () {
      const tokens = createValidTokens({
        idTokenExpiresAt: new Date(Date.now() + 10000), // 10 seconds
      });
      await tokenManager.storeTokens(tokens);

      const status = await tokenManager.getTokenStatus();

      assert.strictEqual(status.idToken.expiring, true);
      assert.strictEqual(status.needsRefresh, true);
    });

    it("should include data plane token status when present", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);

      const status = await tokenManager.getTokenStatus();

      assert.ok(status.dataPlaneToken);
      assert.strictEqual(status.dataPlaneToken.exists, true);
    });
  });

  describe("updateTokens()", function () {
    beforeEach(async function () {
      await tokenManager.initialize(mockSecretStorage);
    });

    it("should update specific tokens", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);

      await tokenManager.updateTokens({
        dataPlaneToken: "new-dp-token",
      });

      const updated = await tokenManager.getTokens();
      assert.strictEqual(updated?.dataPlaneToken, "new-dp-token");
      assert.strictEqual(updated?.idToken, tokens.idToken); // Unchanged
    });

    it("should throw when no tokens exist", async function () {
      await assert.rejects(
        () => tokenManager.updateTokens({ dataPlaneToken: "test" }),
        /No tokens to update/,
      );
    });
  });

  describe("refresh attempt tracking", function () {
    it("should start at zero", function () {
      assert.strictEqual(tokenManager.getRefreshAttempts(), 0);
    });

    it("should increment attempts", function () {
      tokenManager.incrementRefreshAttempts();
      assert.strictEqual(tokenManager.getRefreshAttempts(), 1);

      tokenManager.incrementRefreshAttempts();
      assert.strictEqual(tokenManager.getRefreshAttempts(), 2);
    });

    it("should reset attempts", function () {
      tokenManager.incrementRefreshAttempts();
      tokenManager.incrementRefreshAttempts();

      tokenManager.resetRefreshAttempts();

      assert.strictEqual(tokenManager.getRefreshAttempts(), 0);
    });

    it("should detect exceeded max attempts", function () {
      for (let i = 0; i < OAUTH_CONSTANTS.MAX_REFRESH_ATTEMPTS; i++) {
        assert.strictEqual(tokenManager.hasExceededMaxRefreshAttempts(), false);
        tokenManager.incrementRefreshAttempts();
      }

      assert.strictEqual(tokenManager.hasExceededMaxRefreshAttempts(), true);
    });
  });

  describe("events", function () {
    beforeEach(async function () {
      await tokenManager.initialize(mockSecretStorage);
    });

    it("should emit onTokensUpdated with tokens", async function () {
      const tokens = createValidTokens();
      let receivedTokens: OAuthTokens | undefined;

      tokenManager.onTokensUpdated((t) => {
        receivedTokens = t;
      });

      await tokenManager.storeTokens(tokens);

      assert.ok(receivedTokens);
      assert.strictEqual(receivedTokens.idToken, tokens.idToken);
    });

    it("should emit onTokensCleared", async function () {
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);
      let eventFired = false;

      tokenManager.onTokensCleared(() => {
        eventFired = true;
      });

      await tokenManager.clearTokens();

      assert.strictEqual(eventFired, true);
    });
  });

  describe("storage error handling", function () {
    beforeEach(async function () {
      await tokenManager.initialize(mockSecretStorage);
    });

    it("should handle invalid JSON in storage", async function () {
      storageData.set("confluent.oauth.tokens", "invalid json");
      TokenManager.resetInstance();
      tokenManager = TokenManager.getInstance();
      await tokenManager.initialize(mockSecretStorage);

      const tokens = await tokenManager.getTokens();

      assert.strictEqual(tokens, null);
    });

    it("should clear invalid data from storage", async function () {
      storageData.set("confluent.oauth.tokens", "invalid json");
      TokenManager.resetInstance();
      tokenManager = TokenManager.getInstance();
      await tokenManager.initialize(mockSecretStorage);

      assert.ok(mockSecretStorage.delete.calledOnce);
    });
  });

  describe("dispose()", function () {
    it("should clean up resources", async function () {
      await tokenManager.initialize(mockSecretStorage);
      const tokens = createValidTokens();
      await tokenManager.storeTokens(tokens);

      tokenManager.dispose();

      // Instance should be cleared
      assert.strictEqual(TokenManager.getInstance() !== tokenManager, true);
    });
  });
});
