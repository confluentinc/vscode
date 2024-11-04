import * as assert from "assert";
import * as sinon from "sinon";
import * as sidecar from ".";
import { getExtensionContext } from "../../tests/unit/testUtils";
import { Connection, ConnectionsResourceApi } from "../clients/sidecar";
import { CCLOUD_CONNECTION_SPEC, LOCAL_CONNECTION_SPEC } from "../constants";
import { ContextValues, setContextValue } from "../context";
import { currentKafkaClusterChanged, currentSchemaRegistryChanged } from "../emitters";
import { getResourceManager } from "../storage/resourceManager";
import {
  clearCurrentCCloudResources,
  deleteCCloudConnection,
  getLocalConnection,
  hasCCloudAuthSession,
  tryToCreateConnection,
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
    // setContextValue(ContextValues.ccloudConnectionAvailable, false);

    sandbox.restore();
  });

  for (const connectionSpec of [LOCAL_CONNECTION_SPEC, CCLOUD_CONNECTION_SPEC]) {
    it(`${connectionSpec.type}: tryToGetConnection() should return null if no connection exists / we get a 404 response`, async () => {
      stubConnectionsResourceApi.gatewayV1ConnectionsIdGet.rejects({ response: { status: 404 } });

      const connection = await getLocalConnection();

      assert.strictEqual(connection, null);
    });

    it(`${connectionSpec.type}: tryToGetConnection() should return a connection if it exists`, async () => {
      const expectedConnection: Connection = { id: "test-id" } as Connection;
      stubConnectionsResourceApi.gatewayV1ConnectionsIdGet.resolves(expectedConnection);

      const connection = await getLocalConnection();

      assert.strictEqual(connection, expectedConnection);
    });

    it(`${connectionSpec.type}: tryToCreateConnection() should create and return a new connection`, async () => {
      const expectedConnection: Connection = { id: "test-id" } as Connection;
      stubConnectionsResourceApi.gatewayV1ConnectionsPost.resolves(expectedConnection);

      const connection = await tryToCreateConnection(connectionSpec);

      assert.strictEqual(connection, expectedConnection);
    });
  }

  it("deleteCCloudConnection() should delete the connection without error", async () => {
    stubConnectionsResourceApi.gatewayV1ConnectionsIdDelete.resolves();

    await assert.doesNotReject(deleteCCloudConnection());
  });

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
