import assert from "assert";
import { configDotenv } from "dotenv";
import sinon from "sinon";
import * as vscode from "vscode";
import { TEST_CCLOUD_CONNECTION } from "../../tests/unit/testResources/connection";
import { getExtensionContext } from "../../tests/unit/testUtils";
import { Connection, Status } from "../clients/sidecar";
import { nonInvalidTokenStatus } from "../emitters";
import * as connections from "../sidecar/connections";
import { ResourceManager } from "../storage/resourceManager";
import {
  AuthPromptTracker,
  checkAuthExpiration,
  MINUTES_UNTIL_REAUTH_WARNING,
  pollCCloudConnectionAuth,
  REAUTH_BUTTON_TEXT,
  REMIND_BUTTON_TEXT,
  watchCCloudConnectionStatus,
} from "./ccloudPolling";

configDotenv();

/**
 * Light test wrapper to update the `requires_authentication_at` field in a {@link Connection} object.
 */
function createFakeConnection(expiresInMinutes: number | undefined): Connection {
  const connection = TEST_CCLOUD_CONNECTION;
  connection.status.authentication.requires_authentication_at = expiresInMinutes
    ? new Date(Date.now() + expiresInMinutes * 60 * 1000)
    : undefined;
  return connection;
}

describe("authn/ccloudPolling.ts checkAuthExpiration()", () => {
  let sandbox: sinon.SinonSandbox;

  let showWarningMessageStub: sinon.SinonStub;
  let showErrorMessageStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // assume the user doesn't click any notification buttons by default for most tests
    showWarningMessageStub = sandbox.stub(vscode.window, "showWarningMessage").resolves();
    showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage").resolves();
    // prevent attempting to open a browser window for these tests
    sandbox.stub(vscode.env, "openExternal");
  });

  afterEach(() => {
    // reset the AuthPromptTracker singleton instance so it can be recreated fresh for each test
    AuthPromptTracker["instance"] = null;
    sandbox.restore();
  });

  /** Reusable helper function to check that our "reauth warning" notification was called as expected. */
  function assertReauthWarningPromptOpened() {
    assert.ok(
      showWarningMessageStub.calledOnceWith(
        sinon.match("Confluent Cloud authentication will expire"),
        sinon.match(REAUTH_BUTTON_TEXT),
        sinon.match(REMIND_BUTTON_TEXT),
      ),
      `showWarningMessage called ${showWarningMessageStub.callCount}/1 time(s) with args [${showWarningMessageStub.args}]`,
    );
    assert.ok(AuthPromptTracker.getInstance().reauthWarningPromptOpen);
  }

  /** Reusable helper function to check that our "auth expired" notification was called as expected. */
  function assertAuthExpiredPromptOpened() {
    assert.ok(
      showErrorMessageStub.calledOnceWith(
        sinon.match("Confluent Cloud authentication expired"),
        sinon.match(REAUTH_BUTTON_TEXT),
      ),
      `showErrorMessage called ${showErrorMessageStub.callCount}/1 time(s) with args [${showErrorMessageStub.args}]`,
    );
  }

  it("should not show any notifications if auth doesn't expire soon and there are no errors", async () => {
    // check against a connection that expires in 120min
    const connection = createFakeConnection(120);

    await checkAuthExpiration(connection);

    // warning notification should not show up
    assert.ok(showWarningMessageStub.notCalled);
    assert.ok(!AuthPromptTracker.getInstance().reauthWarningPromptOpen);
    // error notification should not show up
    assert.ok(showErrorMessageStub.notCalled);
  });

  it("should show a warning notification if auth expires soon", async () => {
    // check against a connection that expires "soon"
    const expiringSoonConnection = createFakeConnection(MINUTES_UNTIL_REAUTH_WARNING - 1);
    // simulate a user clicking "Reauthenticate" so we don't reset `.reauthWarningPromptOpen`
    showWarningMessageStub.resolves(REAUTH_BUTTON_TEXT);

    await checkAuthExpiration(expiringSoonConnection);

    // warning notification should show up
    assertReauthWarningPromptOpened();
    // error notification should not show up
    assert.ok(showErrorMessageStub.notCalled);
  });

  it("should show an error notification if auth has expired", async () => {
    // expired auth will cycle the CCloud connection, which requires the auth provider to be set up,
    // which requires the extension context to be available
    await getExtensionContext();
    // check against a connection that expired already (5min ago)
    const expiredConnection = createFakeConnection(-5);

    await checkAuthExpiration(expiredConnection);

    // warning notification should not show up
    assert.ok(showWarningMessageStub.notCalled);
    assert.ok(!AuthPromptTracker.getInstance().reauthWarningPromptOpen);
    // error notification should show up
    assertAuthExpiredPromptOpened();
  });

  it("should show a warning notification and then an error notification if auth expiration is ignored long enough", async () => {
    // expired auth will cycle the CCloud connection, which requires the auth provider to be set up,
    // which requires the extension context to be available
    await getExtensionContext();
    // simulate a user clicking "Reauthenticate" so we don't reset `.reauthWarningPromptOpen`
    showWarningMessageStub.resolves(REAUTH_BUTTON_TEXT);

    // PART 1) check against a connection that expires "soon"
    const expiringConnection = createFakeConnection(MINUTES_UNTIL_REAUTH_WARNING - 1);
    await checkAuthExpiration(expiringConnection);
    // warning notification should show up
    assertReauthWarningPromptOpened();
    // error notification should not show up
    assert.ok(showErrorMessageStub.notCalled);

    // reset the stubs so we can check the next notification
    showWarningMessageStub.resetHistory();
    showErrorMessageStub.resetHistory();

    // PART 2) check again once we're past the auth expiration time
    const expiredConnection = createFakeConnection(-5);
    await checkAuthExpiration(expiredConnection);
    // warning notification should not show up again, but should still be open
    assert.ok(showWarningMessageStub.notCalled);
    assert.ok(AuthPromptTracker.getInstance().reauthWarningPromptOpen);
    // error notification should show up
    assertAuthExpiredPromptOpened();
  });

  it("checkAuthExpiration() should handle undefined `requires_authentication_at`", async () => {
    // no expiration time available, e.g. auth flow hasn't completed yet
    try {
      await checkAuthExpiration(createFakeConnection(undefined));
    } catch {
      assert.fail("checkAuthExpiration threw an error with undefined expiration");
    }
    // warning notification should not show up
    assert.ok(showWarningMessageStub.notCalled);
    assert.ok(!AuthPromptTracker.getInstance().reauthWarningPromptOpen);
    // error notification should not show up
    assert.ok(showErrorMessageStub.notCalled);
  });
});

