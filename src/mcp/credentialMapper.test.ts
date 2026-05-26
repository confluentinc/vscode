import assert from "assert";
import { connectionSpecToMcpEnv, McpEnvVar } from "./credentialMapper";
import { HashAlgorithm } from "../clients/sidecar";
import type { CustomConnectionSpec } from "../storage/resourceManager";
import type { ConnectionId } from "../models/resource";

/** Minimal spec factory for test readability. */
function makeSpec(overrides: Partial<CustomConnectionSpec> = {}): CustomConnectionSpec {
  return {
    id: "test-conn" as ConnectionId,
    formConnectionType: "Apache Kafka",
    ...overrides,
  } as CustomConnectionSpec;
}

describe("mcp/credentialMapper.ts connectionSpecToMcpEnv()", () => {
  it("should return empty env when spec has no kafka or schema registry", () => {
    const env = connectionSpecToMcpEnv(makeSpec());

    assert.deepStrictEqual(env, {});
  });

  it("should map Kafka bootstrap servers", () => {
    const env = connectionSpecToMcpEnv(
      makeSpec({
        kafka_cluster: { bootstrap_servers: "broker1:9092,broker2:9092" },
      }),
    );

    assert.strictEqual(env[McpEnvVar.BOOTSTRAP_SERVERS], "broker1:9092,broker2:9092");
    assert.strictEqual(Object.keys(env).length, 1);
  });

  it("should map Kafka API key credentials", () => {
    const env = connectionSpecToMcpEnv(
      makeSpec({
        kafka_cluster: {
          bootstrap_servers: "broker:9092",
          credentials: { api_key: "my-key", api_secret: "my-secret" },
        },
      }),
    );

    assert.strictEqual(env[McpEnvVar.BOOTSTRAP_SERVERS], "broker:9092");
    assert.strictEqual(env[McpEnvVar.KAFKA_API_KEY], "my-key");
    assert.strictEqual(env[McpEnvVar.KAFKA_API_SECRET], "my-secret");
  });

  it("should map Kafka Basic credentials as API key/secret", () => {
    const env = connectionSpecToMcpEnv(
      makeSpec({
        kafka_cluster: {
          bootstrap_servers: "broker:9092",
          credentials: { username: "user", password: "pass" },
        },
      }),
    );

    assert.strictEqual(env[McpEnvVar.KAFKA_API_KEY], "user");
    assert.strictEqual(env[McpEnvVar.KAFKA_API_SECRET], "pass");
  });

  it("should map Schema Registry URI and API key credentials", () => {
    const env = connectionSpecToMcpEnv(
      makeSpec({
        schema_registry: {
          uri: "https://sr.example.com",
          credentials: { api_key: "sr-key", api_secret: "sr-secret" },
        },
      }),
    );

    assert.strictEqual(env[McpEnvVar.SCHEMA_REGISTRY_ENDPOINT], "https://sr.example.com");
    assert.strictEqual(env[McpEnvVar.SCHEMA_REGISTRY_API_KEY], "sr-key");
    assert.strictEqual(env[McpEnvVar.SCHEMA_REGISTRY_API_SECRET], "sr-secret");
  });

  it("should map Schema Registry Basic credentials as API key/secret", () => {
    const env = connectionSpecToMcpEnv(
      makeSpec({
        schema_registry: {
          uri: "https://sr.example.com",
          credentials: { username: "sr-user", password: "sr-pass" },
        },
      }),
    );

    assert.strictEqual(env[McpEnvVar.SCHEMA_REGISTRY_API_KEY], "sr-user");
    assert.strictEqual(env[McpEnvVar.SCHEMA_REGISTRY_API_SECRET], "sr-pass");
  });

  it("should ignore unsupported credential types (SCRAM)", () => {
    const env = connectionSpecToMcpEnv(
      makeSpec({
        kafka_cluster: {
          bootstrap_servers: "broker:9092",
          credentials: {
            hash_algorithm: HashAlgorithm._256,
            scram_username: "u",
            scram_password: "p",
          },
        },
      }),
    );

    // bootstrap servers mapped, but no credential env vars
    assert.strictEqual(env[McpEnvVar.BOOTSTRAP_SERVERS], "broker:9092");
    assert.strictEqual(env[McpEnvVar.KAFKA_API_KEY], undefined);
    assert.strictEqual(env[McpEnvVar.KAFKA_API_SECRET], undefined);
  });

  it("should map both Kafka and Schema Registry together", () => {
    const env = connectionSpecToMcpEnv(
      makeSpec({
        kafka_cluster: {
          bootstrap_servers: "broker:9092",
          credentials: { api_key: "k-key", api_secret: "k-secret" },
        },
        schema_registry: {
          uri: "https://sr.example.com",
          credentials: { api_key: "sr-key", api_secret: "sr-secret" },
        },
      }),
    );

    assert.strictEqual(Object.keys(env).length, 6);
    assert.strictEqual(env[McpEnvVar.BOOTSTRAP_SERVERS], "broker:9092");
    assert.strictEqual(env[McpEnvVar.KAFKA_API_KEY], "k-key");
    assert.strictEqual(env[McpEnvVar.KAFKA_API_SECRET], "k-secret");
    assert.strictEqual(env[McpEnvVar.SCHEMA_REGISTRY_ENDPOINT], "https://sr.example.com");
    assert.strictEqual(env[McpEnvVar.SCHEMA_REGISTRY_API_KEY], "sr-key");
  });
});
