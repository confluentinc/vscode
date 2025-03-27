import * as vscode from "vscode";
import * as assert from "assert";
import { parseTestResult, getConnectionSpecFromFormData, deepMerge } from "./directConnect";
import {
  TEST_DIRECT_CONNECTION,
  TEST_DIRECT_CONNECTION_FORM_SPEC,
} from "../tests/unit/testResources/connection";
import { ConnectedState, Status } from "./clients/sidecar";
import { CustomConnectionSpec } from "./storage/resourceManager";
import sinon from "sinon";
import { ResourceManager } from "./storage/resourceManager";
import { handleConnectionChange } from "./directConnect";

describe("directConnect.ts", () => {
  describe("getConnectionSpecFromFormData", () => {
    it("should not include `schema_registry` if uri not provided", async () => {
      const formData = {
        name: "Test Connection",
        formconnectiontype: "Apache Kafka",
        "kafka_cluster.bootstrap_servers": "localhost:9092",
        "kafka_cluster.auth_type": "None",
        "schema_registry.auth_type": "None",
        "schema_registry.ssl.enabled": "true",
      };

      const spec = getConnectionSpecFromFormData(formData);

      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafka_cluster);
      assert.strictEqual(spec.kafka_cluster.bootstrap_servers, "localhost:9092");
      assert.strictEqual(spec.schema_registry, undefined);
    });
    it("should not include `kafka_cluster` if bootstrap server not provided", async () => {
      const formData = {
        name: "Test Connection",
        formconnectiontype: "Apache Kafka",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "None",
        "kafka_cluster.ssl.enabled": "true",
        "kafka_cluster.ssl.truststore.path": "fakepath!",
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
    it("should return a valid CustomConnectionSpec with SCRAM credentials", () => {
      const formData = {
        name: "Test Connection",
        formconnectiontype: "Kafka",
        "kafka_cluster.bootstrap_servers": "localhost:9092",
        "kafka_cluster.auth_type": "SCRAM",
        "kafka_cluster.credentials.hash_algorithm": "SCRAM_SHA_512",
        "kafka_cluster.credentials.scram_username": "user",
        "kafka_cluster.credentials.scram_password": "pass",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "None",
      };
      const spec = getConnectionSpecFromFormData(formData);
      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafka_cluster);
      assert.strictEqual(spec.kafka_cluster.bootstrap_servers, "localhost:9092");
      assert.ok(spec.kafka_cluster.credentials);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.hash_algorithm, "SCRAM_SHA_512");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.scram_username, "user");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.scram_password, "pass");
      assert.ok(spec.schema_registry);
      assert.ok(spec.schema_registry.uri);
      assert.strictEqual(spec.schema_registry.uri, "http://localhost:8081");
      assert.strictEqual(spec.schema_registry.credentials, undefined);
    });
    it("should return a valid CustomConnectionSpec with OAuth credentials", () => {
      const formData = {
        name: "Test Connection",
        formconnectiontype: "Kafka",
        "kafka_cluster.bootstrap_servers": "localhost:9092",
        "kafka_cluster.auth_type": "OAuth",
        "kafka_cluster.credentials.tokens_url": "http://localhost:8080/token",
        "kafka_cluster.credentials.client_id": "clientid",
        "kafka_cluster.credentials.client_secret": "clientsecret",
        "kafka_cluster.credentials.scope": "read write",
        "kafka_cluster.credentials.connect_timeout_millis": "5000",
        "kafka_cluster.credentials.ccloud_logical_cluster_id": "lkc-123456",
        "kafka_cluster.credentials.ccloud_identity_pool_id": "pool-12345",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "None",
      };

      const spec = getConnectionSpecFromFormData(formData);
      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafka_cluster);
      assert.strictEqual(spec.kafka_cluster.bootstrap_servers, "localhost:9092");
      assert.ok(spec.kafka_cluster.credentials);

      assert.strictEqual(
        // @ts-expect-error - incomplete types from OpenAPI
        spec.kafka_cluster?.credentials?.tokens_url,
        "http://localhost:8080/token",
      );
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.client_id, "clientid");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.client_secret, "clientsecret");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.scope, "read write");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.connect_timeout_millis, "5000");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.ccloud_logical_cluster_id, "lkc-123456");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.ccloud_identity_pool_id, "pool-12345");

      assert.ok(spec.schema_registry);
      assert.ok(spec.schema_registry.uri);
      assert.strictEqual(spec.schema_registry.uri, "http://localhost:8081");
      assert.strictEqual(spec.schema_registry.credentials, undefined);
    });
    it("should return a valid CustomConnectionSpec with Kerberos credentials", () => {
      const formData = {
        name: "Test Connection",
        formconnectiontype: "Kafka",
        "kafka_cluster.bootstrap_servers": "localhost:9092",
        "kafka_cluster.auth_type": "Kerberos",
        "kafka_cluster.credentials.principal": "user@EXAMPLE.COM",
        "kafka_cluster.credentials.keytab_path": "/path/to/keytab",
        "kafka_cluster.credentials.service_name": "kafka",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "None",
      };

      const spec = getConnectionSpecFromFormData(formData);

      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafka_cluster);
      assert.strictEqual(spec.kafka_cluster.bootstrap_servers, "localhost:9092");
      assert.ok(spec.kafka_cluster.credentials);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.principal, "user@EXAMPLE.COM");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.keytab_path, "/path/to/keytab");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafka_cluster?.credentials?.service_name, "kafka");
      assert.ok(spec.schema_registry);
      assert.ok(spec.schema_registry.uri);
      assert.strictEqual(spec.schema_registry.uri, "http://localhost:8081");
      assert.strictEqual(spec.schema_registry.credentials, undefined);
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
    it("should include keystore and truststore information if paths are provided", () => {
      const formData = {
        name: "Test Connection",
        formconnectiontype: "Apache Kafka",
        "kafka_cluster.bootstrap_servers": "localhost:9092",
        "kafka_cluster.auth_type": "None",
        "kafka_cluster.ssl.enabled": "true",
        "kafka_cluster.ssl.keystore.type": "PEM",
        "kafka_cluster.ssl.keystore.password": "keypass",
        "kafka_cluster.ssl.keystore.key_password": "keykeypass",
        "kafka_cluster.ssl.truststore.path": "/path/to/truststore",
        "kafka_cluster.ssl.truststore.password": "trustpass",
        "kafka_cluster.ssl.truststore.type": "JKS",
        "schema_registry.uri": "",
        "schema_registry.auth_type": "None",
        "schema_registry.ssl.enabled": "true",
      };

      const spec = getConnectionSpecFromFormData(formData);

      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafka_cluster);
      assert.ok(spec.kafka_cluster.ssl);
      // keystore path was missing, we should not include values in that section
      assert.ok(!spec.kafka_cluster.ssl.keystore);
      // truststore path was provided, we should include all values in that section
      assert.ok(spec.kafka_cluster.ssl.truststore);
      assert.strictEqual(spec.kafka_cluster.ssl.truststore.path, "/path/to/truststore");
      assert.strictEqual(spec.kafka_cluster.ssl.truststore.password, "trustpass");
      assert.strictEqual(spec.kafka_cluster.ssl.truststore.type, "JKS");
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
    it("filters out credentials that dont match the auth type submitted", () => {
      const formData = {
        name: "Mixed Auth Fields",
        formconnectiontype: "kafka",
        "kafka_cluster.bootstrap_servers": "localhost:9092",
        "kafka_cluster.auth_type": "Basic",
        "kafka_cluster.credentials.username": "testuser",
        "kafka_cluster.credentials.password": "testpass",
        // These should be filtered out since auth type is Basic
        "kafka_cluster.credentials.api_key": "should-not-appear",
        "kafka_cluster.credentials.tokens_url": "should-not-appear",
        "kafka_cluster.credentials.scram_username": "should-not-appear",
      };

      const result = getConnectionSpecFromFormData(formData);

      assert.deepStrictEqual(result.kafka_cluster?.credentials, {
        username: "testuser",
        password: "testpass",
      });
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
  describe("deepMerge", () => {
    it("should merge two connection specs & include nested fields", () => {
      const obj1 = {
        name: "Connection1",
        kafka_cluster: {
          bootstrap_servers: "server1:9092",
          ssl: {
            enabled: true,
            truststore: { path: "/path/to/trust" },
          },
        },
        schema_registry: {
          uri: "http://localhost:8081",
        },
      };
      const obj2 = {
        name: "Connection2",
        kafka_cluster: {
          bootstrap_servers: "server2:9092",
          ssl: {
            enabled: false,
          },
        },
        schema_registry: {
          credentials: {
            username: "user",
            password: "pass",
          },
        },
      };
      const expected = {
        name: "Connection2",
        kafka_cluster: {
          bootstrap_servers: "server2:9092",
          ssl: {
            enabled: false,
            truststore: { path: "/path/to/trust" },
          },
        },
        schema_registry: {
          uri: "http://localhost:8081",
          credentials: {
            username: "user",
            password: "pass",
          },
        },
      };
      const result = deepMerge(obj1, obj2);
      assert.deepStrictEqual(result, expected);
    });
    it("should handle empty objects", () => {
      const obj1 = { name: "test", ssl: {} };
      const obj2 = { ssl: { enabled: true } };
      const result = deepMerge(obj1, obj2);
      assert.deepStrictEqual(result, { name: "test", ssl: { enabled: true } });
    });
  });

  describe("handleConnectionChange", () => {
    let sandbox: sinon.SinonSandbox;
    let mockDispose: sinon.SinonStub;
    let mockShowInformationMessage: sinon.SinonStub;
    let stubResourceManager: sinon.SinonStubbedInstance<ResourceManager>;

    beforeEach(() => {
      sandbox = sinon.createSandbox();

      // Mock WebviewPanel
      mockDispose = sandbox.stub();

      // Mock window.showInformationMessage
      mockShowInformationMessage = sandbox.stub(vscode.window, "showInformationMessage");

      // Mock resource manager with required methods
      stubResourceManager = sinon.createStubInstance(ResourceManager);
      sandbox.stub(ResourceManager, "getInstance").returns(stubResourceManager);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it("should close the form when connection is removed", async () => {
      // Arrange: Create a test connection
      const testConnection: CustomConnectionSpec = TEST_DIRECT_CONNECTION_FORM_SPEC;

      // Setup mock for getDirectConnections to simulate connection removed
      stubResourceManager.getDirectConnection.resolves(null);

      // Act: Handle the connection change
      await handleConnectionChange(testConnection, { dispose: mockDispose } as any);

      // Assert: Verify the form was disposed
      assert.strictEqual(mockDispose.calledOnce, true, "Expected dispose to be called once");
      assert.strictEqual(
        mockShowInformationMessage.calledOnceWithExactly(
          `Connection "${testConnection.name}" is disconnected.`,
        ),
        true,
        "Expected showInformationMessage to be called with the correct removal notification",
      );
    });

    it("should not close the form when connection still exists", async () => {
      // Arrange: Create a test connection
      const testConnection: CustomConnectionSpec = TEST_DIRECT_CONNECTION_FORM_SPEC;

      (stubResourceManager.getDirectConnection as sinon.SinonStub).resolves(testConnection);

      // Act: Handle the connection change
      await handleConnectionChange(testConnection, { dispose: mockDispose } as any);

      // Assert: Verify the form was not disposed
      assert.strictEqual(mockDispose.called, false, "Expected dispose not to be called");
      assert.strictEqual(
        mockShowInformationMessage.called,
        false,
        "Expected showInformationMessage not to be called",
      );
    });
  });
});
