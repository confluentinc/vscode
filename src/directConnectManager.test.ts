import * as assert from "assert";
import sinon from "sinon";
import { TEST_LOCAL_KAFKA_CLUSTER, TEST_LOCAL_SCHEMA_REGISTRY } from "../tests/unit/testResources";
import {
  TEST_DIRECT_CONNECTION,
  TEST_DIRECT_CONNECTION_FORM_SPEC,
} from "../tests/unit/testResources/connection";
import { getTestExtensionContext } from "../tests/unit/testUtils";
import {
  ConnectionSpec,
  ConnectionSpecFromJSON,
  ConnectionsList,
  ConnectionsResourceApi,
  ResponseError,
} from "./clients/sidecar";
import { DirectConnectionManager } from "./directConnectManager";
import { ResourceLoader } from "./loaders";
import { ConnectionId } from "./models/resource";
import * as sidecar from "./sidecar";
import * as connections from "./sidecar/connections";
import * as watcher from "./sidecar/connections/watcher";
import {
  CustomConnectionSpec,
  DirectConnectionsById,
  getResourceManager,
} from "./storage/resourceManager";

const fakeConnectionsList: ConnectionsList = {
  api_version: "v1",
  kind: "ConnectionsList",
  metadata: {},
  data: [],
};

/** Plain {@link ConnectionSpec} for a no-auth local Kafka+SR connection */
const PLAIN_LOCAL_KAFKA_SR_SPEC: ConnectionSpec = {
  ...TEST_DIRECT_CONNECTION.spec,
  kafka_cluster: {
    bootstrap_servers: TEST_LOCAL_KAFKA_CLUSTER.bootstrapServers,
  },
  schema_registry: {
    uri: TEST_LOCAL_SCHEMA_REGISTRY.uri,
  },
};

