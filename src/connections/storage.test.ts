import * as assert from "assert";
import sinon from "sinon";
import type { SecretStorage } from "vscode";
import * as extensionContext from "../context/extension";
import * as storageUtils from "../storage/utils";
import type { ConnectionSpec } from "./spec";
import { connectionSpecFromJSON, connectionSpecToJSON, ConnectionStorage } from "./storage";
import { ConnectionType, type ConnectionId } from "./types";

describe("connections/storage", function () {
  let sandbox: sinon.SinonSandbox;
  let mockSecretStorage: sinon.SinonStubbedInstance<SecretStorage>;
  let storedData: Map<string, string>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // Reset the singleton before each test
    ConnectionStorage.resetInstance();

    // Create in-memory storage for tests
    storedData = new Map();

    // Create mock SecretStorage
    mockSecretStorage = {
      get: sandbox.stub().callsFake((key: string) => Promise.resolve(storedData.get(key))),
      store: sandbox.stub().callsFake((key: string, value: string) => {
        storedData.set(key, value);
        return Promise.resolve();
      }),
      delete: sandbox.stub().callsFake((key: string) => {
        storedData.delete(key);
        return Promise.resolve();
      }),
      onDidChange: sandbox.stub(),
    } as unknown as sinon.SinonStubbedInstance<SecretStorage>;

    // Stub the extension context and storage utils
    sandbox.stub(extensionContext, "getExtensionContext").returns({} as never);
    sandbox.stub(storageUtils, "getSecretStorage").returns(mockSecretStorage);
  });

  afterEach(function () {
    sandbox.restore();
    ConnectionStorage.resetInstance();
  });

  const createTestSpec = (id: string, name: string): ConnectionSpec => ({
    id: id as ConnectionId,
    name,
    type: ConnectionType.DIRECT,
    kafkaCluster: {
      bootstrapServers: "localhost:9092",
    },
  });

  describe("connectionSpecToJSON / connectionSpecFromJSON", function () {
    it("should round-trip a ConnectionSpec", function () {
      const spec = createTestSpec("test-id", "Test Connection");
      const json = connectionSpecToJSON(spec);
      const restored = connectionSpecFromJSON(json);

      assert.strictEqual(restored.id, spec.id);
      assert.strictEqual(restored.name, spec.name);
      assert.strictEqual(restored.type, spec.type);
      assert.strictEqual(restored.kafkaCluster?.bootstrapServers, "localhost:9092");
    });

    it("should throw for invalid JSON missing required fields", function () {
      assert.throws(() => connectionSpecFromJSON({}), /missing required fields/);
      assert.throws(() => connectionSpecFromJSON({ id: "test" }), /missing required fields/);
      assert.throws(
        () => connectionSpecFromJSON({ id: "test", name: "Test" }),
        /missing required fields/,
      );
    });
  });

  describe("ConnectionStorage.getInstance()", function () {
    it("should return singleton instance", function () {
      const instance1 = ConnectionStorage.getInstance();
      const instance2 = ConnectionStorage.getInstance();
      assert.strictEqual(instance1, instance2);
    });

    it("should throw when extension context is not set", function () {
      (extensionContext.getExtensionContext as sinon.SinonStub).returns(undefined);
      ConnectionStorage.resetInstance();

      assert.throws(() => ConnectionStorage.getInstance(), /ExtensionContext not set/);
    });
  });

  describe("getAllConnections()", function () {
    it("should return empty map when no connections stored", async function () {
      const storage = ConnectionStorage.getInstance();
      const connections = await storage.getAllConnections();

      assert.strictEqual(connections.size, 0);
    });

    it("should return stored connections", async function () {
      const spec = createTestSpec("conn-1", "Connection 1");
      const data: Record<string, object> = { "conn-1": connectionSpecToJSON(spec) };
      storedData.set("confluent.connections", JSON.stringify(data));

      const storage = ConnectionStorage.getInstance();
      const connections = await storage.getAllConnections();

      assert.strictEqual(connections.size, 1);
      assert.ok(connections.has("conn-1" as ConnectionId));
      const retrieved = connections.get("conn-1" as ConnectionId)!;
      assert.strictEqual(retrieved.name, "Connection 1");
    });

    it("should handle corrupted storage gracefully", async function () {
      storedData.set("confluent.connections", "not valid json");

      const storage = ConnectionStorage.getInstance();
      const connections = await storage.getAllConnections();

      // Should return empty map on parse error
      assert.strictEqual(connections.size, 0);
    });
  });

  describe("getConnection()", function () {
    it("should return null for non-existent connection", async function () {
      const storage = ConnectionStorage.getInstance();
      const spec = await storage.getConnection("non-existent" as ConnectionId);

      assert.strictEqual(spec, null);
    });

    it("should return connection when it exists", async function () {
      const spec = createTestSpec("conn-1", "My Connection");
      storedData.set(
        "confluent.connections",
        JSON.stringify({ "conn-1": connectionSpecToJSON(spec) }),
      );

      const storage = ConnectionStorage.getInstance();
      const retrieved = await storage.getConnection("conn-1" as ConnectionId);

      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, "conn-1");
      assert.strictEqual(retrieved.name, "My Connection");
    });
  });

  describe("saveConnection()", function () {
    it("should save a new connection", async function () {
      const storage = ConnectionStorage.getInstance();
      const spec = createTestSpec("new-conn", "New Connection");

      await storage.saveConnection(spec);

      // Verify it was stored
      const stored = storedData.get("confluent.connections");
      assert.ok(stored);
      const parsed = JSON.parse(stored);
      assert.ok(parsed["new-conn"]);
      assert.strictEqual(parsed["new-conn"].name, "New Connection");
    });

    it("should overwrite existing connection with same ID", async function () {
      const spec1 = createTestSpec("conn-1", "Original Name");
      const spec2 = createTestSpec("conn-1", "Updated Name");

      const storage = ConnectionStorage.getInstance();
      await storage.saveConnection(spec1);
      await storage.saveConnection(spec2);

      const retrieved = await storage.getConnection("conn-1" as ConnectionId);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.name, "Updated Name");
    });

    it("should preserve other connections when saving", async function () {
      const spec1 = createTestSpec("conn-1", "Connection 1");
      const spec2 = createTestSpec("conn-2", "Connection 2");

      const storage = ConnectionStorage.getInstance();
      await storage.saveConnection(spec1);
      await storage.saveConnection(spec2);

      const count = await storage.getConnectionCount();
      assert.strictEqual(count, 2);
    });
  });

  describe("deleteConnection()", function () {
    it("should return false when deleting non-existent connection", async function () {
      const storage = ConnectionStorage.getInstance();
      const deleted = await storage.deleteConnection("non-existent" as ConnectionId);

      assert.strictEqual(deleted, false);
    });

    it("should delete existing connection and return true", async function () {
      const spec = createTestSpec("conn-1", "To Delete");
      const storage = ConnectionStorage.getInstance();
      await storage.saveConnection(spec);

      const deleted = await storage.deleteConnection("conn-1" as ConnectionId);

      assert.strictEqual(deleted, true);
      const retrieved = await storage.getConnection("conn-1" as ConnectionId);
      assert.strictEqual(retrieved, null);
    });

    it("should preserve other connections when deleting", async function () {
      const spec1 = createTestSpec("conn-1", "Keep This");
      const spec2 = createTestSpec("conn-2", "Delete This");

      const storage = ConnectionStorage.getInstance();
      await storage.saveConnection(spec1);
      await storage.saveConnection(spec2);

      await storage.deleteConnection("conn-2" as ConnectionId);

      const remaining = await storage.getConnection("conn-1" as ConnectionId);
      assert.ok(remaining);
      assert.strictEqual(remaining.name, "Keep This");
    });
  });

  describe("deleteAllConnections()", function () {
    it("should delete all connections", async function () {
      const spec1 = createTestSpec("conn-1", "Connection 1");
      const spec2 = createTestSpec("conn-2", "Connection 2");

      const storage = ConnectionStorage.getInstance();
      await storage.saveConnection(spec1);
      await storage.saveConnection(spec2);

      await storage.deleteAllConnections();

      const count = await storage.getConnectionCount();
      assert.strictEqual(count, 0);
    });
  });

  describe("hasConnection()", function () {
    it("should return false for non-existent connection", async function () {
      const storage = ConnectionStorage.getInstance();
      const exists = await storage.hasConnection("non-existent" as ConnectionId);

      assert.strictEqual(exists, false);
    });

    it("should return true for existing connection", async function () {
      const spec = createTestSpec("conn-1", "Test");
      const storage = ConnectionStorage.getInstance();
      await storage.saveConnection(spec);

      const exists = await storage.hasConnection("conn-1" as ConnectionId);

      assert.strictEqual(exists, true);
    });
  });

  describe("getConnectionCount()", function () {
    it("should return 0 for empty storage", async function () {
      const storage = ConnectionStorage.getInstance();
      const count = await storage.getConnectionCount();

      assert.strictEqual(count, 0);
    });

    it("should return correct count", async function () {
      const storage = ConnectionStorage.getInstance();
      await storage.saveConnection(createTestSpec("conn-1", "One"));
      await storage.saveConnection(createTestSpec("conn-2", "Two"));
      await storage.saveConnection(createTestSpec("conn-3", "Three"));

      const count = await storage.getConnectionCount();

      assert.strictEqual(count, 3);
    });
  });

  describe("getConnectionIdsByType()", function () {
    it("should return empty array when no connections of type", async function () {
      const storage = ConnectionStorage.getInstance();
      const ids = await storage.getConnectionIdsByType(ConnectionType.CCLOUD);

      assert.strictEqual(ids.length, 0);
    });

    it("should return only connections of specified type", async function () {
      const directSpec = createTestSpec("direct-1", "Direct Connection");
      const ccloudSpec: ConnectionSpec = {
        id: "ccloud-1" as ConnectionId,
        name: "CCloud Connection",
        type: ConnectionType.CCLOUD,
      };

      const storage = ConnectionStorage.getInstance();
      await storage.saveConnection(directSpec);
      await storage.saveConnection(ccloudSpec);

      const directIds = await storage.getConnectionIdsByType(ConnectionType.DIRECT);
      const ccloudIds = await storage.getConnectionIdsByType(ConnectionType.CCLOUD);

      assert.strictEqual(directIds.length, 1);
      assert.strictEqual(directIds[0], "direct-1");
      assert.strictEqual(ccloudIds.length, 1);
      assert.strictEqual(ccloudIds[0], "ccloud-1");
    });
  });

  describe("dispose()", function () {
    it("should reset the singleton", function () {
      const instance1 = ConnectionStorage.getInstance();
      instance1.dispose();

      // After dispose, getting instance should create a new one
      const instance2 = ConnectionStorage.getInstance();
      assert.notStrictEqual(instance1, instance2);
    });
  });
});
