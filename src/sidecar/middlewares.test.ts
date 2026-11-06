import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { hungFetch } from "../../tests/unit/testUtils";
import type { RequestContext } from "../clients/sidecar";
import {
  Configuration,
  ConnectedState,
  FetchError,
  PreferencesResourceApi,
} from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ccloudAuthSessionInvalidated, stableCCloudConnectedState } from "../emitters";
import { SecretStorageKeys } from "../storage/constants";
import type { ResourceManager } from "../storage/resourceManager";
import { getResourceManager } from "../storage/resourceManager";
import * as storageUtils from "../storage/utils";
import { RequestTimeoutError } from "../utils/timing";
import { CCLOUD_RECONNECT_TIMEOUT_MS, SIDECAR_CONNECTION_ID_HEADER } from "./constants";
import { CCloudReconnectTimeoutError } from "./errors";
import {
  CCloudAuthStatusMiddleware,
  ErrorResponseMiddleware,
  TimeoutMiddleware,
} from "./middlewares";

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

    sinon.assert.calledOnce(handleCCloudAuthStatusSpy);
    sinon.assert.notCalled(handleProblematicStatusStub);
  });

  it("should not call handleCCloudAuthStatus() when the CCloud connection header is missing", async () => {
    const requestContext1 = fakeRequestWithHeader("some-other-header", "some-value");
    const requestContext2 = fakeRequestWithHeader("some-other-header", CCLOUD_CONNECTION_ID);
    const requestContext3 = fakeRequestWithHeader(SIDECAR_CONNECTION_ID_HEADER, "some-value");

    await middleware.pre(requestContext1);
    await middleware.pre(requestContext2);
    await middleware.pre(requestContext3);

    sinon.assert.notCalled(handleCCloudAuthStatusSpy);
    sinon.assert.notCalled(handleProblematicStatusStub);
  });

  it(`should call handleProblematicStatus() from the ${ConnectedState.Expired} state`, async () => {
    const requestContext = fakeRequestWithHeader(
      SIDECAR_CONNECTION_ID_HEADER,
      CCLOUD_CONNECTION_ID,
    );
    getCCloudStateStub.resolves(ConnectedState.Expired);

    await middleware.pre(requestContext);

    sinon.assert.calledOnce(handleCCloudAuthStatusSpy);
    sinon.assert.calledOnce(handleProblematicStatusStub);
  });

  it(`should fire ccloudAuthSessionInvalidated from a ${ConnectedState.None} or ${ConnectedState.Failed} state`, async () => {
    const requestContext = fakeRequestWithHeader(
      SIDECAR_CONNECTION_ID_HEADER,
      CCLOUD_CONNECTION_ID,
    );
    getCCloudStateStub.resolves(ConnectedState.Failed);

    await middleware.pre(requestContext);

    sinon.assert.calledOnce(ccloudAuthSessionInvalidatedStub);

    // isn't easy to get into this state since we should delete the CCloud connection and reset the
    // associated resources for the (previous) connection, but just in case:
    getCCloudStateStub.resolves(ConnectedState.None);

    await middleware.pre(requestContext);

    sinon.assert.calledTwice(ccloudAuthSessionInvalidatedStub);
  });

  it(`should not block requests from the ${ConnectedState.Success} state`, async () => {
    const requestContext = fakeRequestWithHeader(
      SIDECAR_CONNECTION_ID_HEADER,
      CCLOUD_CONNECTION_ID,
    );
    getCCloudStateStub.resolves(ConnectedState.Success);

    await middleware.pre(requestContext);

    sinon.assert.calledOnce(handleCCloudAuthStatusSpy);
    sinon.assert.notCalled(handleProblematicStatusStub);
    sinon.assert.notCalled(ccloudAuthSessionInvalidatedStub);
  });
});

