import * as assert from "assert";
import sinon from "sinon";
import { ConfigurationChangeEvent, workspace } from "vscode";
import { TEST_LOCAL_KAFKA_CLUSTER, TEST_LOCAL_SCHEMA_REGISTRY } from "../tests/unit/testResources";
import { TEST_DIRECT_CONNECTION } from "../tests/unit/testResources/connection";
import { getExtensionContext } from "../tests/unit/testUtils";
import {
  ConnectionsList,
  ConnectionSpec,
  ConnectionsResourceApi,
  ResponseError,
} from "./clients/sidecar";
import * as contextValues from "./context/values";
import { DirectConnectionManager } from "./directConnectManager";
import { ConnectionId } from "./models/resource";
import { ENABLE_DIRECT_CONNECTIONS } from "./preferences/constants";
import * as sidecar from "./sidecar";
import * as connections from "./sidecar/connections";
import { DirectConnectionsById, getResourceManager } from "./storage/resourceManager";

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

  let onDidChangeConfigurationStub: sinon.SinonStub;
  let getConfigurationStub: sinon.SinonStub;
  let setContextValueStub: sinon.SinonStub;

  let tryToCreateConnectionStub: sinon.SinonStub;
  let tryToUpdateConnectionStub: sinon.SinonStub;

  let stubbedConnectionsResourceApi: sinon.SinonStubbedInstance<ConnectionsResourceApi>;

  before(async () => {
    // DirectConnectionManager requires the extension context to be set
    await getExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // stub VS Code APIs
    onDidChangeConfigurationStub = sandbox.stub(workspace, "onDidChangeConfiguration");
    getConfigurationStub = sandbox.stub(workspace, "getConfiguration");
    setContextValueStub = sandbox.stub(contextValues, "setContextValue");

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
  });

  afterEach(() => {
    // reset the singleton instance
    DirectConnectionManager["instance"] = null;
    // wipe out any stored connections
    getResourceManager().deleteDirectConnections();

    sandbox.restore();
  });

  for (const enabled of [true, false]) {
    it(`should update the "${contextValues.ContextValues.directConnectionsEnabled}" context value when the "${ENABLE_DIRECT_CONNECTIONS}" setting is changed to ${enabled} (REMOVE ONCE EXPERIMENTAL SETTING IS NO LONGER USED)`, async () => {
      getConfigurationStub.returns({
        get: sandbox.stub().withArgs(ENABLE_DIRECT_CONNECTIONS).returns(enabled),
      });
      const mockEvent = {
        affectsConfiguration: (config: string) => config === ENABLE_DIRECT_CONNECTIONS,
      } as ConfigurationChangeEvent;
      onDidChangeConfigurationStub.yields(mockEvent);

      DirectConnectionManager.getInstance();
      // simulate the setting being changed by the user
      await onDidChangeConfigurationStub.firstCall.args[0](mockEvent);

      assert.ok(
        setContextValueStub.calledWith(
          contextValues.ContextValues.directConnectionsEnabled,
          enabled,
        ),
      );
    });
  }

  it("createConnection() should not include `kafkaClusterConfig` in the ConnectionSpec if not provided", async () => {
    const testSpec: ConnectionSpec = PLAIN_LOCAL_KAFKA_SR_SPEC;
    testSpec.kafka_cluster = undefined;

    const result = await DirectConnectionManager.getInstance().createConnection(
      testSpec.kafka_cluster,
      testSpec.schema_registry,
      testSpec.name,
    );

    assert.ok(result.success);
    assert.ok(tryToCreateConnectionStub.calledOnce);
    const specArg: ConnectionSpec = tryToCreateConnectionStub.firstCall.args[0];
    assert.strictEqual(specArg.kafka_cluster, undefined);
    assert.deepStrictEqual(specArg.schema_registry, testSpec.schema_registry);
    assert.strictEqual(specArg.name, testSpec.name);
  });

  it("createConnection() should not include `schemaRegistryConfig` in the ConnectionSpec if not provided", async () => {
    const testSpec: ConnectionSpec = PLAIN_LOCAL_KAFKA_SR_SPEC;
    testSpec.schema_registry = undefined;

    const result = await DirectConnectionManager.getInstance().createConnection(
      testSpec.kafka_cluster,
      testSpec.schema_registry,
      testSpec.name,
    );

    assert.ok(result.success);
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

    const result = await DirectConnectionManager.getInstance().createConnection(
      PLAIN_LOCAL_KAFKA_SR_SPEC.kafka_cluster,
      PLAIN_LOCAL_KAFKA_SR_SPEC.schema_registry,
      PLAIN_LOCAL_KAFKA_SR_SPEC.name,
    );

    assert.ok(result.success);
    // don't use .calledOnceWith(testSpec) because the `id` will change
    assert.ok(tryToCreateConnectionStub.calledOnce);
    const storedConnections: DirectConnectionsById =
      await getResourceManager().getDirectConnections();
    assert.equal(storedConnections.size, 1);
  });

  it("createConnection() should not store the new connection spec if the sidecar response is unsuccessful", async () => {
    tryToCreateConnectionStub.rejects(new ResponseError(new Response("oh no", { status: 500 })));

    const result = await DirectConnectionManager.getInstance().createConnection(
      PLAIN_LOCAL_KAFKA_SR_SPEC.kafka_cluster,
      PLAIN_LOCAL_KAFKA_SR_SPEC.schema_registry,
      PLAIN_LOCAL_KAFKA_SR_SPEC.name,
    );

    assert.ok(!result.success);
    const storedConnections: DirectConnectionsById =
      await getResourceManager().getDirectConnections();
    assert.equal(storedConnections.size, 0);
  });

  it("updateConnection() should store the updated connection spec after successful response from the sidecar", async () => {
    // preload a direct connection
    await getResourceManager().addDirectConnection(TEST_DIRECT_CONNECTION.spec);

    const newName = "Updated Connection";
    const updatedSpec = { ...TEST_DIRECT_CONNECTION.spec, name: newName };
    tryToUpdateConnectionStub.resolves({ ...TEST_DIRECT_CONNECTION, spec: updatedSpec });

    const result = await DirectConnectionManager.getInstance().updateConnection(updatedSpec);

    assert.ok(result.success);
    assert.ok(tryToUpdateConnectionStub.calledOnceWith(updatedSpec));
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
    await getResourceManager().addDirectConnection(TEST_DIRECT_CONNECTION.spec);

    const newName = "Updated Connection";
    const updatedSpec = { ...TEST_DIRECT_CONNECTION.spec, name: newName };
    tryToUpdateConnectionStub.rejects(new ResponseError(new Response("oh no", { status: 500 })));

    const result = await DirectConnectionManager.getInstance().updateConnection(updatedSpec);

    assert.ok(!result.success);
    const storedConnections: DirectConnectionsById =
      await getResourceManager().getDirectConnections();
    assert.equal(storedConnections.size, 1);
    const storedConnection: ConnectionSpec | undefined = storedConnections.get(
      TEST_DIRECT_CONNECTION.spec.id as ConnectionId,
    );
    assert.ok(storedConnection);
    assert.equal(storedConnection.name, TEST_DIRECT_CONNECTION.spec.name);
  });

  it("rehydrateConnections() should inform the sidecar of new/untracked connections", async () => {
    // preload a direct connection
    await getResourceManager().addDirectConnection(TEST_DIRECT_CONNECTION.spec);
    // stub the sidecar not knowing about it
    stubbedConnectionsResourceApi.gatewayV1ConnectionsGet.resolves(fakeConnectionsList);

    await DirectConnectionManager.getInstance().rehydrateConnections();

    assert.ok(tryToCreateConnectionStub.calledOnceWith(TEST_DIRECT_CONNECTION.spec));
  });

  it("rehydrateConnections() should not inform the sidecar of existing/tracked connections", async () => {
    // preload a direct connection
    await getResourceManager().addDirectConnection(TEST_DIRECT_CONNECTION.spec);
    // stub the sidecar already tracking it
    const connectionsList: ConnectionsList = {
      ...fakeConnectionsList,
      data: [TEST_DIRECT_CONNECTION],
    };
    stubbedConnectionsResourceApi.gatewayV1ConnectionsGet.resolves(connectionsList);

    await DirectConnectionManager.getInstance().rehydrateConnections();

    assert.ok(tryToCreateConnectionStub.notCalled);
  });
});
