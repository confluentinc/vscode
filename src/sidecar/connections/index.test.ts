import * as assert from "assert";
import * as sinon from "sinon";
import * as sidecar from "..";
import {
  TEST_CCLOUD_CONNECTION,
  TEST_DIRECT_CONNECTION,
  TEST_LOCAL_CONNECTION,
} from "../../../tests/unit/testResources/connection";
import {
  Connection,
  ConnectionFromJSON,
  ConnectionSpecToJSON,
  ConnectionsResourceApi,
  ResponseError,
} from "../../clients/sidecar";

import {
  tryToCreateConnection,
  tryToDeleteConnection,
  tryToGetConnection,
  tryToUpdateConnection,
} from ".";

describe("sidecar/connections/index.ts", () => {
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

      const connection = await tryToGetConnection(testConnection.id);

      assert.strictEqual(connection, null);
    });

    it(`${testConnection.spec.type}: tryToGetConnection() should return a connection if it exists`, async () => {
      stubConnectionsResourceApi.gatewayV1ConnectionsIdGet.resolves(testConnection);

      const connection = await tryToGetConnection(testConnection.id);

      assert.strictEqual(connection, testConnection);
    });

    it(`${testConnection.spec.type}: tryToCreateConnection() should create and return a new connection`, async () => {
      stubConnectionsResourceApi.gatewayV1ConnectionsPost.resolves(testConnection);

      const connection = await tryToCreateConnection(testConnection.spec);

      assert.strictEqual(connection, testConnection);
    });

    it(`${testConnection.spec.type}: tryToUpdateConnection() should update and return a connection`, async () => {
      const updatedConnection: Connection = ConnectionFromJSON({
        ...testConnection,
        spec: { ...testConnection.spec, name: "updated-name" },
      });
      stubConnectionsResourceApi.gatewayV1ConnectionsIdPatch.resolves(updatedConnection);

      const connection = await tryToUpdateConnection(updatedConnection.spec);

      // should've converted from the Connection type to the JSON type
      const callArgs = stubConnectionsResourceApi.gatewayV1ConnectionsIdPatch.getCall(0).args;
      assert.deepStrictEqual(callArgs[0], {
        id: updatedConnection.id,
        body: ConnectionSpecToJSON(updatedConnection.spec),
      });
      assert.deepStrictEqual(connection, updatedConnection);
    });

    it(`${testConnection.spec.type}: tryToDeleteConnection() should not re-throw 404 response errors`, async () => {
      const error = new ResponseError(new Response(null, { status: 404 }));
      stubConnectionsResourceApi.gatewayV1ConnectionsIdDeleteRaw.rejects(error);

      const promise = tryToDeleteConnection(testConnection.id);

      await assert.doesNotReject(promise);
    });
  }
});