describe("CCloudAuthStatusMiddleware.handleProblematicStatus() deadline", () => {
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;
  let disposeSpy: sinon.SinonSpy;
  let secretListener: (e: vscode.SecretStorageChangeEvent) => Promise<void>;
  let getSecretStorageStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers();
    disposeSpy = sandbox.spy();
    const onDidChange = sandbox.stub().callsFake((listener) => {
      secretListener = listener;
      return { dispose: disposeSpy };
    });
    getSecretStorageStub = sandbox
      .stub(storageUtils, "getSecretStorage")
      .returns({ onDidChange } as unknown as vscode.SecretStorage);
    sandbox.stub(vscode.window, "withProgress").resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should reject a request still waiting when the deadline passes", async () => {
    const waiting = new CCloudAuthStatusMiddleware().handleProblematicStatus();
    const rejected = assert.rejects(waiting, CCloudReconnectTimeoutError);

    await clock.tickAsync(CCLOUD_RECONNECT_TIMEOUT_MS);

    await rejected;
    sinon.assert.calledOnce(disposeSpy);
  });

  it("should tell the user to sign in again when the deadline passes", async () => {
    const waiting = new CCloudAuthStatusMiddleware().handleProblematicStatus();
    const rejected = assert.rejects(
      waiting,
      (err) => err instanceof CCloudReconnectTimeoutError && err.message.endsWith("Sign in again."),
    );

    await clock.tickAsync(CCLOUD_RECONNECT_TIMEOUT_MS);

    await rejected;
  });

  it("should close the reconnect notification when the deadline passes, so it can show again", async () => {
    const notificationClosed = sandbox.spy();
    const subscription = stableCCloudConnectedState.event(notificationClosed);
    const middleware = new CCloudAuthStatusMiddleware();
    const firstWait = assert.rejects(middleware.handleProblematicStatus());
    await clock.tickAsync(CCLOUD_RECONNECT_TIMEOUT_MS);
    await firstWait;
    const withProgressStub = vscode.window.withProgress as sinon.SinonStub;
    const notificationsShown = withProgressStub.callCount;

    const secondWait = assert.rejects(middleware.handleProblematicStatus());
    await clock.tickAsync(CCLOUD_RECONNECT_TIMEOUT_MS);
    await secondWait;
    subscription.dispose();

    sinon.assert.calledTwice(notificationClosed);
    assert.strictEqual(withProgressStub.callCount, notificationsShown + 1);
  });

  it("should keep the reconnect notification open until the last waiting request times out", async () => {
    const notificationClosed = sandbox.spy();
    const subscription = stableCCloudConnectedState.event(notificationClosed);
    const middleware = new CCloudAuthStatusMiddleware();
    const firstWait = assert.rejects(middleware.handleProblematicStatus());
    await clock.tickAsync(50_000);
    const secondWait = assert.rejects(middleware.handleProblematicStatus());

    await clock.tickAsync(CCLOUD_RECONNECT_TIMEOUT_MS - 50_000);
    await firstWait;
    const closedAfterFirstDeadline = notificationClosed.callCount;
    await clock.tickAsync(50_000);
    await secondWait;
    subscription.dispose();

    assert.strictEqual(closedAfterFirstDeadline, 0);
    sinon.assert.calledOnce(notificationClosed);
  });

  it("should keep waiting long enough for the sidecar to retry a token refresh", async () => {
    let settled = false;
    const waiting = new CCloudAuthStatusMiddleware()
      .handleProblematicStatus()
      .finally(() => (settled = true));
    const rejected = assert.rejects(waiting, CCloudReconnectTimeoutError);

    // one more sidecar refresh attempt can take about 100s
    await clock.tickAsync(100_000);
    assert.strictEqual(settled, false);
    await clock.tickAsync(CCLOUD_RECONNECT_TIMEOUT_MS - 100_000);

    await rejected;
  });

  it("should pass on a failure to watch the connection state, not report a timeout", async () => {
    const watchFailure = new Error("secret storage unavailable");
    getSecretStorageStub.returns({
      onDidChange: () => {
        throw watchFailure;
      },
    } as unknown as vscode.SecretStorage);

    await assert.rejects(
      new CCloudAuthStatusMiddleware().handleProblematicStatus(),
      (err) => err === watchFailure,
    );
  });

  it("should unblock on a connection state change and clear its deadline", async () => {
    const waiting = new CCloudAuthStatusMiddleware().handleProblematicStatus();
    await clock.tickAsync(0);
    // other modules may hold timers of their own, so count relative to now
    const timersWhileWaiting = clock.countTimers();

    await secretListener({ key: SecretStorageKeys.CCLOUD_STATE });
    await waiting;

    assert.strictEqual(clock.countTimers(), timersWhileWaiting - 1);
    sinon.assert.calledOnce(disposeSpy);
  });
});

describe("TimeoutMiddleware", () => {
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers();
  });

  afterEach(() => {
    sandbox.restore();
  });

  function preferencesApi(fetchApi: typeof fetch = hungFetch): PreferencesResourceApi {
    return new PreferencesResourceApi(
      new Configuration({
        basePath: "http://sidecar.test",
        fetchApi,
        middleware: [new TimeoutMiddleware(30_000)],
      }),
    );
  }

  it("should fail a hung request with a RequestTimeoutError once its budget is spent", async () => {
    let settled = false;
    const request = preferencesApi()
      .gatewayV1PreferencesGet()
      .finally(() => (settled = true));
    const rejected = assert.rejects(
      request,
      (err) => err instanceof RequestTimeoutError && /timed out after 30s/.test(err.message),
    );

    await clock.tickAsync(29_999);
    assert.strictEqual(settled, false);
    await clock.tickAsync(1);

    await rejected;
  });

  it("should let a caller's own abort through unchanged", async () => {
    const caller = new AbortController();
    const request = preferencesApi().gatewayV1PreferencesGet({ signal: caller.signal });
    const rejected = assert.rejects(
      request,
      (err) => err instanceof FetchError && err.cause.name === "AbortError",
    );

    caller.abort();

    await rejected;
  });

  it("should clear its timer once the response arrives", async () => {
    const timersBefore = clock.countTimers();
    const api = preferencesApi(async () => Response.json({}));

    await api.gatewayV1PreferencesGet();

    assert.strictEqual(clock.countTimers(), timersBefore);
  });

  it("should fail with a RequestTimeoutError when an error body stalls past its budget", async () => {
    /** Error headers at once, then a body that never finishes until the signal aborts. */
    const stalledErrorFetch = async (_url: string | URL | Request, init?: RequestInit) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(init.signal!.reason));
          },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    const api = new PreferencesResourceApi(
      new Configuration({
        basePath: "http://sidecar.test",
        fetchApi: stalledErrorFetch,
        // the real order: the error logger reads the body before the timeout's post hook runs
        middleware: [new ErrorResponseMiddleware(), new TimeoutMiddleware(30_000)],
      }),
    );

    const rejected = assert.rejects(
      api.gatewayV1PreferencesGet(),
      (err) => err instanceof RequestTimeoutError && err.message.includes("(HTTP 500)"),
    );
    await clock.tickAsync(30_000);

    await rejected;
  });
});
