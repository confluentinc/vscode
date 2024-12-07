import * as assert from "assert";
import * as sinon from "sinon";
import * as sidecar from ".";
import {
  TEST_CCLOUD_CONNECTION,
  TEST_DIRECT_CONNECTION,
  TEST_LOCAL_CONNECTION,
} from "../../tests/unit/testResources/connection";
import { getExtensionContext } from "../../tests/unit/testUtils";
import { Connection, ConnectionsResourceApi, ResponseError } from "../clients/sidecar";
import { ContextValues, setContextValue } from "../context/values";
import { currentKafkaClusterChanged, currentSchemaRegistryChanged } from "../emitters";
import { getResourceManager } from "../storage/resourceManager";
import {
  clearCurrentCCloudResources,
  getLocalConnection,
  hasCCloudAuthSession,
  tryToCreateConnection,
  tryToDeleteConnection,
  tryToUpdateConnection,
} from "./connections";

describe("sidecar/connections.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let stubConnectionsResourceApi: sinon.SinonStubbedInstance<ConnectionsResourceApi>;

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
});
