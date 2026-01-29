import * as assert from "assert";
import sinon from "sinon";
import type { ConnectionSpec } from "../spec";
import { ConnectedState, ConnectionType, type ConnectionId } from "../types";
import { LocalConnectionHandler } from "./localConnectionHandler";
import * as httpClient from "../../proxy/httpClient";
import * as schemaRegistryProxy from "../../proxy/schemaRegistryProxy";

describe("connections/handlers/localConnectionHandler", function () {
  let sandbox: sinon.SinonSandbox;

  // Standard local connection spec (Kafka only)
  const kafkaOnlySpec: ConnectionSpec = {
    id: "vscode-local-connection" as ConnectionId,
    name: "Local",
    type: ConnectionType.Local,
  };

  // Local connection with Schema Registry
  const fullSpec: ConnectionSpec = {
    id: "vscode-local-connection" as ConnectionId,
    name: "Local",
    type: ConnectionType.Local,
    localConfig: {
      schemaRegistryUri: "http://localhost:8081",
    },
  };

  // Mock HTTP client that returns successful cluster response
  let mockHttpClient: sinon.SinonStubbedInstance<httpClient.HttpClient>;
  // Mock Schema Registry proxy
  let mockSrProxy: sinon.SinonStubbedInstance<schemaRegistryProxy.SchemaRegistryProxy>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // Create mock HTTP client
    mockHttpClient = {
      get: sandbox.stub().resolves({
        status: 200,
        statusText: "OK",
        headers: new Headers(),
        data: { data: [{ cluster_id: "local-cluster-id" }] },
        ok: true,
      }),
      post: sandbox.stub().resolves({ status: 200, data: {}, ok: true }),
      put: sandbox.stub().resolves({ status: 200, data: {}, ok: true }),
      patch: sandbox.stub().resolves({ status: 200, data: {}, ok: true }),
      delete: sandbox.stub().resolves({ status: 200, data: {}, ok: true }),
      request: sandbox.stub().resolves({ status: 200, data: {}, ok: true }),
    } as unknown as sinon.SinonStubbedInstance<httpClient.HttpClient>;

    // Stub createHttpClient to return our mock
    sandbox.stub(httpClient, "createHttpClient").returns(mockHttpClient);

    // Create mock Schema Registry proxy
    mockSrProxy = {
      listSubjects: sandbox.stub().resolves(["test-subject"]),
    } as unknown as sinon.SinonStubbedInstance<schemaRegistryProxy.SchemaRegistryProxy>;

    // Stub createSchemaRegistryProxy to return our mock
    sandbox.stub(schemaRegistryProxy, "createSchemaRegistryProxy").returns(mockSrProxy);
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("constructor", function () {
    it("should create handler with Kafka-only spec", function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);

      assert.strictEqual(handler.connectionId, kafkaOnlySpec.id);
      assert.strictEqual(handler.spec.type, ConnectionType.Local);
      assert.strictEqual(handler.isConnected(), false);
    });

    it("should create handler with full spec", function () {
      const handler = new LocalConnectionHandler(fullSpec);

      assert.strictEqual(handler.connectionId, fullSpec.id);
      assert.strictEqual(handler.spec.localConfig?.schemaRegistryUri, "http://localhost:8081");
    });

    it("should use default Kafka REST URI", function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);

      assert.strictEqual(handler.getKafkaRestUri(), "http://localhost:8082");
    });
  });

  describe("connect()", function () {
    it("should connect to local Kafka", async function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);

      await handler.connect();

      assert.strictEqual(handler.isConnected(), true);
      const status = await handler.getStatus();
      assert.strictEqual(status.kafkaCluster?.state, ConnectedState.SUCCESS);
    });

    it("should connect to both Kafka and Schema Registry", async function () {
      const handler = new LocalConnectionHandler(fullSpec);

      await handler.connect();

      assert.strictEqual(handler.isConnected(), true);
      const status = await handler.getStatus();
      assert.strictEqual(status.kafkaCluster?.state, ConnectedState.SUCCESS);
      assert.strictEqual(status.schemaRegistry?.state, ConnectedState.SUCCESS);
    });

    it("should fire status change events during connection", async function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);
      const statusEvents: ConnectedState[] = [];

      handler.onStatusChange((event) => {
        if (event.currentStatus.kafkaCluster) {
          statusEvents.push(event.currentStatus.kafkaCluster.state);
        }
      });

      await handler.connect();

      // Should have ATTEMPTING then SUCCESS
      assert.ok(statusEvents.includes(ConnectedState.ATTEMPTING));
      assert.ok(statusEvents.includes(ConnectedState.SUCCESS));
    });
  });

  describe("disconnect()", function () {
    it("should disconnect from local Kafka", async function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);
      await handler.connect();

      await handler.disconnect();

      assert.strictEqual(handler.isConnected(), false);
      const status = await handler.getStatus();
      assert.strictEqual(status.kafkaCluster?.state, ConnectedState.NONE);
    });

    it("should disconnect from both endpoints", async function () {
      const handler = new LocalConnectionHandler(fullSpec);
      await handler.connect();

      await handler.disconnect();

      assert.strictEqual(handler.isConnected(), false);
      const status = await handler.getStatus();
      assert.strictEqual(status.kafkaCluster?.state, ConnectedState.NONE);
      assert.strictEqual(status.schemaRegistry?.state, ConnectedState.NONE);
    });
  });

  describe("testConnection()", function () {
    it("should test local Kafka connection successfully", async function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status?.kafkaCluster?.state, ConnectedState.SUCCESS);
    });

    it("should test full connection successfully", async function () {
      const handler = new LocalConnectionHandler(fullSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status?.kafkaCluster?.state, ConnectedState.SUCCESS);
      assert.strictEqual(result.status?.schemaRegistry?.state, ConnectedState.SUCCESS);
    });

    it("should fail with invalid Kafka REST URI", async function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);
      handler.setKafkaRestUri("not-a-valid-uri");

      const result = await handler.testConnection();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("Invalid URI format"));
    });

    it("should fail with invalid Schema Registry URI", async function () {
      const invalidSpec: ConnectionSpec = {
        ...kafkaOnlySpec,
        localConfig: {
          schemaRegistryUri: "invalid-uri",
        },
      };
      const handler = new LocalConnectionHandler(invalidSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("Invalid URI format"));
    });
  });

  describe("getStatus()", function () {
    it("should return current status for Kafka only", async function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);
      await handler.connect();

      const status = await handler.getStatus();

      assert.ok(status.kafkaCluster);
      assert.strictEqual(status.schemaRegistry, undefined);
    });

    it("should return current status for both endpoints", async function () {
      const handler = new LocalConnectionHandler(fullSpec);
      await handler.connect();

      const status = await handler.getStatus();

      assert.ok(status.kafkaCluster);
      assert.ok(status.schemaRegistry);
    });
  });

  describe("refreshCredentials()", function () {
    it("should return false (local connections don't use expiring credentials)", async function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);

      const result = await handler.refreshCredentials();

      assert.strictEqual(result, false);
    });
  });

  describe("isConnected()", function () {
    it("should return false before connect", function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);

      assert.strictEqual(handler.isConnected(), false);
    });

    it("should return true after successful connect", async function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);
      await handler.connect();

      assert.strictEqual(handler.isConnected(), true);
    });

    it("should return false after disconnect", async function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);
      await handler.connect();
      await handler.disconnect();

      assert.strictEqual(handler.isConnected(), false);
    });
  });

  describe("getOverallState()", function () {
    it("should return NONE before connect", function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);

      assert.strictEqual(handler.getOverallState(), ConnectedState.NONE);
    });

    it("should return SUCCESS when Kafka succeeds", async function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);
      await handler.connect();

      assert.strictEqual(handler.getOverallState(), ConnectedState.SUCCESS);
    });

    it("should return SUCCESS when both Kafka and SR succeed", async function () {
      const handler = new LocalConnectionHandler(fullSpec);
      await handler.connect();

      assert.strictEqual(handler.getOverallState(), ConnectedState.SUCCESS);
    });

    it("should return NONE after disconnect", async function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);
      await handler.connect();
      await handler.disconnect();

      assert.strictEqual(handler.getOverallState(), ConnectedState.NONE);
    });
  });

  describe("setKafkaRestUri()", function () {
    it("should update the Kafka REST URI", function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);

      handler.setKafkaRestUri("http://localhost:9082");

      assert.strictEqual(handler.getKafkaRestUri(), "http://localhost:9082");
    });
  });

  describe("dispose()", function () {
    it("should clean up connection state on dispose", async function () {
      const handler = new LocalConnectionHandler(kafkaOnlySpec);
      await handler.connect();

      handler.dispose();

      assert.strictEqual(handler.isConnected(), false);
    });
  });
});
