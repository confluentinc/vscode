import * as assert from "assert";
import { CredentialType } from "./credentials";
import {
  defaultTLSConfig,
  disabledTLSConfig,
  FormConnectionType,
  hasKafkaCluster,
  hasSchemaRegistry,
  validateConnectionSpec,
  type ConnectionSpec,
} from "./spec";
import { ConnectionType, type ConnectionId } from "./types";

describe("connections/spec", function () {
  describe("FormConnectionType enum", function () {
    it("should have all expected values", function () {
      assert.strictEqual(FormConnectionType.CCLOUD, "Confluent Cloud");
      assert.strictEqual(FormConnectionType.LOCAL, "Local");
      assert.strictEqual(FormConnectionType.APACHE_KAFKA, "Apache Kafka");
      assert.strictEqual(FormConnectionType.OTHER, "Other");
    });
  });

  describe("defaultTLSConfig()", function () {
    it("should create TLS config with TLS enabled", function () {
      const config = defaultTLSConfig();
      assert.strictEqual(config.enabled, true);
      assert.strictEqual(config.verifyHostname, true);
    });
  });

  describe("disabledTLSConfig()", function () {
    it("should create TLS config with TLS disabled", function () {
      const config = disabledTLSConfig();
      assert.strictEqual(config.enabled, false);
    });
  });

  describe("validateConnectionSpec()", function () {
    const validSpec: ConnectionSpec = {
      id: "test-id" as ConnectionId,
      name: "Test Connection",
      type: ConnectionType.Direct,
    };

    it("should return no errors for a valid spec", function () {
      const errors = validateConnectionSpec(validSpec);
      assert.strictEqual(errors.length, 0);
    });

    it("should return error for missing id", function () {
      const spec = { ...validSpec, id: "" as ConnectionId };
      const errors = validateConnectionSpec(spec);
      assert.ok(errors.some((e) => e.includes("ID")));
    });

    it("should return error for missing name", function () {
      const spec = { ...validSpec, name: "" };
      const errors = validateConnectionSpec(spec);
      assert.ok(errors.some((e) => e.includes("name")));
    });

    it("should return error for whitespace-only name", function () {
      const spec = { ...validSpec, name: "   " };
      const errors = validateConnectionSpec(spec);
      assert.ok(errors.some((e) => e.includes("name")));
    });

    it("should return error for missing Kafka bootstrap servers when kafkaCluster is defined", function () {
      const spec: ConnectionSpec = {
        ...validSpec,
        kafkaCluster: { bootstrapServers: "" },
      };
      const errors = validateConnectionSpec(spec);
      assert.ok(errors.some((e) => e.includes("bootstrap servers")));
    });

    it("should return error for missing Schema Registry URI when schemaRegistry is defined", function () {
      const spec: ConnectionSpec = {
        ...validSpec,
        schemaRegistry: { uri: "" },
      };
      const errors = validateConnectionSpec(spec);
      assert.ok(errors.some((e) => e.includes("Schema Registry URI")));
    });

    it("should return no errors for valid spec with kafkaCluster", function () {
      const spec: ConnectionSpec = {
        ...validSpec,
        kafkaCluster: { bootstrapServers: "localhost:9092" },
      };
      const errors = validateConnectionSpec(spec);
      assert.strictEqual(errors.length, 0);
    });

    it("should return no errors for valid spec with schemaRegistry", function () {
      const spec: ConnectionSpec = {
        ...validSpec,
        schemaRegistry: { uri: "http://localhost:8081" },
      };
      const errors = validateConnectionSpec(spec);
      assert.strictEqual(errors.length, 0);
    });
  });

  describe("hasKafkaCluster()", function () {
    it("should return true when kafkaCluster has bootstrap servers", function () {
      const spec: ConnectionSpec = {
        id: "test" as ConnectionId,
        name: "Test",
        type: ConnectionType.Direct,
        kafkaCluster: { bootstrapServers: "localhost:9092" },
      };
      assert.strictEqual(hasKafkaCluster(spec), true);
    });

    it("should return false when kafkaCluster is undefined", function () {
      const spec: ConnectionSpec = {
        id: "test" as ConnectionId,
        name: "Test",
        type: ConnectionType.Direct,
      };
      assert.strictEqual(hasKafkaCluster(spec), false);
    });

    it("should return false when kafkaCluster has empty bootstrap servers", function () {
      const spec: ConnectionSpec = {
        id: "test" as ConnectionId,
        name: "Test",
        type: ConnectionType.Direct,
        kafkaCluster: { bootstrapServers: "" },
      };
      assert.strictEqual(hasKafkaCluster(spec), false);
    });
  });

  describe("hasSchemaRegistry()", function () {
    it("should return true when schemaRegistry has URI", function () {
      const spec: ConnectionSpec = {
        id: "test" as ConnectionId,
        name: "Test",
        type: ConnectionType.Direct,
        schemaRegistry: { uri: "http://localhost:8081" },
      };
      assert.strictEqual(hasSchemaRegistry(spec), true);
    });

    it("should return false when schemaRegistry is undefined", function () {
      const spec: ConnectionSpec = {
        id: "test" as ConnectionId,
        name: "Test",
        type: ConnectionType.Direct,
      };
      assert.strictEqual(hasSchemaRegistry(spec), false);
    });

    it("should return false when schemaRegistry has empty URI", function () {
      const spec: ConnectionSpec = {
        id: "test" as ConnectionId,
        name: "Test",
        type: ConnectionType.Direct,
        schemaRegistry: { uri: "" },
      };
      assert.strictEqual(hasSchemaRegistry(spec), false);
    });
  });

  describe("ConnectionSpec with credentials", function () {
    it("should allow Kafka cluster with Basic credentials", function () {
      const spec: ConnectionSpec = {
        id: "test" as ConnectionId,
        name: "Test",
        type: ConnectionType.Direct,
        kafkaCluster: {
          bootstrapServers: "localhost:9092",
          credentials: {
            type: CredentialType.BASIC,
            username: "user",
            password: "pass",
          },
        },
      };
      assert.strictEqual(spec.kafkaCluster?.credentials?.type, CredentialType.BASIC);
    });

    it("should allow Schema Registry with API Key credentials", function () {
      const spec: ConnectionSpec = {
        id: "test" as ConnectionId,
        name: "Test",
        type: ConnectionType.Direct,
        schemaRegistry: {
          uri: "http://localhost:8081",
          credentials: {
            type: CredentialType.API_KEY,
            apiKey: "key",
            apiSecret: "secret",
          },
        },
      };
      assert.strictEqual(spec.schemaRegistry?.credentials?.type, CredentialType.API_KEY);
    });

    it("should allow TLS configuration", function () {
      const spec: ConnectionSpec = {
        id: "test" as ConnectionId,
        name: "Test",
        type: ConnectionType.Direct,
        kafkaCluster: {
          bootstrapServers: "localhost:9092",
          ssl: {
            enabled: true,
            verifyHostname: true,
            truststore: {
              path: "/path/to/truststore.jks",
              password: "changeit",
              type: "JKS",
            },
          },
        },
      };
      assert.strictEqual(spec.kafkaCluster?.ssl?.enabled, true);
      assert.strictEqual(spec.kafkaCluster?.ssl?.truststore?.type, "JKS");
    });
  });
});
