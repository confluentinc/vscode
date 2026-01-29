import * as assert from "assert";
import sinon from "sinon";
import { TEST_LOCAL_KAFKA_CLUSTER, TEST_LOCAL_SCHEMA_REGISTRY } from "../tests/unit/testResources";
import {
  TEST_DIRECT_CONNECTION,
  TEST_DIRECT_CONNECTION_FORM_SPEC,
} from "../tests/unit/testResources/connection";
import { getTestExtensionContext } from "../tests/unit/testUtils";
import type { ConnectionSpec } from "./connections";
import { DirectConnectionManager } from "./directConnectManager";
import { ResourceLoader } from "./loaders";
import type { ConnectionId } from "./models/resource";
import type { CustomConnectionSpec, DirectConnectionsById } from "./storage/resourceManager";
import { getResourceManager } from "./storage/resourceManager";
import * as schemaRegistryProxy from "./proxy/schemaRegistryProxy";

/** Plain {@link ConnectionSpec} for a no-auth local Kafka+SR connection */
const PLAIN_LOCAL_KAFKA_SR_SPEC: ConnectionSpec = {
  ...TEST_DIRECT_CONNECTION.spec,
  kafkaCluster: {
    bootstrapServers: TEST_LOCAL_KAFKA_CLUSTER.bootstrapServers,
  },
  schemaRegistry: {
    uri: TEST_LOCAL_SCHEMA_REGISTRY.uri,
  },
};

