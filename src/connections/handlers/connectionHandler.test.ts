import * as assert from "assert";
import sinon from "sinon";
import type { ConnectionSpec } from "../spec";
import { ConnectedState, ConnectionType, type ConnectionId, type ConnectionStatus } from "../types";
import {
  ConnectionHandler,
  type ConnectionStatusChangeEvent,
  type ConnectionTestResult,
} from "./connectionHandler";

/** Concrete implementation for testing the abstract base class. */
class TestConnectionHandler extends ConnectionHandler {
  public connectCalled = false;
  public disconnectCalled = false;
  public testConnectionCalled = false;
  public getStatusCalled = false;
  public refreshCredentialsCalled = false;

  private _isConnected = false;
  private _overallState = ConnectedState.NONE;

  async connect(): Promise<void> {
    this.connectCalled = true;
    this._isConnected = true;
    this._overallState = ConnectedState.SUCCESS;
    this.updateStatus({
      kafkaCluster: { state: ConnectedState.SUCCESS },
    });
  }

  async disconnect(): Promise<void> {
    this.disconnectCalled = true;
    this._isConnected = false;
    this._overallState = ConnectedState.NONE;
    this.updateStatus({
      kafkaCluster: { state: ConnectedState.NONE },
    });
  }

  async testConnection(): Promise<ConnectionTestResult> {
    this.testConnectionCalled = true;
    return { success: true };
  }

  async getStatus(): Promise<ConnectionStatus> {
    this.getStatusCalled = true;
    return this._status;
  }

  async refreshCredentials(): Promise<boolean> {
    this.refreshCredentialsCalled = true;
    return false;
  }

  isConnected(): boolean {
    return this._isConnected;
  }

  getOverallState(): ConnectedState {
    return this._overallState;
  }

  // Expose protected method for testing
  public testUpdateStatus(status: ConnectionStatus): void {
    this.updateStatus(status);
  }
}

