import sinon from "sinon";
import "mocha";
import * as assert from "assert";
import { MicroProfileHealthApi, ResponseError } from "../clients/sidecar";
import * as sidecar from "../sidecar";
import { SIDECAR_PROCESS_ID_HEADER } from "./constants";

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