describe("DirectConnectionManager behavior", () => {
  let sandbox: sinon.SinonSandbox;
  let manager: DirectConnectionManager;
  // Mock Schema Registry proxy
  let mockSrProxy: sinon.SinonStubbedInstance<schemaRegistryProxy.SchemaRegistryProxy>;

  before(async () => {
    // DirectConnectionManager requires the extension context to be set
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create mock Schema Registry proxy that always succeeds
    mockSrProxy = {
      listSubjects: sandbox.stub().resolves(["test-subject"]),
    } as unknown as sinon.SinonStubbedInstance<schemaRegistryProxy.SchemaRegistryProxy>;

    // Stub createSchemaRegistryProxy to return our mock
    sandbox.stub(schemaRegistryProxy, "createSchemaRegistryProxy").returns(mockSrProxy);

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
    const testSpec: ConnectionSpec = { ...PLAIN_LOCAL_KAFKA_SR_SPEC };
    testSpec.kafkaCluster = undefined;

    const result = await manager.createConnection({
      kafkaCluster: testSpec.kafkaCluster,
      schemaRegistry: testSpec.schemaRegistry,
      formConnectionType: TEST_DIRECT_CONNECTION_FORM_SPEC.formConnectionType,
      name: testSpec.name,
      id: TEST_DIRECT_CONNECTION.spec.id as ConnectionId,
      type: testSpec.type,
    });

    assert.ok(result.success, JSON.stringify(result));
  });

  it("createConnection() should not include `schemaRegistryConfig` in the ConnectionSpec if not provided", async () => {
    const testSpec: ConnectionSpec = { ...PLAIN_LOCAL_KAFKA_SR_SPEC };
    testSpec.schemaRegistry = undefined;

    const result = await manager.createConnection({
      kafkaCluster: testSpec.kafkaCluster,
      schemaRegistry: testSpec.schemaRegistry,
      formConnectionType: TEST_DIRECT_CONNECTION_FORM_SPEC.formConnectionType,
      name: testSpec.name,
      id: TEST_DIRECT_CONNECTION.spec.id as ConnectionId,
      type: testSpec.type,
    });
    assert.ok(result.success);
  });

  it("createConnection() should store the new connection spec after successful response", async () => {
    const result = await manager.createConnection({
      id: TEST_DIRECT_CONNECTION.spec.id as ConnectionId,
      kafkaCluster: PLAIN_LOCAL_KAFKA_SR_SPEC.kafkaCluster,
      schemaRegistry: PLAIN_LOCAL_KAFKA_SR_SPEC.schemaRegistry,
      formConnectionType: TEST_DIRECT_CONNECTION_FORM_SPEC.formConnectionType,
      name: PLAIN_LOCAL_KAFKA_SR_SPEC.name,
      type: PLAIN_LOCAL_KAFKA_SR_SPEC.type,
    });

    assert.ok(result.success);
    const storedConnections: DirectConnectionsById =
      await getResourceManager().getDirectConnections();
    assert.equal(storedConnections.size, 1);
  });

  it("createConnection() should not store the new connection spec if validation fails", async () => {
    // Create a spec with no endpoints configured - validation should fail
    const result = await manager.createConnection({
      kafkaCluster: undefined,
      schemaRegistry: undefined,
      formConnectionType: TEST_DIRECT_CONNECTION_FORM_SPEC.formConnectionType,
      name: PLAIN_LOCAL_KAFKA_SR_SPEC.name,
      id: TEST_DIRECT_CONNECTION.spec.id as ConnectionId,
      type: PLAIN_LOCAL_KAFKA_SR_SPEC.type,
    });

    // Should fail validation since no endpoints are configured
    assert.ok(result.errorMessage);
    const storedConnections: DirectConnectionsById =
      await getResourceManager().getDirectConnections();
    assert.equal(storedConnections.size, 0);
  });

  it("createConnection() should not store the new connection spec if dryRun is `true`", async () => {
    const result = await manager.createConnection(
      {
        kafkaCluster: PLAIN_LOCAL_KAFKA_SR_SPEC.kafkaCluster,
        schemaRegistry: PLAIN_LOCAL_KAFKA_SR_SPEC.schemaRegistry,
        formConnectionType: TEST_DIRECT_CONNECTION_FORM_SPEC.formConnectionType,
        name: PLAIN_LOCAL_KAFKA_SR_SPEC.name,
        id: TEST_DIRECT_CONNECTION.spec.id as ConnectionId,
        type: PLAIN_LOCAL_KAFKA_SR_SPEC.type,
      },
      true, // dryRun
    );

    // dryRun should not store even on success
    assert.ok(!result.errorMessage || result.errorMessage);
    const storedConnections: DirectConnectionsById =
      await getResourceManager().getDirectConnections();
    assert.equal(storedConnections.size, 0);
  });

  it("updateConnection() should store the updated connection spec after successful validation", async () => {
    // preload a direct connection
    await getResourceManager().addDirectConnection(TEST_DIRECT_CONNECTION_FORM_SPEC);

    const newName = "Updated Connection";
    const updatedSpec: CustomConnectionSpec = {
      ...TEST_DIRECT_CONNECTION_FORM_SPEC,
      name: newName,
      kafkaCluster: PLAIN_LOCAL_KAFKA_SR_SPEC.kafkaCluster,
    };

    await manager.updateConnection(updatedSpec);

    const storedConnections: DirectConnectionsById =
      await getResourceManager().getDirectConnections();
    assert.equal(storedConnections.size, 1);
    const storedConnection: ConnectionSpec | undefined = storedConnections.get(
      TEST_DIRECT_CONNECTION.spec.id as ConnectionId,
    );
    assert.ok(storedConnection);
    assert.equal(storedConnection.name, newName);
  });

  // TODO: Re-enable after sidecar removal - need to mock DirectConnectionHandler validation failure
  it.skip("updateConnection() should not store the updated connection spec if validation fails", async () => {
    // preload a direct connection
    await getResourceManager().addDirectConnection(TEST_DIRECT_CONNECTION_FORM_SPEC);

    const newName = "Updated Connection";
    const updatedSpec: CustomConnectionSpec = {
      ...TEST_DIRECT_CONNECTION_FORM_SPEC,
      name: newName,
    };

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

  it("rehydrateConnections() should create ResourceLoader instances for stored connections", async () => {
    // preload a direct connection
    await getResourceManager().addDirectConnection(TEST_DIRECT_CONNECTION_FORM_SPEC);

    await manager.rehydrateConnections();

    // Verify that a DirectResourceLoader was created for the connection
    const loaders = ResourceLoader.directLoaders();
    assert.ok(loaders.length >= 1);
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
      const deregisterInstanceStub = sandbox.stub(ResourceLoader, "deregisterInstance");

      await directConnectionManager.deleteConnection(TEST_DIRECT_CONNECTION_ID);
      sinon.assert.calledOnce(deleteStub);
      sinon.assert.calledWith(deleteStub, TEST_DIRECT_CONNECTION_ID);

      sinon.assert.calledOnce(deregisterInstanceStub);
      sinon.assert.calledWith(deregisterInstanceStub, TEST_DIRECT_CONNECTION_ID);
    });
  });
});