describe("DirectConnectionManager behavior", () => {
  let sandbox: sinon.SinonSandbox;

  let tryToCreateConnectionStub: sinon.SinonStub;
  let tryToUpdateConnectionStub: sinon.SinonStub;

  let stubbedConnectionsResourceApi: sinon.SinonStubbedInstance<ConnectionsResourceApi>;
  let waitForConnectionToBeStableStub: sinon.SinonStub;

  let manager: DirectConnectionManager;

  before(async () => {
    // DirectConnectionManager requires the extension context to be set
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // stub the sidecar Connections API
    const mockSidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle> =
      sandbox.createStubInstance(sidecar.SidecarHandle);
    stubbedConnectionsResourceApi = sandbox.createStubInstance(ConnectionsResourceApi);
    mockSidecarHandle.getConnectionsResourceApi.returns(stubbedConnectionsResourceApi);
    sandbox.stub(sidecar, "getSidecar").resolves(mockSidecarHandle);

    // don't return a Connection type since the IDs are randomly generated - handle in specific tests
    tryToCreateConnectionStub = sandbox
      .stub(connections, "tryToCreateConnection")
      .resolves({} as any);
    tryToUpdateConnectionStub = sandbox
      .stub(connections, "tryToUpdateConnection")
      .resolves({} as any);

    // assume the connection is immediately usable for most tests
    waitForConnectionToBeStableStub = sandbox
      .stub(watcher, "waitForConnectionToBeStable")
      .resolves(TEST_DIRECT_CONNECTION);

    manager = DirectConnectionManager.getInstance();
  });

  afterEach(async () => {
    manager.dispose();
    // reset the singleton instance
    DirectConnectionManager["instance"] = null;
    // wipe out any stored connections
    await getResourceManager().deleteDirectConnections();

    sandbox.restore();
  });

  it("createConnection() should not include `kafkaClusterConfig` in the ConnectionSpec if not provided", async () => {
    const testSpec: ConnectionSpec = PLAIN_LOCAL_KAFKA_SR_SPEC;
    testSpec.kafka_cluster = undefined;
    const createdConnection = { ...TEST_DIRECT_CONNECTION, spec: testSpec };
    tryToCreateConnectionStub.resolves(createdConnection);

    const result = await manager.createConnection({
      kafka_cluster: testSpec.kafka_cluster,
      schema_registry: testSpec.schema_registry,
      formConnectionType: TEST_DIRECT_CONNECTION_FORM_SPEC.formConnectionType,
      name: testSpec.name,
      id: TEST_DIRECT_CONNECTION.spec.id as ConnectionId,
    });

    assert.ok(result.connection, JSON.stringify(result));
    assert.ok(tryToCreateConnectionStub.calledOnce);
    const specArg: ConnectionSpec = tryToCreateConnectionStub.firstCall.args[0];
    assert.strictEqual(specArg.kafka_cluster, undefined);
    assert.deepStrictEqual(specArg.schema_registry, testSpec.schema_registry);
    assert.strictEqual(specArg.name, testSpec.name);
  });

  it("createConnection() should not include `schemaRegistryConfig` in the ConnectionSpec if not provided", async () => {
    const testSpec: ConnectionSpec = PLAIN_LOCAL_KAFKA_SR_SPEC;
    testSpec.schema_registry = undefined;
    const createdConnection = { ...TEST_DIRECT_CONNECTION, spec: testSpec };
    tryToCreateConnectionStub.resolves(createdConnection);
    const result = await manager.createConnection({
      kafka_cluster: testSpec.kafka_cluster,
      schema_registry: testSpec.schema_registry,
      formConnectionType: TEST_DIRECT_CONNECTION_FORM_SPEC.formConnectionType,
      name: testSpec.name,
      id: TEST_DIRECT_CONNECTION.spec.id as ConnectionId,
    });
    assert.ok(result.connection);
    // don't use .calledOnceWith(testSpec) because the `id` will change
    assert.ok(tryToCreateConnectionStub.calledOnce);
    const specArg: ConnectionSpec = tryToCreateConnectionStub.firstCall.args[0];
    assert.strictEqual(specArg.schema_registry, undefined);
    assert.deepStrictEqual(specArg.kafka_cluster, testSpec.kafka_cluster);
    assert.strictEqual(specArg.name, testSpec.name);
  });

  it("createConnection() should store the new connection spec after successful response from the sidecar", async () => {
    // no preloading
    tryToCreateConnectionStub.resolves({
      ...TEST_DIRECT_CONNECTION,
      spec: PLAIN_LOCAL_KAFKA_SR_SPEC,
    });

    const result = await manager.createConnection({
      id: TEST_DIRECT_CONNECTION.spec.id as ConnectionId,
      kafka_cluster: PLAIN_LOCAL_KAFKA_SR_SPEC.kafka_cluster,
      schema_registry: PLAIN_LOCAL_KAFKA_SR_SPEC.schema_registry,
      formConnectionType: TEST_DIRECT_CONNECTION_FORM_SPEC.formConnectionType,
      name: PLAIN_LOCAL_KAFKA_SR_SPEC.name,
    });

    assert.ok(result.connection);
    // don't use .calledOnceWith(testSpec) because the `id` will change
    assert.ok(tryToCreateConnectionStub.calledOnce);
    const storedConnections: DirectConnectionsById =
      await getResourceManager().getDirectConnections();
    assert.equal(storedConnections.size, 1);
  });

  it("createConnection() should not store the new connection spec if the sidecar response is unsuccessful", async () => {
    tryToCreateConnectionStub.rejects(new ResponseError(new Response("oh no", { status: 500 })));

    const result = await manager.createConnection({
      kafka_cluster: PLAIN_LOCAL_KAFKA_SR_SPEC.kafka_cluster,
      schema_registry: PLAIN_LOCAL_KAFKA_SR_SPEC.schema_registry,
      formConnectionType: TEST_DIRECT_CONNECTION_FORM_SPEC.formConnectionType,
      name: PLAIN_LOCAL_KAFKA_SR_SPEC.name,
      id: TEST_DIRECT_CONNECTION.spec.id as ConnectionId,
    });

    assert.ok(!result.connection);
    assert.ok(result.errorMessage);
    const storedConnections: DirectConnectionsById =
      await getResourceManager().getDirectConnections();
    assert.equal(storedConnections.size, 0);
  });

  it("createConnection() should not store the new connection spec if dryRun is `true`", async () => {
    // succesful test run returns the connection
    tryToCreateConnectionStub.resolves({
      ...TEST_DIRECT_CONNECTION,
      spec: PLAIN_LOCAL_KAFKA_SR_SPEC,
    });
    const result = await manager.createConnection(
      {
        kafka_cluster: PLAIN_LOCAL_KAFKA_SR_SPEC.kafka_cluster,
        schema_registry: PLAIN_LOCAL_KAFKA_SR_SPEC.schema_registry,
        formConnectionType: TEST_DIRECT_CONNECTION_FORM_SPEC.formConnectionType,
        name: PLAIN_LOCAL_KAFKA_SR_SPEC.name,
        id: TEST_DIRECT_CONNECTION.id as ConnectionId,
      },
      true, // dryRun
    );

    assert.ok(result.connection);
    assert.ok(!result.errorMessage);
    const storedConnections: DirectConnectionsById =
      await getResourceManager().getDirectConnections();
    assert.equal(storedConnections.size, 0);
  });

  it("updateConnection() should store the updated connection spec after successful response from the sidecar", async () => {
    // preload a direct connection
    await getResourceManager().addDirectConnection(TEST_DIRECT_CONNECTION_FORM_SPEC);

    const newName = "Updated Connection";
    const updatedSpec: CustomConnectionSpec = {
      ...TEST_DIRECT_CONNECTION_FORM_SPEC,
      name: newName,
    };
    tryToUpdateConnectionStub.resolves({ ...TEST_DIRECT_CONNECTION, spec: updatedSpec });

    await manager.updateConnection(updatedSpec);

    assert.ok(tryToUpdateConnectionStub.calledOnce);
    const storedConnections: DirectConnectionsById =
      await getResourceManager().getDirectConnections();
    assert.equal(storedConnections.size, 1);
    const storedConnection: ConnectionSpec | undefined = storedConnections.get(
      TEST_DIRECT_CONNECTION.spec.id as ConnectionId,
    );
    assert.ok(storedConnection);
    assert.equal(storedConnection.name, newName);
  });

  it("updateConnection() should not store the updated connection spec if the sidecar response is unsuccessful", async () => {
    // preload a direct connection
    await getResourceManager().addDirectConnection(TEST_DIRECT_CONNECTION_FORM_SPEC);

    const newName = "Updated Connection";
    const updatedSpec: CustomConnectionSpec = {
      ...TEST_DIRECT_CONNECTION_FORM_SPEC,
      name: newName,
    };
    tryToUpdateConnectionStub.rejects(new ResponseError(new Response("oh no", { status: 500 })));

    await manager.updateConnection(updatedSpec);

    const storedConnections: DirectConnectionsById =
      await getResourceManager().getDirectConnections();
    assert.equal(storedConnections.size, 1);
    const storedConnection: ConnectionSpec | undefined = storedConnections.get(
      TEST_DIRECT_CONNECTION_FORM_SPEC.id,
    );
    assert.ok(storedConnection);
    assert.equal(storedConnection.name, TEST_DIRECT_CONNECTION.spec.name);
  });

  it("rehydrateConnections() should inform the sidecar of new/untracked connections", async () => {
    // preload a direct connection
    await getResourceManager().addDirectConnection(TEST_DIRECT_CONNECTION_FORM_SPEC);
    // stub the sidecar not knowing about it
    stubbedConnectionsResourceApi.gatewayV1ConnectionsGet.resolves(fakeConnectionsList);

    await manager.rehydrateConnections();

    assert.ok(tryToCreateConnectionStub.calledOnce);
    const args = tryToCreateConnectionStub.getCall(0).args;
    assert.deepStrictEqual(
      ConnectionSpecFromJSON(args[0]),
      ConnectionSpecFromJSON(TEST_DIRECT_CONNECTION_FORM_SPEC),
    );

    sinon.assert.calledOnce(waitForConnectionToBeStableStub);
    sinon.assert.calledWith(
      waitForConnectionToBeStableStub,
      TEST_DIRECT_CONNECTION.spec.id as ConnectionId,
    );
  });

  it("rehydrateConnections() should not inform the sidecar of existing/tracked connections", async () => {
    // preload a direct connection
    await getResourceManager().addDirectConnection(TEST_DIRECT_CONNECTION_FORM_SPEC);
    // stub the sidecar already tracking it
    const connectionsList: ConnectionsList = {
      ...fakeConnectionsList,
      data: [TEST_DIRECT_CONNECTION],
    };
    stubbedConnectionsResourceApi.gatewayV1ConnectionsGet.resolves(connectionsList);

    await manager.rehydrateConnections();

    assert.ok(tryToCreateConnectionStub.notCalled);
  });

  describe("deleteConnection()", () => {
    const TEST_DIRECT_CONNECTION_ID = TEST_DIRECT_CONNECTION.spec.id as ConnectionId;

    let directConnectionManager: DirectConnectionManager;

    beforeEach(() => {
      // Can only be done after the extension context is set.
      directConnectionManager = manager;
    });

    it("should handle if getDirectConnection(id) returned null", async () => {
      const rm = getResourceManager();
      sandbox.stub(rm, "getDirectConnection").resolves(null);

      await directConnectionManager.deleteConnection(TEST_DIRECT_CONNECTION_ID);
    });

    it("should work if getDirectConnection(id) returned a connection", async () => {
      const rm = getResourceManager();
      sandbox.stub(rm, "getDirectConnection").resolves(TEST_DIRECT_CONNECTION_FORM_SPEC);
      const deleteStub = sandbox.stub(rm, "deleteDirectConnection").resolves();
      const tryToDeleteConnectionStub = sandbox
        .stub(connections, "tryToDeleteConnection")
        .resolves({} as any);

      const deregisterInstanceStub = sandbox.stub(ResourceLoader, "deregisterInstance");

      await directConnectionManager.deleteConnection(TEST_DIRECT_CONNECTION_ID);
      sinon.assert.calledOnce(deleteStub);
      sinon.assert.calledWith(deleteStub, TEST_DIRECT_CONNECTION_ID);

      sinon.assert.calledOnce(tryToDeleteConnectionStub);
      sinon.assert.calledWith(tryToDeleteConnectionStub, TEST_DIRECT_CONNECTION_ID);

      sinon.assert.calledOnce(deregisterInstanceStub);
      sinon.assert.calledWith(deregisterInstanceStub, TEST_DIRECT_CONNECTION_ID);
    });
  });
});
