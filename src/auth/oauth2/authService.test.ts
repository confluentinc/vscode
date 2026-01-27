import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { AuthService, AuthState } from "./authService";
import { TokenManager } from "./tokenManager";
import type { OAuthTokens } from "./types";
import { TOKEN_LIFETIMES, CCloudEnvironment } from "./config";

describe("auth/oauth2/authService", function () {
  let authService: AuthService;
  let mockContext: vscode.ExtensionContext;
  let mockSecretStorage: sinon.SinonStubbedInstance<vscode.SecretStorage>;
  let storageData: Map<string, string>;

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
    TokenManager.resetInstance();
    AuthService.resetInstance();

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

    mockContext = {
      secrets: mockSecretStorage,
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    // Stub window.registerUriHandler
    sinon.stub(vscode.window, "registerUriHandler").returns({
      dispose: sinon.stub(),
    } as unknown as vscode.Disposable);

    authService = AuthService.getInstance();
  });

  afterEach(function () {
    AuthService.resetInstance();
    TokenManager.resetInstance();
    sinon.restore();
  });

  describe("getInstance()", function () {
    it("should return singleton instance", function () {
      const instance1 = AuthService.getInstance();
      const instance2 = AuthService.getInstance();

      assert.strictEqual(instance1, instance2);
    });

    it("should return new instance after reset", function () {
      const instance1 = AuthService.getInstance();
      AuthService.resetInstance();
      const instance2 = AuthService.getInstance();

      assert.notStrictEqual(instance1, instance2);
    });
  });

  describe("initialize()", function () {
    it("should initialize with context", async function () {
      await authService.initialize(mockContext);

      assert.strictEqual(authService.getState(), AuthState.UNAUTHENTICATED);
    });

    it("should restore authenticated state with valid tokens", async function () {
      // Pre-store valid tokens
      const tokens = createValidTokens();
      const serialized = {
        idToken: tokens.idToken,
        controlPlaneToken: tokens.controlPlaneToken,
        dataPlaneToken: tokens.dataPlaneToken,
        refreshToken: tokens.refreshToken,
        idTokenExpiresAt: tokens.idTokenExpiresAt.toISOString(),
        controlPlaneTokenExpiresAt: tokens.controlPlaneTokenExpiresAt.toISOString(),
        dataPlaneTokenExpiresAt: tokens.dataPlaneTokenExpiresAt!.toISOString(),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      };
      storageData.set("confluent.oauth.tokens", JSON.stringify(serialized));

      await authService.initialize(mockContext);

      assert.strictEqual(authService.getState(), AuthState.AUTHENTICATED);
    });

    it("should set expired state with expired tokens", async function () {
      // Pre-store expired tokens
      const tokens = createValidTokens();
      tokens.refreshTokenExpiresAt = new Date(Date.now() - 1000);
      const serialized = {
        idToken: tokens.idToken,
        controlPlaneToken: tokens.controlPlaneToken,
        dataPlaneToken: tokens.dataPlaneToken,
        refreshToken: tokens.refreshToken,
        idTokenExpiresAt: tokens.idTokenExpiresAt.toISOString(),
        controlPlaneTokenExpiresAt: tokens.controlPlaneTokenExpiresAt.toISOString(),
        dataPlaneTokenExpiresAt: tokens.dataPlaneTokenExpiresAt!.toISOString(),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      };
      storageData.set("confluent.oauth.tokens", JSON.stringify(serialized));

      await authService.initialize(mockContext);

      assert.strictEqual(authService.getState(), AuthState.EXPIRED);
    });
  });

  describe("getState()", function () {
    it("should return unauthenticated initially", function () {
      assert.strictEqual(authService.getState(), AuthState.UNAUTHENTICATED);
    });
  });

  describe("isAuthenticated()", function () {
    it("should return false when unauthenticated", function () {
      assert.strictEqual(authService.isAuthenticated(), false);
    });

    it("should return true when authenticated", async function () {
      // Pre-store valid tokens
      const tokens = createValidTokens();
      const serialized = {
        idToken: tokens.idToken,
        controlPlaneToken: tokens.controlPlaneToken,
        refreshToken: tokens.refreshToken,
        idTokenExpiresAt: tokens.idTokenExpiresAt.toISOString(),
        controlPlaneTokenExpiresAt: tokens.controlPlaneTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      };
      storageData.set("confluent.oauth.tokens", JSON.stringify(serialized));

      await authService.initialize(mockContext);

      assert.strictEqual(authService.isAuthenticated(), true);
    });
  });

  describe("getEnvironment()", function () {
    it("should return production by default", function () {
      assert.strictEqual(authService.getEnvironment(), CCloudEnvironment.PRODUCTION);
    });
  });

  describe("signOut()", function () {
    it("should clear tokens and set state to unauthenticated", async function () {
      // Pre-store tokens
      const tokens = createValidTokens();
      const serialized = {
        idToken: tokens.idToken,
        controlPlaneToken: tokens.controlPlaneToken,
        refreshToken: tokens.refreshToken,
        idTokenExpiresAt: tokens.idTokenExpiresAt.toISOString(),
        controlPlaneTokenExpiresAt: tokens.controlPlaneTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      };
      storageData.set("confluent.oauth.tokens", JSON.stringify(serialized));

      await authService.initialize(mockContext);
      assert.strictEqual(authService.isAuthenticated(), true);

      await authService.signOut();

      assert.strictEqual(authService.isAuthenticated(), false);
      assert.strictEqual(authService.getState(), AuthState.UNAUTHENTICATED);
    });

    it("should emit state change event", async function () {
      // Need to be authenticated first to see a state change on sign out
      const tokens = createValidTokens();
      const serialized = {
        idToken: tokens.idToken,
        controlPlaneToken: tokens.controlPlaneToken,
        refreshToken: tokens.refreshToken,
        idTokenExpiresAt: tokens.idTokenExpiresAt.toISOString(),
        controlPlaneTokenExpiresAt: tokens.controlPlaneTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      };
      storageData.set("confluent.oauth.tokens", JSON.stringify(serialized));
      await authService.initialize(mockContext);

      let stateChanged = false;
      authService.onStateChanged(() => {
        stateChanged = true;
      });

      await authService.signOut();

      assert.strictEqual(stateChanged, true);
    });
  });

  describe("getTokens()", function () {
    it("should return null when not authenticated", async function () {
      await authService.initialize(mockContext);

      const tokens = await authService.getTokens();

      assert.strictEqual(tokens, null);
    });

    it("should return tokens when authenticated", async function () {
      // Pre-store tokens
      const tokens = createValidTokens();
      const serialized = {
        idToken: tokens.idToken,
        controlPlaneToken: tokens.controlPlaneToken,
        refreshToken: tokens.refreshToken,
        idTokenExpiresAt: tokens.idTokenExpiresAt.toISOString(),
        controlPlaneTokenExpiresAt: tokens.controlPlaneTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      };
      storageData.set("confluent.oauth.tokens", JSON.stringify(serialized));

      await authService.initialize(mockContext);

      const retrieved = await authService.getTokens();

      assert.ok(retrieved);
      assert.strictEqual(retrieved.idToken, tokens.idToken);
    });
  });

  describe("authenticate()", function () {
    this.timeout(5000); // Reduce timeout for faster failure

    beforeEach(async function () {
      await authService.initialize(mockContext);
    });

    it("should open browser with correct URL structure", async function () {
      const openExternalStub = sinon.stub(vscode.env, "openExternal").callsFake(async (uri) => {
        // Verify URL structure immediately
        const url = uri.toString();
        assert.ok(url.includes("login.confluent.io"), "Should include auth endpoint");
        assert.ok(url.includes("code_challenge"), "Should include PKCE code challenge");
        assert.ok(url.includes("response_type=code"), "Should request authorization code");

        // Immediately dispose to end the flow
        authService.dispose();
        return true;
      });

      const result = await authService.authenticate();

      assert.ok(openExternalStub.calledOnce);
      // Result will be failed since we cancelled
      assert.strictEqual(result.success, false);
    });

    it("should fail if browser fails to open", async function () {
      sinon.stub(vscode.env, "openExternal").resolves(false);

      const result = await authService.authenticate();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("Failed to open browser"));
    });
  });

  describe("handleCallback()", function () {
    beforeEach(async function () {
      await authService.initialize(mockContext);
      sinon.stub(vscode.env, "openExternal").resolves(true);
    });

    it("should ignore callback when no flow pending", async function () {
      // No authentication started
      await authService.handleCallback({
        success: true,
        code: "test-code",
        state: "test-state",
      });

      // Should not change state
      assert.strictEqual(authService.getState(), AuthState.UNAUTHENTICATED);
    });
  });

  describe("refreshTokens()", function () {
    beforeEach(async function () {
      await authService.initialize(mockContext);
    });

    it("should fail when no tokens exist", async function () {
      const result = await authService.refreshTokens();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("No tokens"));
    });

    it("should fail when session expired", async function () {
      // Store expired tokens
      const tokens = createValidTokens();
      tokens.refreshTokenExpiresAt = new Date(Date.now() - 1000);
      const serialized = {
        idToken: tokens.idToken,
        controlPlaneToken: tokens.controlPlaneToken,
        refreshToken: tokens.refreshToken,
        idTokenExpiresAt: tokens.idTokenExpiresAt.toISOString(),
        controlPlaneTokenExpiresAt: tokens.controlPlaneTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      };
      storageData.set("confluent.oauth.tokens", JSON.stringify(serialized));

      // Re-initialize to pick up tokens
      AuthService.resetInstance();
      TokenManager.resetInstance();
      authService = AuthService.getInstance();
      await authService.initialize(mockContext);

      const result = await authService.refreshTokens();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("expired"));
    });
  });

  describe("events", function () {
    beforeEach(async function () {
      // Pre-store valid tokens so we can test sign out
      const tokens = createValidTokens();
      const serialized = {
        idToken: tokens.idToken,
        controlPlaneToken: tokens.controlPlaneToken,
        refreshToken: tokens.refreshToken,
        idTokenExpiresAt: tokens.idTokenExpiresAt.toISOString(),
        controlPlaneTokenExpiresAt: tokens.controlPlaneTokenExpiresAt.toISOString(),
        refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
      };
      storageData.set("confluent.oauth.tokens", JSON.stringify(serialized));

      await authService.initialize(mockContext);
    });

    it("should emit onStateChanged when signing out", async function () {
      const stateChanges: AuthState[] = [];

      authService.onStateChanged((state) => {
        stateChanges.push(state);
      });

      // Should be authenticated after init with tokens
      assert.strictEqual(authService.getState(), AuthState.AUTHENTICATED);

      await authService.signOut();

      // Should have captured the state change
      assert.ok(stateChanges.includes(AuthState.UNAUTHENTICATED));
    });
  });

  describe("dispose()", function () {
    it("should clean up resources", async function () {
      await authService.initialize(mockContext);

      authService.dispose();

      // Verify instance is cleared
      const newInstance = AuthService.getInstance();
      assert.notStrictEqual(newInstance, authService);
    });
  });
});
