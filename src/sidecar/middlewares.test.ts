import * as assert from "assert";
import sinon from "sinon";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ConnectedState, RequestContext } from "../clients/sidecar";
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
  let getCCloudStateStub: sinon.SinonStub;
  let handleCCloudAuthStatusSpy: sinon.SinonSpy;
  let handleProblematicStatusStub: sinon.SinonStub;
  let ccloudAuthSessionInvalidatedStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    ccloudAuthSessionInvalidatedStub = sandbox.stub(ccloudAuthSessionInvalidated, "fire");

    resourceManager = getResourceManager();
    getCCloudStateStub = sandbox.stub(resourceManager, "getCCloudState").resolves();

    middleware = new CCloudAuthStatusMiddleware();
    handleCCloudAuthStatusSpy = sandbox.spy(middleware, "handleCCloudAuthStatus");
    handleProblematicStatusStub = sandbox.stub(middleware, "handleProblematicStatus").resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should call handleCCloudAuthStatus() when the correct CCloud connection header is passed", async () => {
    const requestContext = fakeRequestWithHeader(
      SIDECAR_CONNECTION_ID_HEADER,
      CCLOUD_CONNECTION_ID,
    );
    getCCloudStateStub.resolves(ConnectedState.Success);

    await middleware.pre(requestContext);

    assert.ok(handleCCloudAuthStatusSpy.calledOnce);
    assert.ok(handleProblematicStatusStub.notCalled);
  });

  it("should not call handleCCloudAuthStatus() when the CCloud connection header is missing", async () => {
    const requestContext1 = fakeRequestWithHeader("some-other-header", "some-value");
    const requestContext2 = fakeRequestWithHeader("some-other-header", CCLOUD_CONNECTION_ID);
    const requestContext3 = fakeRequestWithHeader(SIDECAR_CONNECTION_ID_HEADER, "some-value");

    await middleware.pre(requestContext1);
    await middleware.pre(requestContext2);
    await middleware.pre(requestContext3);

    assert.ok(handleCCloudAuthStatusSpy.notCalled);
    assert.ok(handleProblematicStatusStub.notCalled);
  });

  it(`should call handleProblematicStatus() from the ${ConnectedState.Expired} state`, async () => {
    const requestContext = fakeRequestWithHeader(
      SIDECAR_CONNECTION_ID_HEADER,
      CCLOUD_CONNECTION_ID,
    );
    getCCloudStateStub.resolves(ConnectedState.Expired);

    await middleware.pre(requestContext);

    assert.ok(handleCCloudAuthStatusSpy.calledOnce);
    assert.ok(handleProblematicStatusStub.calledOnce);
  });

  it(`should fire ccloudAuthSessionInvalidated from a ${ConnectedState.None} or ${ConnectedState.Failed} state`, async () => {
    const requestContext = fakeRequestWithHeader(
      SIDECAR_CONNECTION_ID_HEADER,
      CCLOUD_CONNECTION_ID,
    );
    getCCloudStateStub.resolves(ConnectedState.Failed);

    await middleware.pre(requestContext);

    assert.ok(ccloudAuthSessionInvalidatedStub.calledOnce);

    // isn't easy to get into this state since we should delete the CCloud connection and reset the
    // associated resources for the (previous) connection, but just in case:
    getCCloudStateStub.resolves(ConnectedState.None);

    await middleware.pre(requestContext);

    assert.ok(ccloudAuthSessionInvalidatedStub.calledTwice);
  });

  it(`should not block requests from the ${ConnectedState.Success} state`, async () => {
    const requestContext = fakeRequestWithHeader(
      SIDECAR_CONNECTION_ID_HEADER,
      CCLOUD_CONNECTION_ID,
    );
    getCCloudStateStub.resolves(ConnectedState.Success);

    await middleware.pre(requestContext);

    assert.ok(handleCCloudAuthStatusSpy.calledOnce);
    assert.ok(handleProblematicStatusStub.notCalled);
    assert.ok(ccloudAuthSessionInvalidatedStub.notCalled);
  });
});
