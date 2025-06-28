import * as assert from "assert";
import * as sinon from "sinon";
import { NetworkApi, ResponseError } from "../clients/docker";
import { createNetwork } from "./networks";

describe("docker/networks.ts NetworkApi wrappers", () => {
  let sandbox: sinon.SinonSandbox;

  let networkCreateStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // need to stub the NetworkApi class methods directly instead of using a stubbed instance,
    // because the functions below are constructing new instances of the NetworkApi class each time
    // and if we stubbed the instance, the stubs would not be applied to the new instances and the
    // tests would try to call the real methods
    networkCreateStub = sandbox.stub(NetworkApi.prototype, "networkCreate").resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("createNetwork() should return nothing after successfully creating a network", async () => {
    networkCreateStub.resolves();

    await createNetwork("test-network", "bridge");

    assert.ok(networkCreateStub.calledOnce);
    assert.ok(
      networkCreateStub.calledWithMatch({
        networkConfig: { Name: "test-network", Driver: "bridge" },
      }),
    );
  });

  it("createNetwork() should return nothing, but handle 'already exists' 409 ResponseErrors and not re-throw", async () => {
    const fakeError = new ResponseError(
      new Response("network with name test-network already exists", {
        status: 409,
        statusText: "Conflict",
      }),
    );
    networkCreateStub.rejects(fakeError);

    const result = await createNetwork("test-network", "bridge");

    assert.strictEqual(result, undefined);
    assert.ok(networkCreateStub.calledOnce);
  });

  it("createNetwork() should re-throw any ResponseError that doesn't contain 'already exists' in the message", async () => {
    const fakeError = new ResponseError(
      new Response("uh oh", {
        status: 500,
        statusText: "Internal Server Error",
      }),
    );
    networkCreateStub.rejects(fakeError);

    await assert.rejects(createNetwork("test-network", "bridge"), fakeError);
    assert.ok(networkCreateStub.calledOnce);
  });

  it("createNetwork() should re-throw any non-ResponseError error", async () => {
    const fakeError = new Error("Some other error");
    networkCreateStub.rejects(fakeError);

    await assert.rejects(createNetwork("test-network", "bridge"), fakeError);
    assert.ok(networkCreateStub.calledOnce);
  });
});
