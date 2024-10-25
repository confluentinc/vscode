import * as assert from "assert";
import sinon from "sinon";
import { RequestContext, ResponseContext } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../constants";
import * as middlewares from "./middlewares";

function fakeRequestWithHeader(key: string, value: string): RequestContext {
  return {
    fetch: () => Promise.resolve(new Response()),
    url: "test",
    init: {
      headers: {
        [key]: value,
      },
    },
  };
}

function fakeResponseWithHeader(key: string, value: string): ResponseContext {
  const request = fakeRequestWithHeader(key, value);
  return {
    ...request,
    response: new Response(),
  };
}

describe("CCloudRecentRequestsMiddleware methods", () => {
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;
  let middleware: middlewares.CCloudRecentRequestsMiddleware;
  let numRecentCCloudRequestsStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers();
    middleware = new middlewares.CCloudRecentRequestsMiddleware();
    // can't edit this as a read-only import, so we use a stub to set the value, but then
    // assert against `middlewares.numRecentCCloudRequests` directly
    numRecentCCloudRequestsStub = sandbox.stub(middlewares, "numRecentCCloudRequests").value(0);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("pre() should increment numRecentCCloudRequests only if the x-connection-id header is set to the static CCloud connection ID", async () => {
    const requestContext = fakeRequestWithHeader("x-connection-id", CCLOUD_CONNECTION_ID);

    await middleware.pre(requestContext);

    assert.equal(middlewares.numRecentCCloudRequests, 1);
  });

  it("pre() should NOT increment numRecentCCloudRequests for non-'x-connection-id' headers", async () => {
    const requestContext = fakeRequestWithHeader("foo", CCLOUD_CONNECTION_ID);

    await middleware.pre(requestContext);

    assert.equal(middlewares.numRecentCCloudRequests, 0);
  });

  it("pre() should NOT increment numRecentCCloudRequests for 'x-connection-id' headers that don't match the static CCloud connection ID", async () => {
    const requestContext = fakeRequestWithHeader("x-connection-id", LOCAL_CONNECTION_ID);

    await middleware.pre(requestContext);

    assert.equal(middlewares.numRecentCCloudRequests, 0);
  });

  it("post() should decrement numRecentCCloudRequests after a delay if headers contain 'x-connection-id'", async () => {
    const numRequests = 1;
    const responseContext = fakeResponseWithHeader("x-connection-id", CCLOUD_CONNECTION_ID);
    numRecentCCloudRequestsStub.value(numRequests);

    await middleware.post(responseContext);

    assert.equal(middlewares.numRecentCCloudRequests, numRequests);
    clock.tick(15000);
    assert.equal(middlewares.numRecentCCloudRequests, numRequests - 1);
  });

  it("post() should NOT decrement numRecentCCloudRequests if headers don't contain 'x-connection-id'", async () => {
    const numRequests = 1;
    const responseContext = fakeResponseWithHeader("foo", CCLOUD_CONNECTION_ID);
    numRecentCCloudRequestsStub.value(numRequests);

    await middleware.post(responseContext);
    clock.tick(15000);

    assert.equal(middlewares.numRecentCCloudRequests, numRequests);
  });

  it("post() should NOT decrement numRecentCCloudRequests for 'x-connection-id' headers that don't match the static CCloud connection ID", async () => {
    const numRequests = 1;
    const responseContext = fakeResponseWithHeader("foo", CCLOUD_CONNECTION_ID);
    numRecentCCloudRequestsStub.value(numRequests);

    await middleware.post(responseContext);
    clock.tick(15000);

    assert.equal(middlewares.numRecentCCloudRequests, numRequests);
  });
});
