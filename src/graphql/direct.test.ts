import * as assert from "assert";
import * as sinon from "sinon";
import { getSidecarStub } from "../../tests/stubs/sidecar";
import {
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_DIRECT_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import {
  TEST_DIRECT_CONNECTION,
  TEST_DIRECT_CONNECTION_FORM_SPEC,
  TEST_DIRECT_CONNECTION_ID,
} from "../../tests/unit/testResources/connection";
import { ConnectedState, ConnectionType } from "../clients/sidecar";
import * as errorModule from "../errors";
import { DirectEnvironment } from "../models/environment";
import { DirectKafkaCluster } from "../models/kafkaCluster";
import { DirectSchemaRegistry } from "../models/schemaRegistry";
import * as notifications from "../notifications";
import { SidecarHandle } from "../sidecar";
import { ConnectionStateWatcher } from "../sidecar/connections/watcher";
import { CustomConnectionSpec, ResourceManager } from "../storage/resourceManager";
import * as telemetry from "../telemetry/events";
import { ConnectionEventAction, ConnectionEventBody } from "../ws/messageTypes";
import { getDirectResources } from "./direct";

/**
 * GraphQL query result which includes:
 * - {@link TEST_DIRECT_CONNECTION} properties
 * - {@link TEST_DIRECT_KAFKA_CLUSTER} properties
 * - {@link TEST_DIRECT_SCHEMA_REGISTRY} properties
 */
const fakeDirectConnectionByIdResult = {
  directConnectionById: {
    id: TEST_DIRECT_CONNECTION_ID,
    name: TEST_DIRECT_CONNECTION.spec.name,
    type: ConnectionType.Direct,
    kafkaCluster: {
      id: TEST_DIRECT_KAFKA_CLUSTER.id,
      bootstrapServers: TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers,
      uri: TEST_DIRECT_KAFKA_CLUSTER.uri,
    },
    schemaRegistry: {
      id: TEST_DIRECT_SCHEMA_REGISTRY.id,
      uri: TEST_DIRECT_SCHEMA_REGISTRY.uri,
    },
  },
};

/** `CREATED` event body for a Connection with Kafka and Schema Registry statuses of `ATTEMPTING`. */
const fakeAttemptingConnectionEvent: ConnectionEventBody = {
  action: ConnectionEventAction.CREATED,
  connection: {
    ...TEST_DIRECT_CONNECTION,
    status: {
      kafka_cluster: { state: ConnectedState.Attempting },
      schema_registry: { state: ConnectedState.Attempting },
    },
  },
};

/** `CONNECTED` event body for a Connection with Kafka and Schema Registry statuses of `SUCCESS`. */
const fakeStableConnectionEvent: ConnectionEventBody = {
  action: ConnectionEventAction.CONNECTED,
  connection: {
    ...TEST_DIRECT_CONNECTION,
    status: {
      kafka_cluster: { state: ConnectedState.Success },
      schema_registry: { state: ConnectedState.Success },
    },
  },
};

describe("graphql/direct.ts getDirectResources()", () => {
  let sandbox: sinon.SinonSandbox;

  let sidecarStub: sinon.SinonStubbedInstance<SidecarHandle>;
  let logErrorStub: sinon.SinonStub;
  let logUsageStub: sinon.SinonStub;
  let showErrorNotificationStub: sinon.SinonStub;
  let showWarningNotificationStub: sinon.SinonStub;
  let stubbedResourceManager: sinon.SinonStubbedInstance<ResourceManager>;
  let connectionStateWatcherStub: sinon.SinonStubbedInstance<ConnectionStateWatcher>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // create the stub for the sidecar (which will automatically stub the .query method)
    sidecarStub = getSidecarStub(sandbox);

    // stub the ConnectionStateWatcher for Connection-related websocket event handling
    connectionStateWatcherStub = sandbox.createStubInstance(ConnectionStateWatcher);
    connectionStateWatcherStub.getLatestConnectionEvent.returns(fakeAttemptingConnectionEvent);
    // simulate immediately resolving waitForConnectionUpdate and not timing out (returning null)
    connectionStateWatcherStub.waitForConnectionUpdate.resolves(TEST_DIRECT_CONNECTION);
    sandbox.stub(ConnectionStateWatcher, "getInstance").returns(connectionStateWatcherStub);

    // for stubbing the stored (test) direct connection spec
    stubbedResourceManager = sandbox.createStubInstance(ResourceManager);
    stubbedResourceManager.getDirectConnection.resolves({
      ...TEST_DIRECT_CONNECTION_FORM_SPEC,
      // set Kafka/SR configs by default
      kafka_cluster: {
        bootstrap_servers: TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers,
      },
      schema_registry: {
        uri: TEST_DIRECT_SCHEMA_REGISTRY.uri,
      },
    } satisfies CustomConnectionSpec);
    sandbox.stub(ResourceManager, "getInstance").returns(stubbedResourceManager);

    // helper stubs
    logErrorStub = sandbox.stub(errorModule, "logError");
    logUsageStub = sandbox.stub(telemetry, "logUsage");
    showErrorNotificationStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
    showWarningNotificationStub = sandbox
      .stub(notifications, "showWarningNotificationWithButtons")
      .resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return a DirectEnvironment with a Kafka cluster and a Schema Registry when both are returned", async () => {
    sidecarStub.query.resolves(fakeDirectConnectionByIdResult);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    assert.strictEqual(result.name, TEST_DIRECT_CONNECTION.spec.name);
    assert.strictEqual(result.kafkaClusters.length, 1);
    assert.ok(result.schemaRegistry);
    sinon.assert.calledOnce(sidecarStub.query);
    sinon.assert.calledOnceWithExactly(
      stubbedResourceManager.getDirectConnection,
      TEST_DIRECT_CONNECTION_ID,
    );
  });

  it("should properly map GraphQL response values to DirectEnvironment child resources", async () => {
    sidecarStub.query.resolves(fakeDirectConnectionByIdResult);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    // check the DirectKafkaCluster properties
    const kafkaCluster: DirectKafkaCluster = result.kafkaClusters[0];
    assert.ok(kafkaCluster);
    assert.strictEqual(kafkaCluster.id, TEST_DIRECT_KAFKA_CLUSTER.id);
    assert.strictEqual(kafkaCluster.bootstrapServers, TEST_DIRECT_KAFKA_CLUSTER.bootstrapServers);
    assert.strictEqual(kafkaCluster.uri, TEST_DIRECT_KAFKA_CLUSTER.uri);
    assert.strictEqual(kafkaCluster.connectionId, TEST_DIRECT_CONNECTION_ID);
    assert.strictEqual(kafkaCluster.connectionType, ConnectionType.Direct);

    // check the DirectSchemaRegistry properties
    const schemaRegistry: DirectSchemaRegistry | undefined = result.schemaRegistry;
    assert.ok(schemaRegistry);
    assert.strictEqual(schemaRegistry.id, TEST_DIRECT_SCHEMA_REGISTRY.id);
    assert.strictEqual(schemaRegistry.uri, TEST_DIRECT_SCHEMA_REGISTRY.uri);
    assert.strictEqual(schemaRegistry.connectionId, TEST_DIRECT_CONNECTION_ID);
    assert.strictEqual(schemaRegistry.connectionType, ConnectionType.Direct);
  });

  it("should return a DirectEnvironment with only a Kafka cluster when a Schema Registry is not returned", async () => {
    sidecarStub.query.resolves({
      directConnectionById: {
        ...fakeDirectConnectionByIdResult.directConnectionById,
        schemaRegistry: null,
      },
    });

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    assert.strictEqual(result.kafkaClusters.length, 1);
    // even if SR is configured in the connection spec, it may not be returned due to connection issues
    assert.strictEqual(result.schemaRegistry, undefined);
    sinon.assert.calledOnce(sidecarStub.query);
    sinon.assert.calledOnceWithExactly(
      stubbedResourceManager.getDirectConnection,
      TEST_DIRECT_CONNECTION_ID,
    );
  });

  it("should return a DirectEnvironment with only a Schema Registry when a Kafka cluster is not returned", async () => {
    sidecarStub.query.resolves({
      directConnectionById: {
        ...fakeDirectConnectionByIdResult.directConnectionById,
        kafkaCluster: null,
      },
    });

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    // even if Kafka is configured in the connection spec, it may not be returned due to connection issues
    assert.strictEqual(result.kafkaClusters.length, 0);
    assert.ok(result.schemaRegistry);
    sinon.assert.calledOnce(sidecarStub.query);
    sinon.assert.calledOnceWithExactly(
      stubbedResourceManager.getDirectConnection,
      TEST_DIRECT_CONNECTION_ID,
    );
  });

  it("should handle errors when the GraphQL query fails", async () => {
    const error = new Error("Test error");
    sidecarStub.query.rejects(error);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(logErrorStub);
    sinon.assert.calledWith(logErrorStub, error, "direct connection resources", {
      extra: { functionName: "getDirectResources" },
    });
    sinon.assert.calledOnce(showErrorNotificationStub);
    sinon.assert.calledWith(
      showErrorNotificationStub,
      `Failed to fetch resources for direct Kafka / Schema Registry connection(s): ${error}`,
    );
    sinon.assert.notCalled(stubbedResourceManager.getDirectConnection);
  });

  it("should return undefined when graphql query's response's directConnectionById is null", async () => {
    // bogus connection ID? we shouldn't typically see this
    sidecarStub.query.resolves({
      directConnectionById: null,
    });

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(sidecarStub.query);
    sinon.assert.notCalled(stubbedResourceManager.getDirectConnection);
    sinon.assert.notCalled(logErrorStub);
    sinon.assert.notCalled(showErrorNotificationStub);
  });

  it("should pass connection spec and form info to the DirectEnvironment", async () => {
    sidecarStub.query.resolves(fakeDirectConnectionByIdResult);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    assert.strictEqual(result.kafkaConfigured, true);
    assert.strictEqual(result.schemaRegistryConfigured, true);
    assert.strictEqual(
      result.formConnectionType,
      TEST_DIRECT_CONNECTION_FORM_SPEC.formConnectionType,
    );
  });

  it("should call waitForConnectionUpdate when the Kafka cluster is in an ATTEMPTING state", async () => {
    const kafkaAttemptingEvent: ConnectionEventBody = {
      ...fakeAttemptingConnectionEvent,
      connection: {
        ...fakeAttemptingConnectionEvent.connection,
        status: {
          ...fakeAttemptingConnectionEvent.connection.status,
          kafka_cluster: { state: ConnectedState.Attempting }, // not yet connected
          schema_registry: { state: ConnectedState.Success },
        },
      },
    };
    connectionStateWatcherStub.getLatestConnectionEvent.returns(kafkaAttemptingEvent);
    // connectionStateWatcherStub.waitForConnectionUpdate resolves with a Connection by default
    sidecarStub.query.resolves(fakeDirectConnectionByIdResult);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    sinon.assert.calledOnce(connectionStateWatcherStub.getLatestConnectionEvent);
    sinon.assert.calledOnceWithExactly(
      connectionStateWatcherStub.getLatestConnectionEvent,
      TEST_DIRECT_CONNECTION_ID,
    );
    sinon.assert.calledOnce(connectionStateWatcherStub.waitForConnectionUpdate);
    sinon.assert.calledOnce(sidecarStub.query);
  });

  it("should call waitForConnectionUpdate when the Schema Registry is in an ATTEMPTING state", async () => {
    const schemaRegistryAttemptingEvent: ConnectionEventBody = {
      ...fakeAttemptingConnectionEvent,
      connection: {
        ...fakeAttemptingConnectionEvent.connection,
        status: {
          ...fakeAttemptingConnectionEvent.connection.status,
          kafka_cluster: { state: ConnectedState.Success },
          schema_registry: { state: ConnectedState.Attempting }, // not yet connected
        },
      },
    };
    connectionStateWatcherStub.getLatestConnectionEvent.returns(schemaRegistryAttemptingEvent);
    // connectionStateWatcherStub.waitForConnectionUpdate resolves with a Connection by default
    sidecarStub.query.resolves(fakeDirectConnectionByIdResult);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    sinon.assert.calledOnce(connectionStateWatcherStub.getLatestConnectionEvent);
    sinon.assert.calledOnceWithExactly(
      connectionStateWatcherStub.getLatestConnectionEvent,
      TEST_DIRECT_CONNECTION_ID,
    );
    sinon.assert.calledOnce(connectionStateWatcherStub.waitForConnectionUpdate);
    sinon.assert.calledOnce(sidecarStub.query);
  });

  it("should call waitForConnectionUpdate when the Kafka cluster and Schema Registry are in ATTEMPTING states", async () => {
    connectionStateWatcherStub.getLatestConnectionEvent.returns(fakeAttemptingConnectionEvent);
    // connectionStateWatcherStub.waitForConnectionUpdate resolves with a Connection by default
    sidecarStub.query.resolves(fakeDirectConnectionByIdResult);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    sinon.assert.calledOnce(connectionStateWatcherStub.getLatestConnectionEvent);
    sinon.assert.calledOnce(connectionStateWatcherStub.waitForConnectionUpdate);
  });

  it("should skip calling waitForConnectionUpdate when the connection is already in stable state", async () => {
    // reuse the stable event with CONNECTED and SUCCESS states
    connectionStateWatcherStub.getLatestConnectionEvent.returns(fakeStableConnectionEvent);
    sidecarStub.query.resolves(fakeDirectConnectionByIdResult);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    sinon.assert.calledOnce(connectionStateWatcherStub.getLatestConnectionEvent);
    // connection is already stable, no need to call waitForConnectionUpdate
    sinon.assert.notCalled(connectionStateWatcherStub.waitForConnectionUpdate);
    sinon.assert.calledOnce(sidecarStub.query);
  });

  it("should skip calling waitForConnectionUpdate when the connection is in a DISCONNECTED/FAILED state", async () => {
    const failedEvent: ConnectionEventBody = {
      ...fakeStableConnectionEvent,
      action: ConnectionEventAction.DISCONNECTED,
      connection: {
        ...fakeStableConnectionEvent.connection,
        status: {
          kafka_cluster: { state: ConnectedState.Failed },
          schema_registry: { state: ConnectedState.Failed },
        },
      },
    };
    connectionStateWatcherStub.getLatestConnectionEvent.returns(failedEvent);
    sidecarStub.query.resolves({
      directConnectionById: {
        ...fakeDirectConnectionByIdResult.directConnectionById,
        kafkaCluster: null, // no Kafka cluster returned
        schemaRegistry: null, // no Schema Registry returned
      },
    });

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    sinon.assert.calledOnce(connectionStateWatcherStub.getLatestConnectionEvent);
    // connection is already stable, no need to call waitForConnectionUpdate
    sinon.assert.notCalled(connectionStateWatcherStub.waitForConnectionUpdate);
    sinon.assert.calledOnce(sidecarStub.query);
  });

  it("should proceed immediately when no connection status is available", async () => {
    // this shouldn't happen in practice, but we can test it
    connectionStateWatcherStub.getLatestConnectionEvent.returns(null);
    // no idea what the GraphQL query would return in this scenario, but we'll assume the websocket
    // side is the only part that's in a weird state and the GraphQL side is okay
    sidecarStub.query.resolves(fakeDirectConnectionByIdResult);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    sinon.assert.calledOnce(connectionStateWatcherStub.getLatestConnectionEvent);
    // no status to check, so no need to wait for connection update
    sinon.assert.notCalled(connectionStateWatcherStub.waitForConnectionUpdate);
    sinon.assert.calledOnce(sidecarStub.query);
  });

  it("should show a warning notification if the watcher times out waiting for the connection to stabilize", async () => {
    connectionStateWatcherStub.getLatestConnectionEvent.returns(fakeAttemptingConnectionEvent);
    // simulate a timeout by having waitForConnectionUpdate return null
    connectionStateWatcherStub.waitForConnectionUpdate.resolves(null);
    sidecarStub.query.resolves({
      directConnectionById: {
        ...fakeDirectConnectionByIdResult.directConnectionById,
        kafkaCluster: null, // no Kafka cluster returned
        schemaRegistry: null, // no Schema Registry returned
      },
    });

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    sinon.assert.calledOnce(connectionStateWatcherStub.waitForConnectionUpdate);
    sinon.assert.calledOnce(showWarningNotificationStub);
    sinon.assert.calledOnce(logUsageStub);
    sinon.assert.calledOnce(sidecarStub.query);
  });

  it("should not show a warning notification when the watcher returns a Connection", async () => {
    connectionStateWatcherStub.getLatestConnectionEvent.returns(fakeAttemptingConnectionEvent);
    // no timeout, so the watcher returns a Connection
    connectionStateWatcherStub.waitForConnectionUpdate.resolves(TEST_DIRECT_CONNECTION);
    sidecarStub.query.resolves(fakeDirectConnectionByIdResult);

    const result: DirectEnvironment | undefined =
      await getDirectResources(TEST_DIRECT_CONNECTION_ID);

    assert.ok(result);
    sinon.assert.calledOnce(connectionStateWatcherStub.waitForConnectionUpdate);
    sinon.assert.notCalled(showWarningNotificationStub);
    sinon.assert.notCalled(logUsageStub);
    sinon.assert.calledOnce(sidecarStub.query);
  });
});
