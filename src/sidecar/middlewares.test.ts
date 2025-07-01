import * as assert from "assert";
import sinon from "sinon";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { RequestContext } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ccloudAuthSessionInvalidated } from "../emitters";
import { getResourceManager, ResourceManager } from "../storage/resourceManager";
import { SIDECAR_CONNECTION_ID_HEADER } from "./constants";
import { CCloudAuthStatusMiddleware } from "./middlewares";

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

describe("CCloudAuthStatusMiddleware behavior", () => {
  let resourceManager: ResourceManager;
  let middleware: CCloudAuthStatusMiddleware;

  let sandbox: sinon.SinonSandbox;
  let getCCloudAuthStatusStub: sinon.SinonStub;
  let handleCCloudAuthStatusSpy: sinon.SinonSpy;
  let handleCCloudInvalidTokenStatusStub: sinon.SinonStub;
  let ccloudAuthSessionInvalidatedStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    ccloudAuthSessionInvalidatedStub = sandbox.stub(ccloudAuthSessionInvalidated, "fire");

    resourceManager = getResourceManager();
    getCCloudAuthStatusStub = sandbox.stub(resourceManager, "getCCloudAuthStatus").resolves();

    middleware = new CCloudAuthStatusMiddleware();
    handleCCloudAuthStatusSpy = sandbox.spy(middleware, "handleCCloudAuthStatus");
    handleCCloudInvalidTokenStatusStub = sandbox
      .stub(middleware, "handleCCloudInvalidTokenStatus")
      .resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should call handleCCloudAuthStatus() when the correct CCloud connection header is passed", async () => {
    const requestContext = fakeRequestWithHeader(
      SIDECAR_CONNECTION_ID_HEADER,
      CCLOUD_CONNECTION_ID,
    );
    getCCloudAuthStatusStub.resolves("foo");

    await middleware.pre(requestContext);

    assert.ok(handleCCloudAuthStatusSpy.calledOnce);
    assert.ok(handleCCloudInvalidTokenStatusStub.notCalled);
  });

  it("should not call handleCCloudAuthStatus() when the CCloud connection header is missing", async () => {
    const requestContext1 = fakeRequestWithHeader("some-other-header", "some-value");
    const requestContext2 = fakeRequestWithHeader("some-other-header", CCLOUD_CONNECTION_ID);
    const requestContext3 = fakeRequestWithHeader(SIDECAR_CONNECTION_ID_HEADER, "some-value");

    await middleware.pre(requestContext1);
    await middleware.pre(requestContext2);
    await middleware.pre(requestContext3);

    assert.ok(handleCCloudAuthStatusSpy.notCalled);
    assert.ok(handleCCloudInvalidTokenStatusStub.notCalled);
  });

  it("should call handleCCloudInvalidTokenStatus() from an INVALID_TOKEN auth status", async () => {
    const requestContext = fakeRequestWithHeader(
      SIDECAR_CONNECTION_ID_HEADER,
      CCLOUD_CONNECTION_ID,
    );
    getCCloudAuthStatusStub.resolves("INVALID_TOKEN");

    await middleware.pre(requestContext);

    assert.ok(handleCCloudAuthStatusSpy.calledOnce);
    assert.ok(handleCCloudInvalidTokenStatusStub.calledOnce);
  });

  it("should fire ccloudAuthSessionInvalidated from a NO_TOKEN or FAILED auth status", async () => {
    const requestContext = fakeRequestWithHeader(
      SIDECAR_CONNECTION_ID_HEADER,
      CCLOUD_CONNECTION_ID,
    );
    getCCloudAuthStatusStub.resolves("FAILED");

    await middleware.pre(requestContext);

    assert.ok(ccloudAuthSessionInvalidatedStub.calledOnce);

    // isn't easy to get into this state since we should delete the CCloud connection and reset the
    // associated resources for the (previous) connection, but just in case:
    getCCloudAuthStatusStub.resolves("NO_TOKEN");

    await middleware.pre(requestContext);

    assert.ok(ccloudAuthSessionInvalidatedStub.calledTwice);
  });

  it("should not block requests from a VALID_TOKEN auth status", async () => {
    const requestContext = fakeRequestWithHeader(
      SIDECAR_CONNECTION_ID_HEADER,
      CCLOUD_CONNECTION_ID,
    );
    getCCloudAuthStatusStub.resolves("VALID_TOKEN");

    await middleware.pre(requestContext);

    assert.ok(handleCCloudAuthStatusSpy.calledOnce);
    assert.ok(handleCCloudInvalidTokenStatusStub.notCalled);
    assert.ok(ccloudAuthSessionInvalidatedStub.notCalled);
  });
});
