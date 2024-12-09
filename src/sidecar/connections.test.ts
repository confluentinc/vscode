import * as assert from "assert";
import * as sinon from "sinon";
import * as sidecar from ".";
import {
  TEST_CCLOUD_CONNECTION,
  TEST_DIRECT_CONNECTION,
  TEST_LOCAL_CONNECTION,
} from "../../tests/unit/testResources/connection";
import { getExtensionContext } from "../../tests/unit/testUtils";
import {
  ConnectedState,
  Connection,
  ConnectionsResourceApi,
  ResponseError,
  Status,
} from "../clients/sidecar";
import { ContextValues, setContextValue } from "../context/values";
import { currentKafkaClusterChanged, currentSchemaRegistryChanged } from "../emitters";
import { ConnectionId } from "../models/resource";
import { getResourceManager } from "../storage/resourceManager";
import {
  clearCurrentCCloudResources,
  getLocalConnection,
  hasCCloudAuthSession,
  tryToCreateConnection,
  tryToDeleteConnection,
  tryToUpdateConnection,
  waitForConnectionToBeUsable,
} from "./connections";

describe("sidecar/connections.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let stubConnectionsResourceApi: sinon.SinonStubbedInstance<ConnectionsResourceApi>;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // create the stubs for the sidecar + service client
    const stubSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
      sandbox.createStubInstance(sidecar.SidecarHandle);
    stubConnectionsResourceApi = sandbox.createStubInstance(ConnectionsResourceApi);
    stubSidecarHandle.getConnectionsResourceApi.returns(stubConnectionsResourceApi);
    // stub the getSidecar function to return the stub sidecar handle
    sandbox.stub(sidecar, "getSidecar").resolves(stubSidecarHandle);
  });

  afterEach(() => {
    sandbox.restore();
  });

  for (const testConnection of [
    TEST_LOCAL_CONNECTION,
    TEST_CCLOUD_CONNECTION,
    TEST_DIRECT_CONNECTION,
  ]) {
    it(`${testConnection.spec.type}: tryToGetConnection() should return null if no connection exists / we get a 404 response`, async () => {
      stubConnectionsResourceApi.gatewayV1ConnectionsIdGet.rejects({ response: { status: 404 } });

      const connection = await getLocalConnection();

      assert.strictEqual(connection, null);
    });

    it(`${testConnection.spec.type}: tryToGetConnection() should return a connection if it exists`, async () => {
      stubConnectionsResourceApi.gatewayV1ConnectionsIdGet.resolves(testConnection);

      const connection = await getLocalConnection();

      assert.strictEqual(connection, testConnection);
    });

    it(`${testConnection.spec.type}: tryToCreateConnection() should create and return a new connection`, async () => {
      stubConnectionsResourceApi.gatewayV1ConnectionsPost.resolves(testConnection);

      const connection = await tryToCreateConnection(testConnection.spec);

      assert.strictEqual(connection, testConnection);
    });

    it(`${testConnection.spec.type}: tryToUpdateConnection() should update and return a connection`, async () => {
      const updatedConnection: Connection = {
        ...testConnection,
        spec: { ...testConnection.spec, name: "updated-name" },
      };
      stubConnectionsResourceApi.gatewayV1ConnectionsIdPut.resolves(updatedConnection);

      const connection = await tryToUpdateConnection(updatedConnection);

      assert.strictEqual(connection, updatedConnection);
    });

    it(`${testConnection.spec.type}: tryToDeleteConnection() should not re-throw 404 response errors`, async () => {
      const error = new ResponseError(new Response(null, { status: 404 }));
      stubConnectionsResourceApi.gatewayV1ConnectionsIdDeleteRaw.rejects(error);

      const promise = tryToDeleteConnection(testConnection.id);

      await assert.doesNotReject(promise);
    });
  }

  it("clearCurrentCCloudResources() should clear resources and fire events", async () => {
    // just needed for this test, otherwise we'd put this in the before() block
    await getExtensionContext();

    const resourceManager = getResourceManager();
    const deleteCCloudResourcesStub = sandbox.stub(resourceManager, "deleteCCloudResources");
    const currentKafkaClusterChangedFireStub = sandbox.stub(currentKafkaClusterChanged, "fire");
    const currentSchemaRegistryChangedFireStub = sandbox.stub(currentSchemaRegistryChanged, "fire");

    await clearCurrentCCloudResources();

    assert.ok(deleteCCloudResourcesStub.calledOnce);
    assert.ok(currentKafkaClusterChangedFireStub.calledOnceWith(null));
    assert.ok(currentSchemaRegistryChangedFireStub.calledOnceWith(null));
  });

  it("hasCCloudAuthSession() should return false when the context value is false or undefined", () => {
    for (const value of [false, undefined]) {
      setContextValue(ContextValues.ccloudConnectionAvailable, value);
      assert.strictEqual(hasCCloudAuthSession(), false, `Expected ${value} to return false`);
    }
  });

  it("hasCCloudAuthSession() should return true when the context value is true", () => {
    setContextValue(ContextValues.ccloudConnectionAvailable, true);
    assert.strictEqual(hasCCloudAuthSession(), true);
  });

  // dynamically set up tests for `waitForConnectionToBeUsable()` using different connections and states
  type ConnectionStateMatches = [
    Connection,
    ConnectedState,
    ConnectedState,
    ConnectedState,
    ConnectedState,
  ];
  const connectionStateMatches: ConnectionStateMatches[] = [
    [
      TEST_CCLOUD_CONNECTION,
      ConnectedState.None,
      ConnectedState.None,
      ConnectedState.None,
      ConnectedState.Success,
    ],
    [
      TEST_DIRECT_CONNECTION,
      ConnectedState.Attempting,
      ConnectedState.Success,
      ConnectedState.Success,
      ConnectedState.None,
    ],
  ];

  for (const [
    baseConnection,
    pendingState,
    usableKafkaClusterState,
    usableSchemaRegistryState,
    usableCcloudState,
  ] of connectionStateMatches) {
    const testConnectionId = baseConnection.id as ConnectionId;
    // we aren't worried about `status.authentication` for this function, but it's required for the
    // ConnectionStatus interface, e.g.:
    // "Property 'authentication' is missing in type ... but required in type 'ConnectionStatus'."
    const testAuthStatus = { authentication: { status: Status.NoToken } };

    it(`${baseConnection.spec.type}: waitForConnectionToBeUsable() should return the connection when it becomes usable`, async () => {
      const testConnection: Connection = {
        ...baseConnection,
        status: {
          kafka_cluster: { state: usableKafkaClusterState },
          schema_registry: { state: usableSchemaRegistryState },
          ccloud: { state: usableCcloudState },
          ...testAuthStatus,
        },
      };
      stubConnectionsResourceApi.gatewayV1ConnectionsIdGet.resolves(testConnection);

      const connection = await waitForConnectionToBeUsable(testConnectionId);

      assert.deepStrictEqual(connection, testConnection);
    });

    it(`${baseConnection.spec.type}: waitForConnectionToBeUsable() should throw an error if the connection does not become usable within the timeout`, async () => {
      // use fake timers so we can control the time and "time out" quickly
      clock = sandbox.useFakeTimers(Date.now());

      const testConnection: Connection = {
        ...baseConnection,
        status: {
          kafka_cluster: { state: pendingState },
          schema_registry: { state: pendingState },
          ccloud: { state: pendingState },
          ...testAuthStatus,
        },
      };
      stubConnectionsResourceApi.gatewayV1ConnectionsIdGet.resolves(testConnection);

      // set a short timeout, even though we're using fake timers
      const shortTimeoutMs = 10;
      const connectionPromise: Promise<Connection | null> = waitForConnectionToBeUsable(
        testConnectionId,
        shortTimeoutMs,
        shortTimeoutMs / 2,
      );
      // "wait" for the timeout to occur
      await clock.tickAsync(100);

      await assert.rejects(
        connectionPromise,
        new Error(
          `Connection ${testConnection.id} did not become usable within ${shortTimeoutMs}ms`,
        ),
      );
    });

    it(`${baseConnection.spec.type}: waitForConnectionToBeUsable() should continue polling if the connection is not found initially`, async () => {
      const testConnection = {
        ...baseConnection,
        status: {
          kafka_cluster: { state: usableKafkaClusterState },
          schema_registry: { state: usableSchemaRegistryState },
          ccloud: { state: usableCcloudState },
          ...testAuthStatus,
        },
      };
      stubConnectionsResourceApi.gatewayV1ConnectionsIdGet
        .onFirstCall()
        .rejects(new ResponseError(new Response(null, { status: 404 })));
      stubConnectionsResourceApi.gatewayV1ConnectionsIdGet.onSecondCall().resolves(testConnection);

      const connection = await waitForConnectionToBeUsable(testConnectionId);

      assert.deepStrictEqual(connection, testConnection);
    });

    it(`${baseConnection.spec.type}: waitForConnectionToBeUsable() should wait for a connection to be usable`, async () => {
      const pendingConnection = {
        ...baseConnection,
        status: {
          kafka_cluster: { state: pendingState },
          schema_registry: { state: pendingState },
          ccloud: { state: pendingState },
          ...testAuthStatus,
        },
      };
      stubConnectionsResourceApi.gatewayV1ConnectionsIdGet
        .onFirstCall()
        .resolves(pendingConnection);

      const usableConnection = {
        ...pendingConnection,
        status: {
          kafka_cluster: { state: usableKafkaClusterState },
          schema_registry: { state: usableSchemaRegistryState },
          ccloud: { state: usableCcloudState },
          ...testAuthStatus,
        },
      };
      stubConnectionsResourceApi.gatewayV1ConnectionsIdGet
        .onSecondCall()
        .resolves(usableConnection);

      const connection = await waitForConnectionToBeUsable(testConnectionId, 10, 5);

      assert.deepStrictEqual(connection, usableConnection);
    });
  }
});
