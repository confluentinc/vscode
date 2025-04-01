import * as assert from "assert";
import "mocha";
import sinon from "sinon";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { MicroProfileHealthApi, ResponseError } from "../clients/sidecar";
import * as sidecar from "../sidecar";
import { Message, MessageType, newMessageHeaders } from "../ws/messageTypes";
import { SIDECAR_PROCESS_ID_HEADER } from "./constants";
import { WebsocketManager } from "./websocketManager";

describe("getSidecarPid() tests", () => {
  let sandbox: sinon.SinonSandbox;
  let mockClient: sinon.SinonStubbedInstance<MicroProfileHealthApi>;
  let sidecarHandle: sinon.SinonStubbedInstance<sidecar.SidecarHandle>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    // create the stubs for the sidecar + service client
    sidecarHandle = sandbox.createStubInstance(sidecar.SidecarHandle);
    mockClient = sandbox.createStubInstance(MicroProfileHealthApi);

    sidecarHandle.getMicroProfileHealthApi.returns(mockClient);

    // Want to call through to the actual implementation of getSidecarPid
    sidecarHandle.getSidecarPid.callThrough();
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("getSidecarPid() should return the sidecar pid when health check rejection includes header", async function () {
    mockClient.microprofileHealthLiveness.throws(
      new ResponseError(
        new Response(null, {
          headers: new Headers([[SIDECAR_PROCESS_ID_HEADER, "1234"]]),
          status: 401,
          statusText: "Wrong access token",
        }),
      ),
    );

    const pid = await sidecarHandle.getSidecarPid();
    assert.strictEqual(pid, 1234);
  });

  it("getSidecarPid() should raise exception if claimed pid <= 1 or not an integer", async function () {
    for (const badPidStr of ["-1", "0", "notAnInt"]) {
      mockClient.microprofileHealthLiveness.throws(
        new ResponseError(
          new Response(null, {
            headers: new Headers([[SIDECAR_PROCESS_ID_HEADER, badPidStr]]),
            status: 401,
            statusText: "Wrong access token",
          }),
        ),
      );

      console.log("Trying bad pid: " + badPidStr);

      await assert.rejects(sidecarHandle.getSidecarPid(), /Failed to parse sidecar PID/);
    }
  });

  it("getSidecarPid() should raise exception if health check rejection does not include header", async function () {
    mockClient.microprofileHealthLiveness.throws(
      new ResponseError(
        new Response(null, {
          status: 401,
          statusText: "Wrong access token",
        }),
      ),
    );

    await assert.rejects(
      sidecarHandle.getSidecarPid(),
      /Failed to get sidecar PID: unexpected error/,
    );
  });

  it("getSidecarPid() should raise exception if health check rejection is not a ResponseError", async function () {
    mockClient.microprofileHealthLiveness.throws(new Error("Some other error"));

    await assert.rejects(sidecarHandle.getSidecarPid(), /Some other error/);
  });

  // This one is for us here at home.
  it("getSidecarPid() should raise exception if microprofileHealthLiveness() call succeeds (quarkus dev mode)", async function () {
    mockClient.microprofileHealthLiveness.resolves({});

    await assert.rejects(
      sidecarHandle.getSidecarPid(),
      /Failed to get sidecar PID: healthcheck did not raise 401 Unauthorized/,
    );
  });
});

describe("sidecarHandle websocket tests", () => {
  before(async () => {
    await getTestExtensionContext();
  });

  describe("wsSend() tests", () => {
    it("wsSend() hates messages with wrong originator", async () => {
      const badOriginatorMessage: Message<MessageType.WORKSPACE_HELLO> = {
        headers: {
          message_type: MessageType.WORKSPACE_HELLO,
          originator: "bad",
          message_id: "1",
        },
        body: {
          workspace_id: 1234,
        },
      };

      const handle = await sidecar.getSidecar();

      assert.throws(
        () => {
          handle.wsSend(badOriginatorMessage);
        },
        {
          message: `Expected message originator to be '${process.pid}', got 'bad'`,
        },
      );
    });

    it("wsSend() works with good message when connected", async () => {
      const goodMessage: Message<MessageType.WORKSPACE_HELLO> = {
        headers: newMessageHeaders(MessageType.WORKSPACE_HELLO),
        body: {
          workspace_id: 1234,
        },
      };

      const handle = await sidecar.getSidecar();

      // wsSend() will actually send message to sidecar, which will then
      // at this time consider relaying it to other workspaces,
      // but there aren't any, so will just evaporate there.

      // If/when sidecar message routing gets smarter and perhaps needs
      // a different message type to tickle that behavior (when we have
      // them), then we will need to switch this message type for this test.

      handle.wsSend(goodMessage);
    });
  });

  describe("wsSend() when disconnected tests", () => {
    const websocketManager = WebsocketManager.getInstance();

    after(async () => {
      // restore the websocket as side-effect of getting sidecar handle
      await sidecar.getSidecar();
      assert.equal(true, websocketManager.isConnected());
    });

    it("wsSend() should raise exception when disconnected", async () => {
      const message: Message<MessageType.WORKSPACE_HELLO> = {
        headers: newMessageHeaders(MessageType.WORKSPACE_HELLO),
        body: {
          workspace_id: process.pid,
        },
      };

      const handle = await sidecar.getSidecar();

      // Disconnect the websocket after having gotten the sidecar handle
      websocketManager.dispose();
      assert.equal(false, websocketManager.isConnected());

      // Act
      // Assert raises
      assert.throws(
        () => {
          handle.wsSend(message);
        },
        {
          message: "Websocket closed",
        },
      );
    });
  });
});

describe("sidecarHandle Flink API method tests", () => {
  let handle: sidecar.SidecarHandle;

  before(async () => {
    await getTestExtensionContext();
    handle = await sidecar.getSidecar();
  });

  it("constructFlinkDataPlaneClientHeaders() should return headers with correct values", async () => {
    const headers = handle.constructFlinkDataPlaneClientHeaders(TEST_CCLOUD_FLINK_COMPUTE_POOL);
    assert.strictEqual(headers["x-connection-id"], TEST_CCLOUD_FLINK_COMPUTE_POOL.connectionId);
    assert.strictEqual(headers["x-ccloud-provider"], TEST_CCLOUD_FLINK_COMPUTE_POOL.provider);
    assert.strictEqual(headers["x-ccloud-region"], TEST_CCLOUD_FLINK_COMPUTE_POOL.region);
  });

  it("getFlinkSqlStatementsApi() should return a FlinkSqlStatementsApi instance given a sample flink compute pool", async () => {
    const api = handle.getFlinkSqlStatementsApi(TEST_CCLOUD_FLINK_COMPUTE_POOL);
    assert.strictEqual(api.constructor.name, "StatementsSqlV1Api");
  });

  it("getFlinkArtifactsApi() should return a FlinkArtifactsApi instance given no args.", async () => {
    const api = handle.getFlinkArtifactsApi();
    assert.strictEqual(api.constructor.name, "FlinkArtifactsArtifactV1Api");
  });

  it("getFlinkComputePoolsApi() should return a FlinkComputePoolsApi instance given no args.", async () => {
    const api = handle.getFlinkComputePoolsApi();
    assert.strictEqual(api.constructor.name, "ComputePoolsFcpmV2Api");
  });
});
