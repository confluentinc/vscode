import * as assert from "assert";
import sinon from "sinon";
import { MarkdownString } from "vscode";
import {
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_DIRECT_SCHEMA_REGISTRY,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../../tests/unit/testResources";
import {
  TEST_AUTHENTICATED_CCLOUD_CONNECTION,
  TEST_DIRECT_CONNECTION,
  TEST_LOCAL_CONNECTION,
} from "../../../tests/unit/testResources/connection";
import { ConnectedState, Connection, ConnectionFromJSON } from "../../clients/sidecar";
import * as contextValues from "../../context/values";
import {
  summarizeCCloudConnection,
  summarizeConnection,
  summarizeDirectConnection,
  summarizeLocalConnection,
} from "./connections";

describe("chat/summarizers/connections.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let getContextValueStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    getContextValueStub = sandbox.stub(contextValues, "getContextValue");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("summarizeConnection() should summarize a `CCLOUD` connection", () => {
    const connection: Connection = TEST_AUTHENTICATED_CCLOUD_CONNECTION;

    const result: string = summarizeConnection(TEST_AUTHENTICATED_CCLOUD_CONNECTION);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(result.includes(`${connection.spec.name!}`));
    assert.ok(result.includes(`Status: ${ConnectedState.Success}`));
    assert.ok(result.includes("Auth Session Expires At:"));
  });

  it("summarizeConnection() should summarize a `LOCAL` connection", () => {
    const connection: Connection = ConnectionFromJSON({
      ...TEST_LOCAL_CONNECTION,
      spec: {
        ...TEST_LOCAL_CONNECTION.spec,
        local_config: {
          // XXX: required because LocalConfigFromJSON doesn't recognize `schema_registry_uri`
          "schema-registry-uri": TEST_LOCAL_SCHEMA_REGISTRY.uri,
        },
      },
    });
    // simulate local Kafka+SR both running
    getContextValueStub
      .withArgs(contextValues.ContextValues.localKafkaClusterAvailable)
      .returns(true);
    getContextValueStub
      .withArgs(contextValues.ContextValues.localSchemaRegistryAvailable)
      .returns(true);

    const result: string = summarizeConnection(connection);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(result.includes(`"${connection.spec.name!}"`));

    assert.ok(result.includes("Kafka"));
    assert.ok(result.includes(`Status: ${ConnectedState.Success}`));

    assert.ok(result.includes("Schema Registry"));
    assert.ok(result.includes(`Status: ${ConnectedState.Success}`));
    assert.ok(result.includes(`URI: ${TEST_LOCAL_SCHEMA_REGISTRY.uri}`));
  });

  it("summarizeConnection() should summarize a `DIRECT` connection with successfully-connected Kafka and SR", () => {
    const connection: Connection = ConnectionFromJSON({
      ...TEST_DIRECT_CONNECTION,
      spec: {
        ...TEST_DIRECT_CONNECTION.spec,
        kafka_cluster: {
          bootstrap_servers: TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers,
        },
        schema_registry: {
          uri: TEST_DIRECT_SCHEMA_REGISTRY.uri,
        },
      },
      status: {
        ...TEST_DIRECT_CONNECTION.status,
        kafka_cluster: {
          state: ConnectedState.Success,
        },
        schema_registry: {
          state: ConnectedState.Success,
        },
      },
    } satisfies Connection);

    const result: string = summarizeConnection(connection);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(result.includes(`"${connection.spec.name!}"`));

    assert.ok(result.includes("Kafka Cluster"));
    assert.ok(result.includes(`Status: ${ConnectedState.Success}`));
    assert.ok(result.includes(`Bootstrap Servers: ${TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers}`));

    assert.ok(result.includes("Schema Registry"));
    assert.ok(result.includes(`Status: ${ConnectedState.Success}`));
    assert.ok(result.includes(`URI: ${TEST_DIRECT_SCHEMA_REGISTRY.uri}`));
  });

  it("summarizeCCloudConnection() should include authentication expiration details", () => {
    const connection: Connection = TEST_AUTHENTICATED_CCLOUD_CONNECTION;

    const summary: MarkdownString = new MarkdownString().appendMarkdown(
      `### "${connection.spec.name}"`,
    );
    const result: MarkdownString = summarizeCCloudConnection(connection, summary);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(result.value.includes(`Status: ${ConnectedState.Success}`));
    assert.ok(result.value.includes("Auth Session Expires At:"));
    assert.ok(result.value.includes("hour")); // should include "in X hours" text
  });

  it("summarizeCCloudConnection() should include sign-in link if auth expires soon", () => {
    const expiration = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes from now
    const expiringConnection: Connection = ConnectionFromJSON({
      ...TEST_AUTHENTICATED_CCLOUD_CONNECTION,
      status: {
        ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status,
        ccloud: {
          ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud,
          requires_authentication_at: expiration,
          state: ConnectedState.Success,
        },
      },
    } satisfies Connection);

    const summary: MarkdownString = new MarkdownString().appendMarkdown(
      `### "${expiringConnection.spec.name}"`,
    );
    const result: MarkdownString = summarizeCCloudConnection(expiringConnection, summary);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(result.value.includes("Sign-In Link:"));
    assert.ok(result.value.includes(TEST_AUTHENTICATED_CCLOUD_CONNECTION.metadata.sign_in_uri!));
  });

  it("summarizeCCloudConnection() should include errors if present", () => {
    const errorMessage = "Authentication failed";
    const errorConnection: Connection = ConnectionFromJSON({
      ...TEST_AUTHENTICATED_CCLOUD_CONNECTION,
      status: {
        ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status,
        ccloud: {
          ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud,
          errors: {
            auth_status_check: { message: errorMessage },
          },
          state: ConnectedState.Failed,
        },
      },
    } satisfies Connection);

    const summary: MarkdownString = new MarkdownString().appendMarkdown(
      `### "${errorConnection.spec.name}"`,
    );
    const result: MarkdownString = summarizeCCloudConnection(errorConnection, summary);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(result.value.includes("Errors:"));
    assert.ok(result.value.includes(errorMessage));
  });

  it("summarizeLocalConnection() should show Kafka as running when available", () => {
    const connection: Connection = TEST_LOCAL_CONNECTION;
    // simulate local Kafka running
    getContextValueStub
      .withArgs(contextValues.ContextValues.localKafkaClusterAvailable)
      .returns(true);

    const summary: MarkdownString = new MarkdownString().appendMarkdown(
      `### "${connection.spec.name}"`,
    );
    const result: MarkdownString = summarizeLocalConnection(connection, summary);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(result.value.includes("Kafka"));
    assert.ok(result.value.includes(`Status: ${ConnectedState.Success}`));
    // we won't get any bootstrap servers from the connection until we migrate to a DIRECT type;
    // that can only be checked via the Docker engine API currently
  });

  it("summarizeLocalConnection() should show Kafka as not running when unavailable", () => {
    const connection: Connection = TEST_LOCAL_CONNECTION;
    // simulate local Kafka not running
    getContextValueStub
      .withArgs(contextValues.ContextValues.localKafkaClusterAvailable)
      .returns(false);

    const summary: MarkdownString = new MarkdownString().appendMarkdown(
      `### "${connection.spec.name}"`,
    );
    const result: MarkdownString = summarizeLocalConnection(connection, summary);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(result.value.includes("Kafka"));
    assert.ok(result.value.includes(`Status: ${ConnectedState.None}`));
  });

  it("summarizeLocalConnection() should show Schema Registry as running and include the URI when available", () => {
    const connection: Connection = ConnectionFromJSON({
      ...TEST_LOCAL_CONNECTION,
      spec: {
        ...TEST_LOCAL_CONNECTION.spec,
        local_config: {
          // XXX: required because LocalConfigFromJSON doesn't recognize `schema_registry_uri`
          "schema-registry-uri": TEST_LOCAL_SCHEMA_REGISTRY.uri,
        },
      },
    });

    // simulate local Schema Registry running
    getContextValueStub
      .withArgs(contextValues.ContextValues.localSchemaRegistryAvailable)
      .returns(true);

    const summary: MarkdownString = new MarkdownString().appendMarkdown(
      `### "${connection.spec.name}"`,
    );
    const result: MarkdownString = summarizeLocalConnection(connection, summary);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(result.value.includes("Schema Registry"));
    assert.ok(result.value.includes(`Status: ${ConnectedState.Success}`));
    assert.ok(result.value.includes(`URI: ${TEST_LOCAL_SCHEMA_REGISTRY.uri}`));
  });

  it("summarizeLocalConnection() should show Schema Registry as not running when unavailable", () => {
    const connection = TEST_LOCAL_CONNECTION;
    // simulate local Schema Registry not running
    getContextValueStub
      .withArgs(contextValues.ContextValues.localSchemaRegistryAvailable)
      .returns(false);

    const summary: MarkdownString = new MarkdownString().appendMarkdown(
      `### "${connection.spec.name}"`,
    );
    const result: MarkdownString = summarizeLocalConnection(connection, summary);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(result.value.includes("Schema Registry"));
    assert.ok(result.value.includes(`Status: ${ConnectedState.None}`));
    assert.ok(!result.value.includes("URI:"));
  });

  it("summarizeDirectConnection() should include Kafka cluster details when available", () => {
    const connection: Connection = ConnectionFromJSON({
      ...TEST_DIRECT_CONNECTION,
      spec: {
        ...TEST_DIRECT_CONNECTION.spec,
        kafka_cluster: {
          bootstrap_servers: TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers,
        },
      },
      status: {
        ...TEST_DIRECT_CONNECTION.status,
        kafka_cluster: {
          state: ConnectedState.Success,
        },
      },
    } satisfies Connection);

    const summary: MarkdownString = new MarkdownString().appendMarkdown(
      `### "${connection.spec.name}"`,
    );
    const result: MarkdownString = summarizeDirectConnection(connection, summary);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(
      result.value.includes(`Bootstrap Servers: ${TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers}`),
    );
    assert.ok(result.value.includes(`Status: ${ConnectedState.Success}`));
  });

  it("summarizeDirectConnection() should include Kafka cluster errors when present", () => {
    const errorMessage = "Error connecting to Kafka";
    const status: ConnectedState = ConnectedState.Failed;
    const connection: Connection = ConnectionFromJSON({
      ...TEST_DIRECT_CONNECTION,
      spec: {
        ...TEST_DIRECT_CONNECTION.spec,
        kafka_cluster: {
          bootstrap_servers: TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers,
        },
      },
      status: {
        ...TEST_DIRECT_CONNECTION.status,
        kafka_cluster: {
          state: status,
          errors: {
            sign_in: { message: errorMessage },
          },
        },
      },
    } satisfies Connection);

    const summary: MarkdownString = new MarkdownString().appendMarkdown(
      `### "${connection.spec.name}"`,
    );
    const result: MarkdownString = summarizeDirectConnection(connection, summary);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(
      result.value.includes(`Bootstrap Servers: ${TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers}`),
    );
    assert.ok(result.value.includes(`Status: ${status}`));
    assert.ok(result.value.includes("Errors:"));
    assert.ok(result.value.includes(errorMessage));
  });

  it("summarizeDirectConnection() should include Schema Registry details when available", () => {
    const status: ConnectedState = ConnectedState.Attempting;
    const connection: Connection = ConnectionFromJSON({
      ...TEST_DIRECT_CONNECTION,
      spec: {
        ...TEST_DIRECT_CONNECTION.spec,
        schema_registry: {
          uri: TEST_DIRECT_SCHEMA_REGISTRY.uri,
        },
      },
      status: {
        ...TEST_DIRECT_CONNECTION.status,
        schema_registry: {
          state: status,
        },
      },
    } satisfies Connection);

    const summary: MarkdownString = new MarkdownString().appendMarkdown(
      `### "${connection.spec.name}"`,
    );
    const result: MarkdownString = summarizeDirectConnection(connection, summary);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(result.value.includes(`Schema Registry`));
    assert.ok(result.value.includes(`Status: ${status}`));
    assert.ok(result.value.includes(`URI: ${TEST_DIRECT_SCHEMA_REGISTRY.uri}`));
  });

  it("summarizeDirectConnection() should include Schema Registry errors when present", () => {
    const errorMessage = "Error connecting to Schema Registry";
    const status: ConnectedState = ConnectedState.Failed;
    const connection: Connection = ConnectionFromJSON({
      ...TEST_DIRECT_CONNECTION,
      spec: {
        ...TEST_DIRECT_CONNECTION.spec,
        schema_registry: {
          uri: TEST_DIRECT_SCHEMA_REGISTRY.uri,
        },
      },
      status: {
        ...TEST_DIRECT_CONNECTION.status,
        schema_registry: {
          state: status,
          errors: {
            sign_in: { message: errorMessage },
          },
        },
      },
    } satisfies Connection);

    const summary: MarkdownString = new MarkdownString().appendMarkdown(
      `### "${connection.spec.name}"`,
    );
    const result: MarkdownString = summarizeDirectConnection(connection, summary);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(result.value.includes(`Schema Registry`));
    assert.ok(result.value.includes(`Status: ${status}`));
    assert.ok(result.value.includes(`URI: ${TEST_DIRECT_SCHEMA_REGISTRY.uri}`));
    assert.ok(result.value.includes("Errors:"));
    assert.ok(result.value.includes(errorMessage));
  });

  it("summarizeDirectConnection() should handle connections with both Kafka and Schema Registry", () => {
    const connection: Connection = ConnectionFromJSON({
      ...TEST_DIRECT_CONNECTION,
      spec: {
        ...TEST_DIRECT_CONNECTION.spec,
        kafka_cluster: {
          bootstrap_servers: TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers,
        },
        schema_registry: {
          uri: TEST_DIRECT_SCHEMA_REGISTRY.uri,
        },
      },
      status: {
        ...TEST_DIRECT_CONNECTION.status,
        kafka_cluster: {
          state: ConnectedState.Success,
        },
        schema_registry: {
          state: ConnectedState.Success,
        },
      },
    } satisfies Connection);

    const summary: MarkdownString = new MarkdownString().appendMarkdown(
      `### "${connection.spec.name}"`,
    );
    const result: MarkdownString = summarizeDirectConnection(connection, summary);

    // ignore any headers, indentations, spacing, etc.
    assert.ok(
      result.value.includes(`Bootstrap Servers: ${TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers}`),
    );
    assert.ok(result.value.includes(`URI: ${TEST_DIRECT_SCHEMA_REGISTRY.uri}`));
  });
});
