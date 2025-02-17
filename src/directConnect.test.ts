import assert from "assert";
import { parseTestResult, getConnectionSpecFromFormData, cleanSpec } from "./directConnect";
import { TEST_DIRECT_CONNECTION } from "../tests/unit/testResources/connection";
import { ConnectedState, Status } from "./clients/sidecar";
import { ConnectionId } from "./models/resource";
import { FormConnectionType } from "./webview/direct-connect-form";

describe("directConnect.ts", () => {
  describe("getConnectionSpecFromFormData", () => {
    it("should not include `schema_registry` if not provided", async () => {
      const formData = {
        name: "Test Connection",
        formconnectiontype: "Apache Kafka",
        "kafka_cluster.bootstrap_servers": "localhost:9092",
        "kafka_cluster.auth_type": "None",
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
        formconnectiontype: "Apache Kafka",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "None",
      };

      const spec = getConnectionSpecFromFormData(formData);
      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(!spec.kafka_cluster);
      assert.strictEqual(spec.schema_registry?.uri, "http://localhost:8081");
    });
    it("should return a valid CustomConnectionSpec with Basic auth credentials", () => {
      const formData = {
        name: "Test Connection",
        formconnectiontype: "Kafka",
        "kafka_cluster.bootstrap_servers": "localhost:9092",
        "kafka_cluster.auth_type": "Basic",
        "kafka_cluster.credentials.username": "user",
        "kafka_cluster.credentials.password": "pass",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "Basic",
        "schema_registry.credentials.username": "user",
        "schema_registry.credentials.password": "pass",
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
        formconnectiontype: "Kafka",
        "kafka_cluster.bootstrap_servers": "localhost:9092",
        "kafka_cluster.auth_type": "API",
        "kafka_cluster.credentials.api_key": "key",
        "kafka_cluster.credentials.api_secret": "secret",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "API",
        "schema_registry.credentials.api_key": "key",
        "schema_registry.credentials.api_secret": "secret",
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
        formconnectiontype: "Apache Kafka",
        "kafka_cluster.bootstrap_servers": "localhost:9092",
        "kafka_cluster.auth_type": "None",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "None",
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
    it("should not include truststore or keystore for kafka if paths are empty", () => {
      const formData = {
        name: "Test Connection",
        formconnectiontype: "Kafka",
        "kafka_cluster.bootstrap_servers": "localhost:9092",
        "kafka_cluster.auth_type": "None",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "None",
        "kafka_cluster.ssl.enabled": "true",
        "kafka_cluster.ssl.truststore.path": "",
        "kafka_cluster.ssl.truststore.password": "hello",
        "kafka_cluster.ssl.keystore.path": "",
        "kafka_cluster.ssl.keystore.password": "world",
      };

      const spec = getConnectionSpecFromFormData(formData);

      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafka_cluster);
      assert.strictEqual(spec.kafka_cluster.bootstrap_servers, "localhost:9092");
      assert.ok(spec.schema_registry);
      assert.strictEqual(spec.schema_registry.uri, "http://localhost:8081");
      assert.ok(spec.kafka_cluster.ssl);
      assert.ok(!spec.kafka_cluster.ssl.truststore);
      assert.ok(!spec.kafka_cluster.ssl.keystore);
    });
    it("should not include truststore or keystore for schema if paths are empty", () => {
      const formData = {
        name: "Test Connection",
        formconnectiontype: "Kafka",
        "kafka_cluster.bootstrap_servers": "localhost:9092",
        "kafka_cluster.auth_type": "None",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "None",
        "schema_registry.ssl.enabled": "true",
        "schema_registry.ssl.truststore.path": "",
        "schema_registry.ssl.truststore.password": "hello",
        "schema_registry.ssl.keystore.path": "",
        "schema_registry.ssl.keystore.password": "world",
      };

      const spec = getConnectionSpecFromFormData(formData);

      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafka_cluster);
      assert.strictEqual(spec.kafka_cluster.bootstrap_servers, "localhost:9092");
      assert.ok(spec.schema_registry);
      assert.strictEqual(spec.schema_registry.uri, "http://localhost:8081");
      assert.ok(spec.schema_registry.ssl);
      assert.ok(!spec.schema_registry.ssl.truststore);
      assert.ok(!spec.schema_registry.ssl.keystore);
    });
  });

  describe("parseTestResult", () => {
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
      assert.strictEqual(result.message, "One or more connections failed.");
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
    it("should return a combined message from all kafka connection errors", () => {
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
        result.testResults.kafkaErrorMessage,
        "Invalid username Invalid password Token refresh failed",
      );
    });
    it("should return a combined message from all schema registry connection errors", () => {
      const connection = {
        ...TEST_DIRECT_CONNECTION,
        status: {
          kafka_cluster: { state: "CONNECTED" as ConnectedState },
          schema_registry: {
            state: "FAILED" as ConnectedState,
            errors: {
              auth_status_check: { message: "Invalid username" },
              sign_in: { message: "Invalid password" },
              token_refresh: { message: "Token refresh failed" },
            },
          },
          authentication: { status: "NO_TOKEN" as Status },
        },
      };

      const result = parseTestResult(connection);
      assert.strictEqual(result.success, false);
      assert.strictEqual(
        result.testResults.schemaErrorMessage,
        "Invalid username Invalid password Token refresh failed",
      );
    });

    it("should return messages for both kafka and schema registry connection errors", () => {
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
      assert.strictEqual(result.message, "One or more connections failed.");
      assert.strictEqual(result.testResults.schemaErrorMessage, "Unable to reach server");
      assert.strictEqual(result.testResults.kafkaErrorMessage, "Invalid username");
    });
  });
  describe("cleanSpec", () => {
    it("should replace password fields in Basic credentials with `fakeplaceholdersecrethere` text", () => {
      const spec = {
        id: "123" as ConnectionId,
        formConnectionType: "Apache Kafka" as FormConnectionType,
        name: "Test Connection",
        kafka_cluster: {
          bootstrap_servers: "localhost:9092",
          credentials: {
            username: "user",
            password: "password",
          },
        },
        schema_registry: {
          uri: "http://localhost:8081",
          credentials: {
            username: "user",
            password: "password",
          },
        },
      };
      const result = cleanSpec(spec);
      assert.strictEqual(result.name, "Test Connection");
      // @ts-expect-error - could be api but we're using password here
      assert.strictEqual(result.kafka_cluster?.credentials?.password, "fakeplaceholdersecrethere");
      assert.strictEqual(
        // @ts-expect-error - could be api but we're using password here
        result.schema_registry?.credentials?.password,
        "fakeplaceholdersecrethere",
      );
    });
    it("should replace password fields in API credentials with `fakeplaceholdersecrethere` text", () => {
      const spec = {
        id: "123" as ConnectionId,
        formConnectionType: "Apache Kafka" as FormConnectionType,
        name: "Test Connection",
        kafka_cluster: {
          bootstrap_servers: "localhost:9092",
          credentials: {
            api_key: "key",
            api_secret: "secret",
          },
        },
        schema_registry: {
          uri: "http://localhost:8081",
          credentials: {
            api_key: "key",
            api_secret: "secret",
          },
        },
      };
      const result = cleanSpec(spec);
      assert.strictEqual(result.name, "Test Connection");
      assert.strictEqual(
        // @ts-expect-error - could be password but we're using api here
        result.kafka_cluster?.credentials?.api_secret,
        "fakeplaceholdersecrethere",
      );
      assert.strictEqual(
        // @ts-expect-error - could be password but we're using api here
        result.schema_registry?.credentials?.api_secret,
        "fakeplaceholdersecrethere",
      );
    });
    it("should replace password fields in SSL with `fakeplaceholdersecrethere` text", () => {
      const spec = {
        id: "123" as ConnectionId,
        formConnectionType: "Apache Kafka" as FormConnectionType,
        name: "Test Connection",
        kafka_cluster: {
          bootstrap_servers: "localhost:9092",
          ssl: {
            enabled: true,
            truststore: {
              path: "/path/to/truststore",
              password: "password",
            },
            keystore: {
              path: "/path/to/keystore",
              password: "password",
              key_password: "keypassword",
            },
          },
        },
        schema_registry: {
          uri: "http://localhost:8081",
          ssl: {
            enabled: true,
            truststore: {
              path: "/path/to/truststore",
              password: "password",
            },
            keystore: {
              path: "/path/to/keystore",
              password: "password",
              key_password: "keypassword",
            },
          },
        },
      };
      const result = cleanSpec(spec);
      assert.strictEqual(result.name, "Test Connection");
      assert.strictEqual(
        result.kafka_cluster?.ssl?.truststore?.password,
        "fakeplaceholdersecrethere",
      );
      assert.strictEqual(
        result.kafka_cluster?.ssl?.keystore?.password,
        "fakeplaceholdersecrethere",
      );
      assert.strictEqual(
        result.kafka_cluster?.ssl?.keystore?.key_password,
        "fakeplaceholdersecrethere",
      );
    });
  });
});
