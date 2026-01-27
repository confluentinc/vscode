import * as assert from "assert";
import sinon from "sinon";
import { ConnectedState, ConnectionType, type ConnectionId } from "../types";
import type { ConnectionSpec } from "../spec";
import { CCloudConnectionHandler } from "./ccloudConnectionHandler";

describe("connections/handlers/ccloudConnectionHandler", function () {
  let sandbox: sinon.SinonSandbox;

  // Standard CCloud connection spec
  const ccloudSpec: ConnectionSpec = {
    id: "vscode-confluent-cloud-connection" as ConnectionId,
    name: "Confluent Cloud",
    type: ConnectionType.CCLOUD,
    ccloudConfig: {
      organizationId: "org-12345",
    },
  };

  // Minimal CCloud spec without org
  const minimalSpec: ConnectionSpec = {
    id: "vscode-confluent-cloud-connection" as ConnectionId,
    name: "Confluent Cloud",
    type: ConnectionType.CCLOUD,
  };

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("constructor", function () {
    it("should create handler with standard spec", function () {
      const handler = new CCloudConnectionHandler(ccloudSpec);

      assert.strictEqual(handler.connectionId, ccloudSpec.id);
      assert.strictEqual(handler.spec.type, ConnectionType.CCLOUD);
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
        type: ConnectionType.DIRECT,
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