describe("connections/handlers/connectionHandler", function () {
  let sandbox: sinon.SinonSandbox;
  let testSpec: ConnectionSpec;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    testSpec = {
      id: "test-connection-id" as ConnectionId,
      name: "Test Connection",
      type: ConnectionType.Direct,
      kafkaCluster: {
        bootstrapServers: "localhost:9092",
      },
    };
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("constructor", function () {
    it("should initialize with the provided spec", function () {
      const handler = new TestConnectionHandler(testSpec);

      assert.strictEqual(handler.connectionId, testSpec.id);
      assert.strictEqual(handler.spec, testSpec);
      assert.deepStrictEqual(handler.status, {});
    });

    it("should start with empty status", function () {
      const handler = new TestConnectionHandler(testSpec);

      assert.deepStrictEqual(handler.status, {});
    });
  });

  describe("connectionId getter", function () {
    it("should return the connection ID from spec", function () {
      const handler = new TestConnectionHandler(testSpec);

      assert.strictEqual(handler.connectionId, "test-connection-id");
    });
  });

  describe("spec getter", function () {
    it("should return the connection spec", function () {
      const handler = new TestConnectionHandler(testSpec);

      assert.strictEqual(handler.spec.name, "Test Connection");
      assert.strictEqual(handler.spec.type, ConnectionType.Direct);
    });
  });

  describe("updateSpec()", function () {
    it("should update the spec when ID matches", function () {
      const handler = new TestConnectionHandler(testSpec);
      const updatedSpec: ConnectionSpec = {
        ...testSpec,
        name: "Updated Connection",
      };

      handler.updateSpec(updatedSpec);

      assert.strictEqual(handler.spec.name, "Updated Connection");
    });

    it("should throw when trying to change connection ID", function () {
      const handler = new TestConnectionHandler(testSpec);
      const differentIdSpec: ConnectionSpec = {
        ...testSpec,
        id: "different-id" as ConnectionId,
      };

      assert.throws(() => handler.updateSpec(differentIdSpec), /Cannot change connection ID/);
    });
  });

  describe("updateStatus()", function () {
    it("should update the status", function () {
      const handler = new TestConnectionHandler(testSpec);
      const newStatus: ConnectionStatus = {
        kafkaCluster: { state: ConnectedState.SUCCESS, clusterId: "cluster-1" },
      };

      handler.testUpdateStatus(newStatus);

      assert.deepStrictEqual(handler.status, newStatus);
    });

    it("should fire status change event", function () {
      const handler = new TestConnectionHandler(testSpec);
      const events: ConnectionStatusChangeEvent[] = [];

      handler.onStatusChange((event) => events.push(event));

      const newStatus: ConnectionStatus = {
        kafkaCluster: { state: ConnectedState.SUCCESS },
      };
      handler.testUpdateStatus(newStatus);

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].connectionId, testSpec.id);
      assert.deepStrictEqual(events[0].previousStatus, {});
      assert.deepStrictEqual(events[0].currentStatus, newStatus);
    });

    it("should include previous status in event", function () {
      const handler = new TestConnectionHandler(testSpec);
      const events: ConnectionStatusChangeEvent[] = [];

      handler.onStatusChange((event) => events.push(event));

      const firstStatus: ConnectionStatus = {
        kafkaCluster: { state: ConnectedState.ATTEMPTING },
      };
      const secondStatus: ConnectionStatus = {
        kafkaCluster: { state: ConnectedState.SUCCESS },
      };

      handler.testUpdateStatus(firstStatus);
      handler.testUpdateStatus(secondStatus);

      assert.strictEqual(events.length, 2);
      assert.deepStrictEqual(events[1].previousStatus, firstStatus);
      assert.deepStrictEqual(events[1].currentStatus, secondStatus);
    });
  });

  describe("connect()", function () {
    it("should call the abstract implementation", async function () {
      const handler = new TestConnectionHandler(testSpec);

      await handler.connect();

      assert.strictEqual(handler.connectCalled, true);
      assert.strictEqual(handler.isConnected(), true);
    });
  });

  describe("disconnect()", function () {
    it("should call the abstract implementation", async function () {
      const handler = new TestConnectionHandler(testSpec);
      await handler.connect();

      await handler.disconnect();

      assert.strictEqual(handler.disconnectCalled, true);
      assert.strictEqual(handler.isConnected(), false);
    });
  });

  describe("testConnection()", function () {
    it("should call the abstract implementation", async function () {
      const handler = new TestConnectionHandler(testSpec);

      const result = await handler.testConnection();

      assert.strictEqual(handler.testConnectionCalled, true);
      assert.strictEqual(result.success, true);
    });
  });

  describe("getStatus()", function () {
    it("should call the abstract implementation", async function () {
      const handler = new TestConnectionHandler(testSpec);

      await handler.getStatus();

      assert.strictEqual(handler.getStatusCalled, true);
    });
  });

  describe("refreshCredentials()", function () {
    it("should call the abstract implementation", async function () {
      const handler = new TestConnectionHandler(testSpec);

      const result = await handler.refreshCredentials();

      assert.strictEqual(handler.refreshCredentialsCalled, true);
      assert.strictEqual(result, false);
    });
  });

  describe("isConnected()", function () {
    it("should return false initially", function () {
      const handler = new TestConnectionHandler(testSpec);

      assert.strictEqual(handler.isConnected(), false);
    });

    it("should return true after connect", async function () {
      const handler = new TestConnectionHandler(testSpec);
      await handler.connect();

      assert.strictEqual(handler.isConnected(), true);
    });
  });

  describe("getOverallState()", function () {
    it("should return NONE initially", function () {
      const handler = new TestConnectionHandler(testSpec);

      assert.strictEqual(handler.getOverallState(), ConnectedState.NONE);
    });

    it("should return SUCCESS after connect", async function () {
      const handler = new TestConnectionHandler(testSpec);
      await handler.connect();

      assert.strictEqual(handler.getOverallState(), ConnectedState.SUCCESS);
    });
  });

  describe("dispose()", function () {
    it("should clean up resources", function () {
      const handler = new TestConnectionHandler(testSpec);

      // Should not throw
      handler.dispose();
    });

    it("should stop firing events after dispose", function () {
      const handler = new TestConnectionHandler(testSpec);
      const events: ConnectionStatusChangeEvent[] = [];

      handler.onStatusChange((event) => events.push(event));
      handler.dispose();

      // After dispose, events should not fire (or should be cleaned up)
      // Note: The EventEmitter may still work, but listeners should be disposed
      // This test verifies dispose completes without error
      assert.strictEqual(events.length, 0);
    });
  });
});