describe("authn/ccloudPolling.ts watchCCloudConnectionStatus()", () => {
  let sandbox: sinon.SinonSandbox;

  let getCCloudConnectionStub: sinon.SinonStub;
  let nonInvalidTokenStatusFireStub: sinon.SinonStub;
  let stubResourceManager: sinon.SinonStubbedInstance<ResourceManager>;
  let pollFastStub: sinon.SinonStub;
  let pollSlowStub: sinon.SinonStub;

  before(async () => {
    await getExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    getCCloudConnectionStub = sandbox.stub(connections, "getCCloudConnection");
    nonInvalidTokenStatusFireStub = sandbox.stub(nonInvalidTokenStatus, "fire");

    stubResourceManager = sinon.createStubInstance(ResourceManager);
    sandbox.stub(ResourceManager, "getInstance").returns(stubResourceManager);

    pollFastStub = sandbox.stub(pollCCloudConnectionAuth, "useFastFrequency");
    pollSlowStub = sandbox.stub(pollCCloudConnectionAuth, "useSlowFrequency");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should take no action when no connection is fetched from the sidecar", async () => {
    getCCloudConnectionStub.resolves(undefined);

    await watchCCloudConnectionStatus();

    assert.ok(stubResourceManager.setCCloudAuthStatus.notCalled);
    assert.ok(pollFastStub.notCalled);
    assert.ok(nonInvalidTokenStatusFireStub.notCalled);
    assert.ok(pollSlowStub.notCalled);
  });

  const nonTransientStatuses: Status[] = ["FAILED", "NO_TOKEN", "VALID_TOKEN"];
  nonTransientStatuses.forEach((status) => {
    it(`should fire the nonInvalidTokenStatus event emitter when the CCloud auth status is ${status}`, async () => {
      const connection = createFakeConnection(120);
      connection.status.authentication.status = status;
      getCCloudConnectionStub.resolves(connection);

      await watchCCloudConnectionStatus();

      assert.ok(stubResourceManager.setCCloudAuthStatus.calledOnceWith(status));
      assert.ok(pollFastStub.notCalled);
      assert.ok(nonInvalidTokenStatusFireStub.called);
      assert.ok(pollSlowStub.called);
    });
  });

  it("should NOT fire the nonInvalidTokenStatus event emitter when the CCloud auth status is INVALID_TOKEN", async () => {
    const status = "INVALID_TOKEN";
    const connection = createFakeConnection(120);
    connection.status.authentication.status = status;
    getCCloudConnectionStub.resolves(connection);

    await watchCCloudConnectionStatus();

    assert.ok(stubResourceManager.setCCloudAuthStatus.calledOnceWith(status));
    assert.ok(pollFastStub.called);
    assert.ok(nonInvalidTokenStatusFireStub.notCalled);
    assert.ok(pollSlowStub.notCalled);
  });

  // TODO(shoup): ccloudPolling.ts will need to be refactored to allow stubbing across the entire module
  // it("should call checkAuthErrors() when the connection hasn't passed its requires_authentication_at time", async () => {
  //   const connection = createFakeConnection(120);
  //   getCCloudConnectionStub.resolves(connection);

  //   await watchCCloudConnectionStatus();

  //   assert.ok(
  //     checkAuthErrorsStub.calledOnceWith(connection),
  //     `checkAuthErrors(): ${checkAuthErrorsStub.callCount} -> ${JSON.stringify(checkAuthErrorsStub.args)}`,
  //   );
  // });

  // it("should not call checkAuthErrors() when the connection has passed its requires_authentication_at time", async () => {
  //   const connection = createFakeConnection(-5);
  //   getCCloudConnectionStub.resolves(connection);

  //   await watchCCloudConnectionStatus();

  //   assert.ok(checkAuthErrorsStub.notCalled);
  // });
});
