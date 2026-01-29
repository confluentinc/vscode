import * as assert from "assert";
import sinon from "sinon";
import type { ExtensionContext } from "vscode";
import { clearExtensionContext, setExtensionContext } from "../context/extension";
import {
  ConnectionManager,
  type ConnectionCreatedEvent,
  type ConnectionDeletedEvent,
} from "./connectionManager";
import type { ConnectionSpec } from "./spec";
import { ConnectionStorage } from "./storage";
import { ConnectionType, type ConnectionId } from "./types";

describe("connections/connectionManager", function () {
  let sandbox: sinon.SinonSandbox;
  let mockContext: ExtensionContext;
  let mockSecrets: Map<string, string>;

  // Test connection specs
  const directSpec: ConnectionSpec = {
    id: "test-direct" as ConnectionId,
    name: "Test Direct Connection",
    type: ConnectionType.Direct,
    kafkaCluster: {
      bootstrapServers: "localhost:9092",
    },
  };

  const localSpec: ConnectionSpec = {
    id: "test-local" as ConnectionId,
    name: "Test Local Connection",
    type: ConnectionType.Local,
  };

  const ccloudSpec: ConnectionSpec = {
    id: "test-ccloud" as ConnectionId,
    name: "Test CCloud Connection",
    type: ConnectionType.Ccloud,
  };

  beforeEach(async function () {
    sandbox = sinon.createSandbox();

    // Reset singletons
    ConnectionManager.resetInstance();
    ConnectionStorage.resetInstance();

    // Create mock secrets storage
    mockSecrets = new Map<string, string>();

    // Create mock extension context
    mockContext = {
      secrets: {
        get: sandbox.stub().callsFake((key: string) => Promise.resolve(mockSecrets.get(key))),
        store: sandbox.stub().callsFake((key: string, value: string) => {
          mockSecrets.set(key, value);
          return Promise.resolve();
        }),
        delete: sandbox.stub().callsFake((key: string) => {
          mockSecrets.delete(key);
          return Promise.resolve();
        }),
        onDidChange: sandbox.stub().returns({ dispose: () => {} }),
      },
      subscriptions: [],
      extensionUri: {} as any,
      extensionPath: "",
      globalState: {} as any,
      workspaceState: {} as any,
      storageUri: undefined,
      globalStorageUri: {} as any,
      logUri: {} as any,
      extensionMode: 1,
      extension: {} as any,
      environmentVariableCollection: {} as any,
      languageModelAccessInformation: {} as any,
    } as unknown as ExtensionContext;

    // Reset and set up extension context
    clearExtensionContext();
    setExtensionContext(mockContext);
  });

  afterEach(function () {
    sandbox.restore();
    ConnectionManager.resetInstance();
    ConnectionStorage.resetInstance();
  });

  describe("getInstance()", function () {
    it("should return singleton instance", function () {
      const instance1 = ConnectionManager.getInstance();
      const instance2 = ConnectionManager.getInstance();

      assert.strictEqual(instance1, instance2);
    });
  });

  describe("resetInstance()", function () {
    it("should reset the singleton", function () {
      const instance1 = ConnectionManager.getInstance();
      ConnectionManager.resetInstance();
      const instance2 = ConnectionManager.getInstance();

      assert.notStrictEqual(instance1, instance2);
    });
  });

  describe("initialize()", function () {
    it("should initialize with storage", async function () {
      const manager = ConnectionManager.getInstance();

      await manager.initialize();

      // Should not throw when getting connections
      const connections = manager.getAllConnections();
      assert.strictEqual(connections.length, 0);
    });

    it("should load existing connections from storage", async function () {
      // Pre-populate storage
      const storage = ConnectionStorage.getInstance();
      await storage.saveConnection(directSpec);

      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      const connections = manager.getAllConnections();
      assert.strictEqual(connections.length, 1);
      assert.strictEqual(connections[0].connectionId, directSpec.id);
    });
  });

  describe("createConnection()", function () {
    it("should create a Direct connection", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      const handler = await manager.createConnection(directSpec);

      assert.strictEqual(handler.connectionId, directSpec.id);
      assert.strictEqual(handler.spec.type, ConnectionType.Direct);
    });

    it("should create a Local connection", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      const handler = await manager.createConnection(localSpec);

      assert.strictEqual(handler.connectionId, localSpec.id);
      assert.strictEqual(handler.spec.type, ConnectionType.Local);
    });

    it("should create a CCloud connection", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      const handler = await manager.createConnection(ccloudSpec);

      assert.strictEqual(handler.connectionId, ccloudSpec.id);
      assert.strictEqual(handler.spec.type, ConnectionType.Ccloud);
    });

    it("should persist connection to storage", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      await manager.createConnection(directSpec);

      const storage = ConnectionStorage.getInstance();
      const stored = await storage.getConnection(directSpec.id);
      assert.ok(stored);
      assert.strictEqual(stored.id, directSpec.id);
    });

    it("should fire created event", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      const events: ConnectionCreatedEvent[] = [];
      manager.onConnectionCreated((event) => events.push(event));

      await manager.createConnection(directSpec);

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].connectionId, directSpec.id);
    });

    it("should throw for duplicate connection ID", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      await manager.createConnection(directSpec);

      await assert.rejects(
        async () => manager.createConnection(directSpec),
        /Connection already exists/,
      );
    });

    it("should not persist in dry run mode", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      await manager.createConnection(directSpec, true);

      const storage = ConnectionStorage.getInstance();
      const stored = await storage.getConnection(directSpec.id);
      assert.strictEqual(stored, null);
    });
  });

  describe("updateConnection()", function () {
    it("should update connection spec", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);

      const updatedSpec: ConnectionSpec = {
        ...directSpec,
        name: "Updated Name",
      };
      await manager.updateConnection(directSpec.id, updatedSpec);

      const handler = manager.getConnection(directSpec.id);
      assert.strictEqual(handler?.spec.name, "Updated Name");
    });

    it("should persist update to storage", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);

      const updatedSpec: ConnectionSpec = {
        ...directSpec,
        name: "Updated Name",
      };
      await manager.updateConnection(directSpec.id, updatedSpec);

      const storage = ConnectionStorage.getInstance();
      const stored = await storage.getConnection(directSpec.id);
      assert.strictEqual(stored?.name, "Updated Name");
    });

    it("should fire updated event", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);

      const events: any[] = [];
      manager.onConnectionUpdated((event) => events.push(event));

      const updatedSpec: ConnectionSpec = { ...directSpec, name: "Updated" };
      await manager.updateConnection(directSpec.id, updatedSpec);

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].previousSpec.name, directSpec.name);
      assert.strictEqual(events[0].currentSpec.name, "Updated");
    });

    it("should throw for non-existent connection", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      await assert.rejects(
        async () => manager.updateConnection("non-existent" as ConnectionId, directSpec),
        /Connection not found/,
      );
    });
  });

  describe("deleteConnection()", function () {
    it("should delete connection", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);

      await manager.deleteConnection(directSpec.id);

      assert.strictEqual(manager.getConnection(directSpec.id), undefined);
    });

    it("should remove from storage", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);

      await manager.deleteConnection(directSpec.id);

      const storage = ConnectionStorage.getInstance();
      const stored = await storage.getConnection(directSpec.id);
      assert.strictEqual(stored, null);
    });

    it("should fire deleted event", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);

      const events: ConnectionDeletedEvent[] = [];
      manager.onConnectionDeleted((event) => events.push(event));

      await manager.deleteConnection(directSpec.id);

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].connectionId, directSpec.id);
    });

    it("should disconnect before deleting", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      const handler = await manager.createConnection(directSpec);
      await handler.connect();

      assert.strictEqual(handler.isConnected(), true);

      await manager.deleteConnection(directSpec.id);

      // Handler is disposed, but we can verify it was disconnected by checking
      // there are no more active handlers
      assert.strictEqual(manager.getAllConnections().length, 0);
    });

    it("should throw for non-existent connection", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      await assert.rejects(
        async () => manager.deleteConnection("non-existent" as ConnectionId),
        /Connection not found/,
      );
    });
  });

  describe("getConnection()", function () {
    it("should return handler by ID", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);

      const handler = manager.getConnection(directSpec.id);

      assert.ok(handler);
      assert.strictEqual(handler.connectionId, directSpec.id);
    });

    it("should return undefined for non-existent ID", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      const handler = manager.getConnection("non-existent" as ConnectionId);

      assert.strictEqual(handler, undefined);
    });
  });

  describe("getAllConnections()", function () {
    it("should return all handlers", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);
      await manager.createConnection(localSpec);

      const handlers = manager.getAllConnections();

      assert.strictEqual(handlers.length, 2);
    });

    it("should return empty array when no connections", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      const handlers = manager.getAllConnections();

      assert.strictEqual(handlers.length, 0);
    });
  });

  describe("connect()", function () {
    it("should connect handler", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);

      await manager.connect(directSpec.id);

      assert.strictEqual(manager.isConnected(directSpec.id), true);
    });

    it("should throw for non-existent connection", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      await assert.rejects(
        async () => manager.connect("non-existent" as ConnectionId),
        /Connection not found/,
      );
    });
  });

  describe("disconnect()", function () {
    it("should disconnect handler", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);
      await manager.connect(directSpec.id);

      await manager.disconnect(directSpec.id);

      assert.strictEqual(manager.isConnected(directSpec.id), false);
    });

    it("should throw for non-existent connection", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      await assert.rejects(
        async () => manager.disconnect("non-existent" as ConnectionId),
        /Connection not found/,
      );
    });
  });

  describe("testConnection()", function () {
    it("should test connection", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);

      const result = await manager.testConnection(directSpec.id);

      assert.ok(result);
      assert.strictEqual(result.success, true);
    });

    it("should throw for non-existent connection", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      await assert.rejects(
        async () => manager.testConnection("non-existent" as ConnectionId),
        /Connection not found/,
      );
    });
  });

  describe("getConnectionStatus()", function () {
    it("should return connection status", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);
      await manager.connect(directSpec.id);

      const status = await manager.getConnectionStatus(directSpec.id);

      assert.ok(status);
      assert.ok(status.kafkaCluster);
    });

    it("should throw for non-existent connection", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      await assert.rejects(
        async () => manager.getConnectionStatus("non-existent" as ConnectionId),
        /Connection not found/,
      );
    });
  });

  describe("isConnected()", function () {
    it("should return true when connected", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);
      await manager.connect(directSpec.id);

      assert.strictEqual(manager.isConnected(directSpec.id), true);
    });

    it("should return false when not connected", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);

      assert.strictEqual(manager.isConnected(directSpec.id), false);
    });

    it("should return false for non-existent connection", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();

      assert.strictEqual(manager.isConnected("non-existent" as ConnectionId), false);
    });
  });

  describe("onConnectionStatusChanged", function () {
    it("should forward status change events from handlers", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);

      const events: any[] = [];
      manager.onConnectionStatusChanged((event) => events.push(event));

      await manager.connect(directSpec.id);

      // Should have at least one status change event
      assert.ok(events.length > 0);
      assert.strictEqual(events[0].connectionId, directSpec.id);
    });
  });

  describe("dispose()", function () {
    it("should dispose all handlers", async function () {
      const manager = ConnectionManager.getInstance();
      await manager.initialize();
      await manager.createConnection(directSpec);
      await manager.createConnection(localSpec);

      manager.dispose();

      assert.strictEqual(manager.getAllConnections().length, 0);
    });
  });
});
