import * as assert from "assert";
import sinon from "sinon";
import type { ConnectionSpec } from "../spec";
import { ConnectedState, ConnectionType, type ConnectionId } from "../types";
import { CCloudConnectionHandler } from "./ccloudConnectionHandler";
import { AuthService, AuthState } from "../../authn/oauth2/authService";
import { TokenManager } from "../../authn/oauth2/tokenManager";

describe("connections/handlers/ccloudConnectionHandler", function () {
  let sandbox: sinon.SinonSandbox;

  // Standard CCloud connection spec
  const ccloudSpec: ConnectionSpec = {
    id: "vscode-confluent-cloud-connection" as ConnectionId,
    name: "Confluent Cloud",
    type: ConnectionType.Ccloud,
    ccloudConfig: {
      organizationId: "org-12345",
    },
  };

  // Minimal CCloud spec without org
  const minimalSpec: ConnectionSpec = {
    id: "vscode-confluent-cloud-connection" as ConnectionId,
    name: "Confluent Cloud",
    type: ConnectionType.Ccloud,
  };

  // Mock tokens with user info encoded in JWT format
  const mockIdToken =
    "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9." +
    Buffer.from(
      JSON.stringify({
        sub: "test-user-id",
        email: "test@example.com",
        given_name: "Test",
        family_name: "User",
      }),
    ).toString("base64") +
    ".signature";

  const mockTokens = {
    idToken: mockIdToken,
    controlPlaneToken: "mock-cp-token",
    dataPlaneToken: "mock-dp-token",
    refreshToken: "mock-refresh-token",
    idTokenExpiresAt: new Date(Date.now() + 3600000),
    controlPlaneTokenExpiresAt: new Date(Date.now() + 3600000),
    dataPlaneTokenExpiresAt: new Date(Date.now() + 3600000),
    refreshTokenExpiresAt: new Date(Date.now() + 28800000), // 8 hours
  };

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // Create a mock disposable for event subscriptions
    const mockDisposable = { dispose: sandbox.stub() };

    // Stub AuthService singleton
    const mockAuthService = {
      isAuthenticated: sandbox.stub().returns(false),
      authenticate: sandbox.stub().resolves({ success: true, tokens: mockTokens }),
      refreshTokens: sandbox.stub().resolves({ success: true, tokens: mockTokens }),
      signOut: sandbox.stub().resolves(),
      getState: sandbox.stub().returns(AuthState.UNAUTHENTICATED),
      // Event subscription methods - these return disposables
      onAuthenticated: sandbox.stub().returns(mockDisposable),
      onAuthenticationFailed: sandbox.stub().returns(mockDisposable),
      onSessionExpired: sandbox.stub().returns(mockDisposable),
    };
    sandbox.stub(AuthService, "getInstance").returns(mockAuthService as unknown as AuthService);

    // Stub TokenManager singleton
    const mockTokenManager = {
      getTokens: sandbox.stub().resolves(mockTokens),
      getTokenStatus: sandbox.stub().resolves({
        idToken: { exists: true, expiring: false, timeUntilExpiry: 3600000 },
        controlPlaneToken: { exists: true, expiring: false, timeUntilExpiry: 3600000 },
        refreshToken: {
          exists: true,
          expiring: false,
          timeUntilExpiry: 28800000,
          expiresAt: new Date(Date.now() + 28800000),
        },
        sessionValid: true,
        needsRefresh: false,
      }),
      isSessionValid: sandbox.stub().resolves(true),
      hasExceededMaxRefreshAttempts: sandbox.stub().returns(false),
    };
    sandbox.stub(TokenManager, "getInstance").returns(mockTokenManager as unknown as TokenManager);
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("constructor", function () {
    it("should create handler with standard spec", function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);

      assert.strictEqual(handler.connectionId, ccloudSpec.id);
      assert.strictEqual(handler.spec.type, ConnectionType.Ccloud);
      assert.strictEqual(handler.isConnected(), false);
    });

    it("should create handler with minimal spec", function () {
      const handler = new CCloudConnectionHandler(minimalSpec);

      assert.strictEqual(handler.connectionId, minimalSpec.id);
      assert.strictEqual(handler.spec.ccloudConfig, undefined);
    });

    it("should start with NONE state", function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);

      assert.strictEqual(handler.getOverallState(), ConnectedState.NONE);
    });
  });

  describe("connect()", function () {
    it("should authenticate with CCloud", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);

      await handler.connect();

      assert.strictEqual(handler.isConnected(), true);
      assert.strictEqual(handler.getOverallState(), ConnectedState.SUCCESS);
    });

    it("should set user info after successful connect", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);

      await handler.connect();

      const user = handler.getUser();
      assert.ok(user);
      assert.ok(user.id);
    });

    it("should set session expiry after successful connect", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);

      await handler.connect();

      const expiry = handler.getSessionExpiry();
      assert.ok(expiry);
      assert.ok(expiry > new Date());
    });

    it("should fire status change events during connection", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      const statusEvents: ConnectedState[] = [];

      handler.onStatusChange((event) => {
        if (event.currentStatus.ccloud) {
          statusEvents.push(event.currentStatus.ccloud.state);
        }
      });

      await handler.connect();

      // Should have ATTEMPTING then SUCCESS
      assert.ok(statusEvents.includes(ConnectedState.ATTEMPTING));
      assert.ok(statusEvents.includes(ConnectedState.SUCCESS));
    });
  });

  describe("disconnect()", function () {
    it("should disconnect from CCloud", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();

      await handler.disconnect();

      assert.strictEqual(handler.isConnected(), false);
      assert.strictEqual(handler.getOverallState(), ConnectedState.NONE);
    });

    it("should clear user info after disconnect", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();

      await handler.disconnect();

      assert.strictEqual(handler.getUser(), undefined);
    });

    it("should clear session expiry after disconnect", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();

      await handler.disconnect();

      assert.strictEqual(handler.getSessionExpiry(), undefined);
    });
  });

  describe("testConnection()", function () {
    it("should test CCloud connection successfully", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status?.ccloud?.state, ConnectedState.SUCCESS);
    });

    it("should fail for non-CCloud connection type", async function () {
      const directSpec: ConnectionSpec = {
        ...ccloudSpec,
        type: ConnectionType.Direct,
      };
      const handler = new CCloudConnectionHandler(directSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("Invalid connection type"));
    });
  });

  describe("getStatus()", function () {
    it("should return current CCloud status", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();

      const status = await handler.getStatus();

      assert.ok(status.ccloud);
      assert.strictEqual(status.ccloud.state, ConnectedState.SUCCESS);
    });

    it("should include user info when authenticated", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();

      const status = await handler.getStatus();

      assert.ok(status.ccloud?.user);
    });
  });

  describe("refreshCredentials()", function () {
    it("should return false when refresh is not needed", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();

      // Fresh connection doesn't need refresh
      const result = await handler.refreshCredentials();

      assert.strictEqual(result, false);
    });

    it("should return false when token is not expiring", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();

      // Fresh token doesn't need refresh
      const result = await handler.refreshCredentials();

      assert.strictEqual(result, false);
      // Should still be connected
      assert.strictEqual(handler.isConnected(), true);
    });
  });

  describe("isConnected()", function () {
    it("should return false before connect", function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);

      assert.strictEqual(handler.isConnected(), false);
    });

    it("should return true after successful connect", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();

      assert.strictEqual(handler.isConnected(), true);
    });

    it("should return false after disconnect", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();
      await handler.disconnect();

      assert.strictEqual(handler.isConnected(), false);
    });
  });

  describe("getOverallState()", function () {
    it("should return NONE before connect", function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);

      assert.strictEqual(handler.getOverallState(), ConnectedState.NONE);
    });

    it("should return SUCCESS after connect", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();

      assert.strictEqual(handler.getOverallState(), ConnectedState.SUCCESS);
    });

    it("should return NONE after disconnect", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();
      await handler.disconnect();

      assert.strictEqual(handler.getOverallState(), ConnectedState.NONE);
    });
  });

  describe("getUser()", function () {
    it("should return undefined before connect", function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);

      assert.strictEqual(handler.getUser(), undefined);
    });

    it("should return user info after connect", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();

      const user = handler.getUser();
      assert.ok(user);
      assert.ok(user.id);
    });
  });

  describe("getSessionExpiry()", function () {
    it("should return undefined before connect", function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);

      assert.strictEqual(handler.getSessionExpiry(), undefined);
    });

    it("should return future date after connect", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();

      const expiry = handler.getSessionExpiry();
      assert.ok(expiry);
      assert.ok(expiry > new Date());
    });
  });

  describe("isSessionExpired()", function () {
    it("should return false before connect", function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);

      assert.strictEqual(handler.isSessionExpired(), false);
    });

    it("should return false immediately after connect", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();

      assert.strictEqual(handler.isSessionExpired(), false);
    });
  });

  describe("dispose()", function () {
    it("should clean up connection state on dispose", async function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);
      await handler.connect();

      handler.dispose();

      assert.strictEqual(handler.isConnected(), false);
      assert.strictEqual(handler.getOverallState(), ConnectedState.NONE);
    });
  });
});
