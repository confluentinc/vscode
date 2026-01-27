import * as assert from "assert";
import { createDirectResourceFetcher } from "./directResourceFetcher";
import { ConnectionType } from "../clients/sidecar";
import { DirectEnvironment } from "../models/environment";
import type { ConnectionId } from "../models/resource";
import type { CustomConnectionSpec } from "../storage/resourceManager";

describe("fetchers/directResourceFetcher", function () {
  function createMockSpec(options: {
    id: string;
    name?: string;
    kafka?: { bootstrap_servers: string; uri?: string };
    schemaRegistry?: { uri: string };
    formConnectionType?: string;
  }): CustomConnectionSpec {
    return {
      id: options.id as ConnectionId,
      name: options.name ?? "Test Connection",
      type: ConnectionType.Direct,
      formConnectionType: (options.formConnectionType ?? "Apache Kafka") as any,
      kafka_cluster: options.kafka
        ? {
            bootstrap_servers: options.kafka.bootstrap_servers,
            uri: options.kafka.uri,
          }
        : undefined,
      schema_registry: options.schemaRegistry
        ? {
            uri: options.schemaRegistry.uri,
          }
        : undefined,
    };
  }

  describe("createDirectResourceFetcher()", function () {
    it("should create a direct resource fetcher", function () {
      const fetcher = createDirectResourceFetcher({
        getConnectionSpec: async () => null,
      });
      assert.ok(fetcher);
      assert.ok(typeof fetcher.buildEnvironment === "function");
      assert.ok(typeof fetcher.buildEnvironmentFromSpec === "function");
    });
  });

  describe("buildEnvironment()", function () {
    it("should return undefined when connection spec not found", async function () {
      const fetcher = createDirectResourceFetcher({
        getConnectionSpec: async () => null,
      });

      const environment = await fetcher.buildEnvironment("conn-123" as ConnectionId);

      assert.strictEqual(environment, undefined);
    });

    it("should build environment from stored connection spec", async function () {
      const spec = createMockSpec({
        id: "conn-123",
        name: "My Connection",
        kafka: { bootstrap_servers: "localhost:9092", uri: "http://localhost:8082" },
      });

      const fetcher = createDirectResourceFetcher({
        getConnectionSpec: async (id) => (id === ("conn-123" as ConnectionId) ? spec : null),
      });

      const environment = await fetcher.buildEnvironment("conn-123" as ConnectionId);

      assert.ok(environment);
      assert.ok(environment instanceof DirectEnvironment);
      assert.strictEqual(environment.name, "My Connection");
      assert.strictEqual(environment.kafkaClusters.length, 1);
    });
  });

  describe("buildEnvironmentFromSpec()", function () {
    it("should build environment with Kafka cluster only", function () {
      const spec = createMockSpec({
        id: "conn-kafka-only",
        name: "Kafka Only",
        kafka: { bootstrap_servers: "broker1:9092,broker2:9092" },
      });

      const fetcher = createDirectResourceFetcher({
        getConnectionSpec: async () => null,
      });

      const environment = fetcher.buildEnvironmentFromSpec(spec);

      assert.ok(environment);
      assert.strictEqual(environment.name, "Kafka Only");
      assert.strictEqual(environment.kafkaClusters.length, 1);
      assert.strictEqual(
        environment.kafkaClusters[0].bootstrapServers,
        "broker1:9092,broker2:9092",
      );
      assert.strictEqual(environment.kafkaConfigured, true);
      assert.strictEqual(environment.schemaRegistry, undefined);
      assert.strictEqual(environment.schemaRegistryConfigured, false);
    });

    it("should build environment with Schema Registry only", function () {
      const spec = createMockSpec({
        id: "conn-sr-only",
        name: "SR Only",
        schemaRegistry: { uri: "http://sr.example.com:8081" },
      });

      const fetcher = createDirectResourceFetcher({
        getConnectionSpec: async () => null,
      });

      const environment = fetcher.buildEnvironmentFromSpec(spec);

      assert.ok(environment);
      assert.strictEqual(environment.name, "SR Only");
      assert.strictEqual(environment.kafkaClusters.length, 0);
      assert.strictEqual(environment.kafkaConfigured, false);
      assert.ok(environment.schemaRegistry);
      assert.strictEqual(environment.schemaRegistry.uri, "http://sr.example.com:8081");
      assert.strictEqual(environment.schemaRegistryConfigured, true);
    });

    it("should build environment with both Kafka and Schema Registry", function () {
      const spec = createMockSpec({
        id: "conn-both",
        name: "Full Connection",
        kafka: { bootstrap_servers: "kafka:9092", uri: "http://kafka:8082" },
        schemaRegistry: { uri: "http://sr:8081" },
      });

      const fetcher = createDirectResourceFetcher({
        getConnectionSpec: async () => null,
      });

      const environment = fetcher.buildEnvironmentFromSpec(spec);

      assert.ok(environment);
      assert.strictEqual(environment.name, "Full Connection");
      assert.strictEqual(environment.kafkaClusters.length, 1);
      assert.strictEqual(environment.kafkaConfigured, true);
      assert.ok(environment.schemaRegistry);
      assert.strictEqual(environment.schemaRegistryConfigured, true);
    });

    it("should set correct connection info on resources", function () {
      const spec = createMockSpec({
        id: "conn-info-test",
        kafka: { bootstrap_servers: "localhost:9092" },
        schemaRegistry: { uri: "http://localhost:8081" },
      });

      const fetcher = createDirectResourceFetcher({
        getConnectionSpec: async () => null,
      });

      const environment = fetcher.buildEnvironmentFromSpec(spec);

      assert.ok(environment);
      assert.strictEqual(environment.connectionId, "conn-info-test");
      assert.strictEqual(environment.connectionType, ConnectionType.Direct);
      assert.strictEqual(environment.kafkaClusters[0].connectionId, "conn-info-test");
      assert.strictEqual(environment.kafkaClusters[0].connectionType, ConnectionType.Direct);
      assert.strictEqual(environment.schemaRegistry!.connectionId, "conn-info-test");
      assert.strictEqual(environment.schemaRegistry!.connectionType, ConnectionType.Direct);
    });

    it("should generate consistent cluster IDs from bootstrap servers", function () {
      const spec1 = createMockSpec({
        id: "conn-1",
        kafka: { bootstrap_servers: "localhost:9092" },
      });
      const spec2 = createMockSpec({
        id: "conn-2",
        kafka: { bootstrap_servers: "localhost:9092" },
      });

      const fetcher = createDirectResourceFetcher({
        getConnectionSpec: async () => null,
      });

      const env1 = fetcher.buildEnvironmentFromSpec(spec1);
      const env2 = fetcher.buildEnvironmentFromSpec(spec2);

      // Same bootstrap servers should generate same cluster ID
      assert.strictEqual(env1.kafkaClusters[0].id, env2.kafkaClusters[0].id);
    });

    it("should generate different cluster IDs for different bootstrap servers", function () {
      const spec1 = createMockSpec({
        id: "conn-1",
        kafka: { bootstrap_servers: "localhost:9092" },
      });
      const spec2 = createMockSpec({
        id: "conn-2",
        kafka: { bootstrap_servers: "remote:9092" },
      });

      const fetcher = createDirectResourceFetcher({
        getConnectionSpec: async () => null,
      });

      const env1 = fetcher.buildEnvironmentFromSpec(spec1);
      const env2 = fetcher.buildEnvironmentFromSpec(spec2);

      // Different bootstrap servers should generate different cluster IDs
      assert.notStrictEqual(env1.kafkaClusters[0].id, env2.kafkaClusters[0].id);
    });

    it("should preserve formConnectionType", function () {
      const spec = createMockSpec({
        id: "conn-type-test",
        kafka: { bootstrap_servers: "localhost:9092" },
        formConnectionType: "Confluent Platform",
      });

      const fetcher = createDirectResourceFetcher({
        getConnectionSpec: async () => null,
      });

      const environment = fetcher.buildEnvironmentFromSpec(spec);

      assert.strictEqual(environment.formConnectionType, "Confluent Platform");
    });

    it("should use default name when spec name is missing", function () {
      const spec: CustomConnectionSpec = {
        id: "conn-no-name" as ConnectionId,
        type: ConnectionType.Direct,
        formConnectionType: "Apache Kafka" as any,
        kafka_cluster: { bootstrap_servers: "localhost:9092" },
      };

      const fetcher = createDirectResourceFetcher({
        getConnectionSpec: async () => null,
      });

      const environment = fetcher.buildEnvironmentFromSpec(spec);

      assert.strictEqual(environment.name, "Direct Connection");
    });

    it("should set Kafka cluster name from spec name", function () {
      const spec = createMockSpec({
        id: "conn-named",
        name: "Production Cluster",
        kafka: { bootstrap_servers: "prod:9092" },
      });

      const fetcher = createDirectResourceFetcher({
        getConnectionSpec: async () => null,
      });

      const environment = fetcher.buildEnvironmentFromSpec(spec);

      assert.strictEqual(environment.kafkaClusters[0].name, "Production Cluster");
    });
  });
});
