import * as assert from "assert";
import sinon from "sinon";
import { ConnectedState, ConnectionType, type ConnectionId } from "../types";
import { CredentialType } from "../credentials";
import type { ConnectionSpec } from "../spec";
import { DirectConnectionHandler } from "./directConnectionHandler";

describe("connections/handlers/directConnectionHandler", function () {
  let sandbox: sinon.SinonSandbox;

  // Base spec with Kafka only
  const kafkaOnlySpec: ConnectionSpec = {
    id: "direct-kafka-only" as ConnectionId,
    name: "Kafka Only Connection",
    type: ConnectionType.DIRECT,
    kafkaCluster: {
      bootstrapServers: "localhost:9092",
    },
  };

  // Spec with Schema Registry only
  const srOnlySpec: ConnectionSpec = {
    id: "direct-sr-only" as ConnectionId,
    name: "SR Only Connection",
    type: ConnectionType.DIRECT,
    schemaRegistry: {
      uri: "http://localhost:8081",
    },
  };

  // Spec with both Kafka and Schema Registry
  const fullSpec: ConnectionSpec = {
    id: "direct-full" as ConnectionId,
    name: "Full Connection",
    type: ConnectionType.DIRECT,
    kafkaCluster: {
      bootstrapServers: "broker1:9092,broker2:9092",
      credentials: {
        type: CredentialType.API_KEY,
        key: "my-api-key",
        secret: "my-api-secret",
      },
    },
    schemaRegistry: {
      uri: "https://schema-registry.example.com",
      credentials: {
        type: CredentialType.BASIC,
        username: "sr-user",
        password: "sr-password",
      },
    },
  };

  // Spec with no endpoints configured
  const emptySpec: ConnectionSpec = {
    id: "direct-empty" as ConnectionId,
    name: "Empty Connection",
    type: ConnectionType.DIRECT,
  };

  beforeEach(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe("constructor", function () {
    it("should create handler with Kafka-only spec", function () {
      const handler = new DirectConnectionHandler(kafkaOnlySpec);

      assert.strictEqual(handler.connectionId, kafkaOnlySpec.id);
      assert.strictEqual(handler.spec.type, ConnectionType.DIRECT);
      assert.strictEqual(handler.isConnected(), false);
    });

    it("should create handler with SR-only spec", function () {
      const handler = new DirectConnectionHandler(srOnlySpec);

      assert.strictEqual(handler.connectionId, srOnlySpec.id);
      assert.strictEqual(handler.isConnected(), false);
    });

    it("should create handler with full spec", function () {
      const handler = new DirectConnectionHandler(fullSpec);

      assert.strictEqual(handler.connectionId, fullSpec.id);
      assert.ok(handler.spec.kafkaCluster);
      assert.ok(handler.spec.schemaRegistry);
    });
  });

  describe("connect()", function () {
    it("should connect to Kafka-only endpoint", async function () {
      const handler = new DirectConnectionHandler(kafkaOnlySpec);

      await handler.connect();

      assert.strictEqual(handler.isConnected(), true);
      const status = await handler.getStatus();
      assert.strictEqual(status.kafkaCluster?.state, ConnectedState.SUCCESS);
      assert.strictEqual(status.schemaRegistry, undefined);
    });

    it("should connect to SR-only endpoint", async function () {
      const handler = new DirectConnectionHandler(srOnlySpec);

      await handler.connect();

      assert.strictEqual(handler.isConnected(), true);
      const status = await handler.getStatus();
      assert.strictEqual(status.schemaRegistry?.state, ConnectedState.SUCCESS);
      assert.strictEqual(status.kafkaCluster, undefined);
    });

    it("should connect to both Kafka and SR endpoints", async function () {
      const handler = new DirectConnectionHandler(fullSpec);

      await handler.connect();

      assert.strictEqual(handler.isConnected(), true);
      const status = await handler.getStatus();
      assert.strictEqual(status.kafkaCluster?.state, ConnectedState.SUCCESS);
      assert.strictEqual(status.schemaRegistry?.state, ConnectedState.SUCCESS);
    });

    it("should fire status change events during connection", async function () {
      const handler = new DirectConnectionHandler(fullSpec);
      const statusEvents: ConnectedState[] = [];

      handler.onStatusChange((event) => {
        if (event.currentStatus.kafkaCluster) {
          statusEvents.push(event.currentStatus.kafkaCluster.state);
        }
      });

      await handler.connect();

      // Should have ATTEMPTING then SUCCESS for Kafka
      assert.ok(statusEvents.includes(ConnectedState.ATTEMPTING));
      assert.ok(statusEvents.includes(ConnectedState.SUCCESS));
    });
  });

  describe("disconnect()", function () {
    it("should disconnect from Kafka-only endpoint", async function () {
      const handler = new DirectConnectionHandler(kafkaOnlySpec);
      await handler.connect();

      await handler.disconnect();

      assert.strictEqual(handler.isConnected(), false);
      const status = await handler.getStatus();
      assert.strictEqual(status.kafkaCluster?.state, ConnectedState.NONE);
    });

    it("should disconnect from both endpoints", async function () {
      const handler = new DirectConnectionHandler(fullSpec);
      await handler.connect();

      await handler.disconnect();

      assert.strictEqual(handler.isConnected(), false);
      const status = await handler.getStatus();
      assert.strictEqual(status.kafkaCluster?.state, ConnectedState.NONE);
      assert.strictEqual(status.schemaRegistry?.state, ConnectedState.NONE);
    });
  });

  describe("testConnection()", function () {
    it("should test Kafka-only connection successfully", async function () {
      const handler = new DirectConnectionHandler(kafkaOnlySpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status?.kafkaCluster?.state, ConnectedState.SUCCESS);
    });

    it("should test SR-only connection successfully", async function () {
      const handler = new DirectConnectionHandler(srOnlySpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status?.schemaRegistry?.state, ConnectedState.SUCCESS);
    });

    it("should test full connection successfully", async function () {
      const handler = new DirectConnectionHandler(fullSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.status?.kafkaCluster?.state, ConnectedState.SUCCESS);
      assert.strictEqual(result.status?.schemaRegistry?.state, ConnectedState.SUCCESS);
    });

    it("should fail when no endpoints configured", async function () {
      const handler = new DirectConnectionHandler(emptySpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("No endpoints configured"));
    });

    it("should fail with invalid bootstrap server format", async function () {
      const invalidSpec: ConnectionSpec = {
        ...kafkaOnlySpec,
        id: "invalid" as ConnectionId,
        kafkaCluster: {
          bootstrapServers: "invalid-server-no-port",
        },
      };
      const handler = new DirectConnectionHandler(invalidSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("Invalid server format"));
    });

    it("should fail with invalid Schema Registry URI", async function () {
      const invalidSpec: ConnectionSpec = {
        ...srOnlySpec,
        id: "invalid" as ConnectionId,
        schemaRegistry: {
          uri: "not-a-valid-uri",
        },
      };
      const handler = new DirectConnectionHandler(invalidSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("Invalid URI format"));
    });

    it("should fail with missing Basic auth username", async function () {
      const invalidSpec: ConnectionSpec = {
        ...kafkaOnlySpec,
        id: "invalid" as ConnectionId,
        kafkaCluster: {
          bootstrapServers: "localhost:9092",
          credentials: {
            type: CredentialType.BASIC,
            username: "",
            password: "pass",
          },
        },
      };
      const handler = new DirectConnectionHandler(invalidSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("Basic auth requires username"));
    });

    it("should fail with missing API key secret", async function () {
      const invalidSpec: ConnectionSpec = {
        ...kafkaOnlySpec,
        id: "invalid" as ConnectionId,
        kafkaCluster: {
          bootstrapServers: "localhost:9092",
          credentials: {
            type: CredentialType.API_KEY,
            key: "my-key",
            secret: "",
          },
        },
      };
      const handler = new DirectConnectionHandler(invalidSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("API key auth requires secret"));
    });
  });

  describe("getStatus()", function () {
    it("should return current status", async function () {
      const handler = new DirectConnectionHandler(fullSpec);
      await handler.connect();

      const status = await handler.getStatus();

      assert.ok(status.kafkaCluster);
      assert.ok(status.schemaRegistry);
    });

    it("should only include configured endpoints", async function () {
      const handler = new DirectConnectionHandler(kafkaOnlySpec);
      await handler.connect();

      const status = await handler.getStatus();

      assert.ok(status.kafkaCluster);
      assert.strictEqual(status.schemaRegistry, undefined);
    });
  });

  describe("refreshCredentials()", function () {
    it("should return false for non-OAuth credentials", async function () {
      const handler = new DirectConnectionHandler(fullSpec);

      const result = await handler.refreshCredentials();

      assert.strictEqual(result, false);
    });

    it("should return false for OAuth credentials (pending Phase 2)", async function () {
      const oauthSpec: ConnectionSpec = {
        ...kafkaOnlySpec,
        id: "oauth" as ConnectionId,
        kafkaCluster: {
          bootstrapServers: "localhost:9092",
          credentials: {
            type: CredentialType.OAUTH,
            tokenEndpoint: "https://auth.example.com/token",
            clientId: "my-client",
          },
        },
      };
      const handler = new DirectConnectionHandler(oauthSpec);

      const result = await handler.refreshCredentials();

      // Returns false until Phase 2 OAuth implementation
      assert.strictEqual(result, false);
    });
  });

  describe("isConnected()", function () {
    it("should return false before connect", function () {
      const handler = new DirectConnectionHandler(kafkaOnlySpec);

      assert.strictEqual(handler.isConnected(), false);
    });

    it("should return true after successful connect", async function () {
      const handler = new DirectConnectionHandler(kafkaOnlySpec);
      await handler.connect();

      assert.strictEqual(handler.isConnected(), true);
    });

    it("should return false after disconnect", async function () {
      const handler = new DirectConnectionHandler(kafkaOnlySpec);
      await handler.connect();
      await handler.disconnect();

      assert.strictEqual(handler.isConnected(), false);
    });
  });

  describe("getOverallState()", function () {
    it("should return NONE when no endpoints configured", function () {
      const handler = new DirectConnectionHandler(emptySpec);

      assert.strictEqual(handler.getOverallState(), ConnectedState.NONE);
    });

    it("should return NONE before connect", function () {
      const handler = new DirectConnectionHandler(kafkaOnlySpec);

      assert.strictEqual(handler.getOverallState(), ConnectedState.NONE);
    });

    it("should return SUCCESS when all configured endpoints succeed", async function () {
      const handler = new DirectConnectionHandler(fullSpec);
      await handler.connect();

      assert.strictEqual(handler.getOverallState(), ConnectedState.SUCCESS);
    });

    it("should return NONE after disconnect", async function () {
      const handler = new DirectConnectionHandler(kafkaOnlySpec);
      await handler.connect();
      await handler.disconnect();

      assert.strictEqual(handler.getOverallState(), ConnectedState.NONE);
    });
  });

  describe("credential validation", function () {
    it("should accept SCRAM credentials", async function () {
      const scramSpec: ConnectionSpec = {
        ...kafkaOnlySpec,
        id: "scram" as ConnectionId,
        kafkaCluster: {
          bootstrapServers: "localhost:9092",
          credentials: {
            type: CredentialType.SCRAM,
            mechanism: "SHA-256",
            username: "scram-user",
            password: "scram-pass",
          },
        },
      };
      const handler = new DirectConnectionHandler(scramSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, true);
    });

    it("should fail SCRAM credentials without username", async function () {
      const scramSpec: ConnectionSpec = {
        ...kafkaOnlySpec,
        id: "scram" as ConnectionId,
        kafkaCluster: {
          bootstrapServers: "localhost:9092",
          credentials: {
            type: CredentialType.SCRAM,
            mechanism: "SHA-256",
            username: "",
            password: "scram-pass",
          },
        },
      };
      const handler = new DirectConnectionHandler(scramSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("SCRAM auth requires username"));
    });

    it("should accept mTLS credentials", async function () {
      const mtlsSpec: ConnectionSpec = {
        ...kafkaOnlySpec,
        id: "mtls" as ConnectionId,
        kafkaCluster: {
          bootstrapServers: "localhost:9092",
          credentials: {
            type: CredentialType.MTLS,
            certificatePath: "/path/to/cert.pem",
            keyPath: "/path/to/key.pem",
          },
        },
      };
      const handler = new DirectConnectionHandler(mtlsSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, true);
    });

    it("should fail mTLS credentials without certificate path", async function () {
      const mtlsSpec: ConnectionSpec = {
        ...kafkaOnlySpec,
        id: "mtls" as ConnectionId,
        kafkaCluster: {
          bootstrapServers: "localhost:9092",
          credentials: {
            type: CredentialType.MTLS,
            certificatePath: "",
            keyPath: "/path/to/key.pem",
          },
        },
      };
      const handler = new DirectConnectionHandler(mtlsSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("mTLS requires certificate path"));
    });

    it("should accept Kerberos credentials", async function () {
      const kerberosSpec: ConnectionSpec = {
        ...kafkaOnlySpec,
        id: "kerberos" as ConnectionId,
        kafkaCluster: {
          bootstrapServers: "localhost:9092",
          credentials: {
            type: CredentialType.KERBEROS,
            principal: "kafka/host@REALM",
          },
        },
      };
      const handler = new DirectConnectionHandler(kerberosSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, true);
    });

    it("should fail Kerberos credentials without principal", async function () {
      const kerberosSpec: ConnectionSpec = {
        ...kafkaOnlySpec,
        id: "kerberos" as ConnectionId,
        kafkaCluster: {
          bootstrapServers: "localhost:9092",
          credentials: {
            type: CredentialType.KERBEROS,
            principal: "",
          },
        },
      };
      const handler = new DirectConnectionHandler(kerberosSpec);

      const result = await handler.testConnection();

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes("Kerberos requires principal"));
    });
  });

  describe("dispose()", function () {
    it("should clean up connection state on dispose", async function () {
      const handler = new DirectConnectionHandler(kafkaOnlySpec);
      await handler.connect();

      handler.dispose();

      assert.strictEqual(handler.isConnected(), false);
    });
  });
});
