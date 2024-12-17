import assert from "assert";
import { parseTestResult, getConnectionSpecFromFormData } from "./directConnect";
import { TEST_DIRECT_CONNECTION } from "../tests/unit/testResources/connection";
import { ConnectedState, Status } from "./clients/sidecar";

describe("directConnect.ts", () => {
  describe("getConnectionSpecFromFormData", () => {
    it("should not include `schema_registry` if not provided", async () => {
      const formData = {
        name: "Test Connection",
        platform: "Kafka",
        bootstrap_servers: "localhost:9092",
        kafka_auth_type: "None",
      };

      const spec = getConnectionSpecFromFormData(formData);

      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafka_cluster);
      assert.strictEqual(spec.kafka_cluster.bootstrap_servers, "localhost:9092");
      assert.strictEqual(spec.schema_registry, undefined);
    });

    it("should not include `kafka_cluster` if not provided", async () => {
      const formData = {
        name: "Test Connection",
        platform: "Kafka",
        uri: "http://localhost:8081",
        schema_auth_type: "API",
        schema_api_key: "key",
        schema_api_secret: "secret",
      };

      const spec = getConnectionSpecFromFormData(formData);

      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(!spec.kafka_cluster);
      assert.strictEqual(spec.schema_registry?.uri, "http://localhost:8081");
    });
    it("should return a valid CustomConnectionSpec with Basic auth credentials", () => {
      const formData = {
        name: "Test Connection",
        platform: "Kafka",
        bootstrap_servers: "localhost:9092",
        kafka_auth_type: "Basic",
        kafka_username: "user",
        kafka_password: "pass",
        uri: "http://localhost:8081",
        schema_auth_type: "Basic",
        schema_username: "user",
        schema_password: "pass",
      };

      const spec = getConnectionSpecFromFormData(formData);

      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafka_cluster);
      assert.strictEqual(spec.kafka_cluster.bootstrap_servers, "localhost:9092");
      assert.ok(spec.kafka_cluster.credentials);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.username, "user");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.password, "pass");
      assert.ok(spec.schema_registry);
      assert.ok(spec.schema_registry.uri);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.ok(!spec.schema_registry?.credentials?.api_key);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.ok(!spec.schema_registry?.credentials?.api_secret);
      assert.strictEqual(spec.schema_registry.uri, "http://localhost:8081");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.schema_registry?.credentials?.username, "user");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.schema_registry?.credentials?.password, "pass");
    });

    it("should return a valid CustomConnectionSpec with API key credentials", () => {
      const formData = {
        name: "Test Connection",
        platform: "Kafka",
        bootstrap_servers: "localhost:9092",
        kafka_auth_type: "API",
        kafka_api_key: "key",
        kafka_api_secret: "secret",
        uri: "http://localhost:8081",
        schema_auth_type: "API",
        schema_api_key: "key",
        schema_api_secret: "secret",
      };
      const spec = getConnectionSpecFromFormData(formData);

      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafka_cluster);
      assert.strictEqual(spec.kafka_cluster.bootstrap_servers, "localhost:9092");
      assert.ok(spec.kafka_cluster.credentials);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.api_key, "key");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.api_secret, "secret");
      assert.ok(spec.schema_registry);
      assert.ok(spec.schema_registry.uri);
      assert.strictEqual(spec.schema_registry.uri, "http://localhost:8081");
      assert.ok(spec.schema_registry.credentials);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.ok(!spec.schema_registry?.credentials?.username);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.ok(!spec.schema_registry?.credentials?.password);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.schema_registry?.credentials?.api_key, "key");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.schema_registry?.credentials?.api_secret, "secret");
    });
    it("should not include credentials if the auth type is None", () => {
      const formData = {
        name: "Test Connection",
        platform: "Kafka",
        bootstrap_servers: "localhost:9092",
        kafka_auth_type: "None",
        uri: "http://localhost:8081",
        schema_auth_type: "None",
      };

      const spec = getConnectionSpecFromFormData(formData);

      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafka_cluster);
      assert.strictEqual(spec.kafka_cluster.bootstrap_servers, "localhost:9092");
      assert.ok(!spec.kafka_cluster.credentials);
      assert.ok(spec.schema_registry);
      assert.ok(spec.schema_registry.uri);
      assert.strictEqual(spec.schema_registry.uri, "http://localhost:8081");
      assert.ok(!spec.schema_registry.credentials);
    });
  });

  describe.only("parseTestResult", () => {
    it("should return success: false if either connection is FAILED", () => {
      const result = parseTestResult({
        ...TEST_DIRECT_CONNECTION,
        status: {
          kafka_cluster: { state: "FAILED" as ConnectedState },
          schema_registry: { state: "CONNECTED" as ConnectedState },
          authentication: { status: "NO_TOKEN" as Status },
        },
      });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, "\nKafka State: FAILED");
    });

    it("should return success: true if connection states are not FAILED", () => {
      const connection = {
        ...TEST_DIRECT_CONNECTION,
        status: {
          kafka_cluster: { state: "CONNECTED" as ConnectedState },
          schema_registry: { state: "CONNECTED" as ConnectedState },
          authentication: { status: "NO_TOKEN" as Status },
        },
      };

      const result = parseTestResult(connection);
      assert.strictEqual(result.success, true);
    });
    it("should return a combined message from the connection errors", () => {
      const connection = {
        ...TEST_DIRECT_CONNECTION,
        status: {
          kafka_cluster: {
            state: "FAILED" as ConnectedState,
            errors: {
              auth_status_check: { message: "Invalid username" },
              sign_in: { message: "Invalid password" },
              token_refresh: { message: "Token refresh failed" },
            },
          },
          schema_registry: { state: "CONNECTED" as ConnectedState },
          authentication: { status: "NO_TOKEN" as Status },
        },
      };

      const result = parseTestResult(connection);
      assert.strictEqual(result.success, false);
      assert.strictEqual(
        result.message,
        "\nKafka State: FAILED\nInvalid username Invalid password Token refresh failed",
      );
    });

    it("should return messages from both kafka and schema registry connection errors", () => {
      const connection = {
        ...TEST_DIRECT_CONNECTION,
        status: {
          kafka_cluster: {
            state: "FAILED" as ConnectedState,
            errors: {
              auth_status_check: { message: "Invalid username" },
              sign_in: undefined,
              token_refresh: undefined,
            },
          },
          schema_registry: {
            state: "FAILED" as ConnectedState,
            errors: {
              auth_status_check: undefined,
              sign_in: { message: "Unable to reach server" },
              token_refresh: undefined,
            },
          },
          authentication: { status: "NO_TOKEN" as Status },
        },
      };

      const result = parseTestResult(connection);
      assert.strictEqual(result.success, false);
      assert.strictEqual(
        result.message,
        "\nKafka State: FAILED\nInvalid username\nSchema Registry State: FAILED\nUnable to reach server",
      );
    });
  });
});
