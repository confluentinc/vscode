import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import {
  TEST_DIRECT_CONNECTION,
  TEST_DIRECT_CONNECTION_FORM_SPEC,
} from "../tests/unit/testResources/connection";
import type { ConnectedState } from "./connections";
import {
  deepMerge,
  getConnectionSpecFromFormData,
  handleConnectionChange,
  parseTestResult,
} from "./directConnect";
import type { CustomConnectionSpec } from "./storage/resourceManager";
import { ResourceManager } from "./storage/resourceManager";

describe("directConnect.ts", () => {
  describe("getConnectionSpecFromFormData", () => {
    it("should not include `schema_registry` if uri not provided", async () => {
      const formData = {
        name: "Test Connection",
        formConnectionType: "Apache Kafka",
        "kafka_cluster.bootstrapServers": "localhost:9092",
        "kafka_cluster.auth_type": "None",
        "schema_registry.auth_type": "None",
        "schema_registry.ssl.enabled": "true",
      };

      const spec = getConnectionSpecFromFormData(formData);

      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafkaCluster);
      assert.strictEqual(spec.kafkaCluster.bootstrapServers, "localhost:9092");
      assert.strictEqual(spec.schemaRegistry, undefined);
    });
    it("should not include `kafka_cluster` if bootstrap server not provided", async () => {
      const formData = {
        name: "Test Connection",
        formConnectionType: "Apache Kafka",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "None",
        "kafka_cluster.ssl.enabled": "true",
        "kafka_cluster.ssl.truststore.path": "fakepath!",
      };

      const spec = getConnectionSpecFromFormData(formData);
      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(!spec.kafkaCluster);
      assert.strictEqual(spec.schemaRegistry?.uri, "http://localhost:8081");
    });
    it("should return a valid CustomConnectionSpec with Basic auth credentials", () => {
      const formData = {
        name: "Test Connection",
        formConnectionType: "Kafka",
        "kafka_cluster.bootstrapServers": "localhost:9092",
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
      assert.ok(spec.kafkaCluster);
      assert.strictEqual(spec.kafkaCluster.bootstrapServers, "localhost:9092");
      assert.ok(spec.kafkaCluster.credentials);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.username, "user");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.password, "pass");
      assert.ok(spec.schemaRegistry);
      assert.ok(spec.schemaRegistry.uri);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.ok(!spec.schemaRegistry?.credentials?.api_key);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.ok(!spec.schemaRegistry?.credentials?.api_secret);
      assert.strictEqual(spec.schemaRegistry.uri, "http://localhost:8081");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.schemaRegistry?.credentials?.username, "user");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.schemaRegistry?.credentials?.password, "pass");
    });
    it("should return a valid CustomConnectionSpec with API key credentials", () => {
      const formData = {
        name: "Test Connection",
        formConnectionType: "Kafka",
        "kafka_cluster.bootstrapServers": "localhost:9092",
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
      assert.ok(spec.kafkaCluster);
      assert.strictEqual(spec.kafkaCluster.bootstrapServers, "localhost:9092");
      assert.ok(spec.kafkaCluster.credentials);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.apiKey, "key");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.apiSecret, "secret");
      assert.ok(spec.schemaRegistry);
      assert.ok(spec.schemaRegistry.uri);
      assert.strictEqual(spec.schemaRegistry.uri, "http://localhost:8081");
      assert.ok(spec.schemaRegistry.credentials);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.ok(!spec.schemaRegistry?.credentials?.username);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.ok(!spec.schemaRegistry?.credentials?.password);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.schemaRegistry?.credentials?.apiKey, "key");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.schemaRegistry?.credentials?.apiSecret, "secret");
    });
    it("should return a valid CustomConnectionSpec with SCRAM credentials", () => {
      const formData = {
        name: "Test Connection",
        formConnectionType: "Kafka",
        "kafka_cluster.bootstrapServers": "localhost:9092",
        "kafka_cluster.auth_type": "SCRAM",
        "kafka_cluster.credentials.hash_algorithm": "SCRAM_SHA_512",
        "kafka_cluster.credentials.scram_username": "user",
        "kafka_cluster.credentials.scram_password": "pass",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "None",
      };
      const spec = getConnectionSpecFromFormData(formData);
      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafkaCluster);
      assert.strictEqual(spec.kafkaCluster.bootstrapServers, "localhost:9092");
      assert.ok(spec.kafkaCluster.credentials);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.hashAlgorithm, "SCRAM_SHA_512");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.scramUsername, "user");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.scramPassword, "pass");
      assert.ok(spec.schemaRegistry);
      assert.ok(spec.schemaRegistry.uri);
      assert.strictEqual(spec.schemaRegistry.uri, "http://localhost:8081");
      assert.strictEqual(spec.schemaRegistry.credentials, undefined);
    });
    it("should return a valid CustomConnectionSpec with OAuth credentials", () => {
      const formData = {
        name: "Test Connection",
        formConnectionType: "Kafka",
        "kafka_cluster.bootstrapServers": "localhost:9092",
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
      assert.ok(spec.kafkaCluster);
      assert.strictEqual(spec.kafkaCluster.bootstrapServers, "localhost:9092");
      assert.ok(spec.kafkaCluster.credentials);

      assert.strictEqual(
        // @ts-expect-error - incomplete types from OpenAPI
        spec.kafkaCluster?.credentials?.tokensUrl,
        "http://localhost:8080/token",
      );
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.clientId, "clientid");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.clientSecret, "clientsecret");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.scope, "read write");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.connectTimeoutMillis, "5000");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.ccloudLogicalClusterId, "lkc-123456");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.ccloudIdentityPoolId, "pool-12345");

      assert.ok(spec.schemaRegistry);
      assert.ok(spec.schemaRegistry.uri);
      assert.strictEqual(spec.schemaRegistry.uri, "http://localhost:8081");
      assert.strictEqual(spec.schemaRegistry.credentials, undefined);
    });
    it("should return a valid CustomConnectionSpec with Kerberos credentials", () => {
      const formData = {
        name: "Test Connection",
        formConnectionType: "Kafka",
        "kafka_cluster.bootstrapServers": "localhost:9092",
        "kafka_cluster.auth_type": "Kerberos",
        "kafka_cluster.credentials.principal": "user@EXAMPLE.COM",
        "kafka_cluster.credentials.keytab_path": "/path/to/keytab",
        "kafka_cluster.credentials.service_name": "kafka",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "None",
      };

      const spec = getConnectionSpecFromFormData(formData);

      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafkaCluster);
      assert.strictEqual(spec.kafkaCluster.bootstrapServers, "localhost:9092");
      assert.ok(spec.kafkaCluster.credentials);
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.principal, "user@EXAMPLE.COM");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.keytabPath, "/path/to/keytab");
      // @ts-expect-error - incomplete types from OpenAPI
      assert.strictEqual(spec.kafkaCluster?.credentials?.serviceName, "kafka");
      assert.ok(spec.schemaRegistry);
      assert.ok(spec.schemaRegistry.uri);
      assert.strictEqual(spec.schemaRegistry.uri, "http://localhost:8081");
      assert.strictEqual(spec.schemaRegistry.credentials, undefined);
    });

    it("should not include credentials if the auth type is None", () => {
      const formData = {
        name: "Test Connection",
        formConnectionType: "Apache Kafka",
        "kafka_cluster.bootstrapServers": "localhost:9092",
        "kafka_cluster.auth_type": "None",
        "schema_registry.uri": "http://localhost:8081",
        "schema_registry.auth_type": "None",
      };

      const spec = getConnectionSpecFromFormData(formData);

      assert.strictEqual(spec.name, "Test Connection");
      assert.ok(spec.kafkaCluster);
      assert.strictEqual(spec.kafkaCluster.bootstrapServers, "localhost:9092");
      assert.ok(!spec.kafkaCluster.credentials);
      assert.ok(spec.schemaRegistry);
      assert.ok(spec.schemaRegistry.uri);
      assert.strictEqual(spec.schemaRegistry.uri, "http://localhost:8081");
      assert.ok(!spec.schemaRegistry.credentials);
    });
    it("should not include truststore or keystore for kafka if paths are empty", () => {
      const formData = {
        name: "Test Connection",
        formConnectionType: "Kafka",
        "kafka_cluster.bootstrapServers": "localhost:9092",
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
      assert.ok(spec.kafkaCluster);
      assert.strictEqual(spec.kafkaCluster.bootstrapServers, "localhost:9092");
      assert.ok(spec.schemaRegistry);
      assert.strictEqual(spec.schemaRegistry.uri, "http://localhost:8081");
      assert.ok(spec.kafkaCluster.ssl);
      assert.ok(!spec.kafkaCluster.ssl.truststore);
      assert.ok(!spec.kafkaCluster.ssl.keystore);
    });
    it("should include keystore and truststore information if paths are provided", () => {
      const formData = {
        name: "Test Connection",
        formConnectionType: "Apache Kafka",
        "kafka_cluster.bootstrapServers": "localhost:9092",
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
      assert.ok(spec.kafkaCluster);
      assert.ok(spec.kafkaCluster.ssl);
      // keystore path was missing, we should not include values in that section
      assert.ok(!spec.kafkaCluster.ssl.keystore);
      // truststore path was provided, we should include all values in that section
      assert.ok(spec.kafkaCluster.ssl.truststore);
      assert.strictEqual(spec.kafkaCluster.ssl.truststore.path, "/path/to/truststore");
      assert.strictEqual(spec.kafkaCluster.ssl.truststore.password, "trustpass");
      assert.strictEqual(spec.kafkaCluster.ssl.truststore.type, "JKS");
    });
    it("should not include truststore or keystore for schema if paths are empty", () => {
      const formData = {
        name: "Test Connection",
        formConnectionType: "Kafka",
        "kafka_cluster.bootstrapServers": "localhost:9092",
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
      assert.ok(spec.kafkaCluster);
      assert.strictEqual(spec.kafkaCluster.bootstrapServers, "localhost:9092");
      assert.ok(spec.schemaRegistry);
      assert.strictEqual(spec.schemaRegistry.uri, "http://localhost:8081");
      assert.ok(spec.schemaRegistry.ssl);
      assert.ok(!spec.schemaRegistry.ssl.truststore);
      assert.ok(!spec.schemaRegistry.ssl.keystore);
    });
    it("filters out credentials that dont match the auth type submitted", () => {
      const formData = {
        name: "Mixed Auth Fields",
        formConnectionType: "kafka",
        "kafka_cluster.bootstrapServers": "localhost:9092",
        "kafka_cluster.auth_type": "Basic",
        "kafka_cluster.credentials.username": "testuser",
        "kafka_cluster.credentials.password": "testpass",
        // These should be filtered out since auth type is Basic
        "kafka_cluster.credentials.api_key": "should-not-appear",
        "kafka_cluster.credentials.tokens_url": "should-not-appear",
        "kafka_cluster.credentials.scram_username": "should-not-appear",
      };

      const result = getConnectionSpecFromFormData(formData);

      assert.deepStrictEqual(result.kafkaCluster?.credentials, {
        username: "testuser",
        password: "testpass",
      });
    });
    it("should correctly set `kafka_cluster.clientIdSuffix` for WarpStream connections", () => {
      const formData = {
        name: "WarpStream Connection",
        formConnectionType: "WarpStream",
        "kafka_cluster.bootstrapServers": "localhost:9092",
        "kafka_cluster.client_id_suffix": ",ws_host_override=localhost",
      };

      const spec = getConnectionSpecFromFormData(formData);
      assert.ok(spec.kafkaCluster);
      assert.strictEqual(spec.kafkaCluster.clientIdSuffix, ",ws_host_override=localhost");
    });
  });

  describe("parseTestResult", () => {
    it("should return success: false if either connection is FAILED", () => {
      const result = parseTestResult({
        ...TEST_DIRECT_CONNECTION,
        status: {
          kafkaCluster: { state: "FAILED" as ConnectedState },
          schemaRegistry: { state: "CONNECTED" as ConnectedState },
        },
      });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.message, "One or more connections failed.");
    });

    it("should return success: true if connection states are not FAILED", () => {
      const connection = {
        ...TEST_DIRECT_CONNECTION,
        status: {
          kafkaCluster: { state: "CONNECTED" as ConnectedState },
          schemaRegistry: { state: "CONNECTED" as ConnectedState },
        },
      };

      const result = parseTestResult(connection);
      assert.strictEqual(result.success, true);
    });
    it("should return a combined message from all kafka connection errors", () => {
      const connection = {
        ...TEST_DIRECT_CONNECTION,
        status: {
          kafkaCluster: {
            state: "FAILED" as ConnectedState,
            errors: [
              { message: "Invalid username" },
              { message: "Invalid password" },
              { message: "Token refresh failed" },
            ],
          },
          schemaRegistry: { state: "CONNECTED" as ConnectedState },
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
          kafkaCluster: { state: "CONNECTED" as ConnectedState },
          schemaRegistry: {
            state: "FAILED" as ConnectedState,
            errors: [
              { message: "Invalid username" },
              { message: "Invalid password" },
              { message: "Token refresh failed" },
            ],
          },
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
          kafkaCluster: {
            state: "FAILED" as ConnectedState,
            errors: [{ message: "Invalid username" }],
          },
          schemaRegistry: {
            state: "FAILED" as ConnectedState,
            errors: [{ message: "Unable to reach server" }],
          },
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
        kafkaCluster: {
          bootstrap_servers: "server1:9092",
          ssl: {
            enabled: true,
            truststore: { path: "/path/to/trust" },
          },
        },
        schemaRegistry: {
          uri: "http://localhost:8081",
        },
      };
      const obj2 = {
        name: "Connection2",
        kafkaCluster: {
          bootstrap_servers: "server2:9092",
          ssl: {
            enabled: false,
          },
        },
        schemaRegistry: {
          credentials: {
            username: "user",
            password: "pass",
          },
        },
      };
      const expected = {
        name: "Connection2",
        kafkaCluster: {
          bootstrap_servers: "server2:9092",
          ssl: {
            enabled: false,
            truststore: { path: "/path/to/trust" },
          },
        },
        schemaRegistry: {
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
      stubResourceManager = sandbox.createStubInstance(ResourceManager);
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
      sinon.assert.calledOnce(mockDispose);
      sinon.assert.calledOnceWithExactly(
        mockShowInformationMessage,
        `Connection "${testConnection.name}" is disconnected.`,
      );
    });

    it("should not close the form when connection still exists", async () => {
      // Arrange: Create a test connection
      const testConnection: CustomConnectionSpec = TEST_DIRECT_CONNECTION_FORM_SPEC;

      (stubResourceManager.getDirectConnection as sinon.SinonStub).resolves(testConnection);

      // Act: Handle the connection change
      await handleConnectionChange(testConnection, { dispose: mockDispose } as any);

      // Assert: Verify the form was not disposed
      sinon.assert.notCalled(mockDispose);
    });
  });
});
