import assert from "assert";
import { configDotenv } from "dotenv";
import sinon from "sinon";
import * as vscode from "vscode";
import { TEST_CCLOUD_CONNECTION } from "../../tests/unit/testResources/connection";
import { getExtensionContext } from "../../tests/unit/testUtils";
import { Connection, Status } from "../clients/sidecar";
import { nonInvalidTokenStatus } from "../emitters";
import * as connections from "../sidecar/connections";
import {
  AUTH_PROMPT_TRACKER,
  checkAuthExpiration,
  MINUTES_UNTIL_REAUTH_WARNING,
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

describe("CCloud auth expiration checks", () => {
  let sandbox: sinon.SinonSandbox;
  let showWarningMessageStub: sinon.SinonStub;
  let showErrorMessageStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // REAUTH_BUTTON_TEXT is the only option that doesn't adjust the AuthPromptTracker's
    // `reauthWarningPromptOpen`, so if we don't use that, we'll see weird state changes
    const warningMessageThenable = Promise.resolve(REAUTH_BUTTON_TEXT);
    showWarningMessageStub = sandbox.stub(vscode.window, "showWarningMessage");
    showWarningMessageStub.returns(warningMessageThenable);

    // we don't need to handle any specific return value for this stub
    const errorMessageThenable = Promise.resolve("test");
    showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage");
    showErrorMessageStub.returns(errorMessageThenable);

    // reset the auth prompt tracker state
    AUTH_PROMPT_TRACKER.authErrorPromptOpen = false;
    AUTH_PROMPT_TRACKER.reauthWarningPromptOpen = false;
    AUTH_PROMPT_TRACKER.earliestReauthWarning = new Date(0);
  });

  afterEach(() => {
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
    assert.ok(AUTH_PROMPT_TRACKER.reauthWarningPromptOpen);
  }

  /** Reusable helper function to check that our "reauth warning" notification was NOT called. */
  function assertReauthWarningPromptNotOpened() {
    assert.ok(
      showWarningMessageStub.notCalled,
      `showWarningMessage called ${showWarningMessageStub.callCount}/0 time(s) with args [${showWarningMessageStub.args}]`,
    );
    // not checking .reauthWarningPromptOpen here because it may be opened from a previous call,
    // just want to make sure the notification isn't trying to be opened again
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

  /** Reusable helper function to check that our "auth expired" notification was NOT called. */
  function assertAuthExpiredPromptNotOpened() {
    assert.ok(
      showErrorMessageStub.notCalled,
      `showErrorMessage called ${showErrorMessageStub.callCount}/0 time(s) with args [${showErrorMessageStub.args}]`,
    );
  }

  it("should not show any notifications if auth doesn't expire soon", async () => {
    // check against a connection that expires in 120min
    await checkAuthExpiration(createFakeConnection(120));
    // warning notification should not show up
    assertReauthWarningPromptNotOpened();
    assert.ok(!AUTH_PROMPT_TRACKER.reauthWarningPromptOpen);
    // error notification should not show up
    assertAuthExpiredPromptNotOpened();
  });

  it("should show a warning notification if auth expires soon", async () => {
    // check against a connection that expires "soon"
    await checkAuthExpiration(createFakeConnection(MINUTES_UNTIL_REAUTH_WARNING - 1));
    // warning notification should show up
    assertReauthWarningPromptOpened();
    // error notification should not show up
    assertAuthExpiredPromptNotOpened();
  });

  it("should show an error notification if auth has expired", async () => {
    // expired auth will cycle the CCloud connection, which requires the auth provider to be set up,
    // which requires the extension context to be available
    await getExtensionContext();

    // check against a connection that expired already (5min ago)
    await checkAuthExpiration(createFakeConnection(-5));
    // warning notification should not show up
    assertReauthWarningPromptNotOpened();
    assert.ok(!AUTH_PROMPT_TRACKER.reauthWarningPromptOpen);
    // error notification should show up
    assertAuthExpiredPromptOpened();
  });

  it("should show a warning notification and then an error notification if auth expiration is ignored long enough", async () => {
    // expired auth will cycle the CCloud connection, which requires the auth provider to be set up,
    // which requires the extension context to be available
    await getExtensionContext();

    // PART 1) check against a connection that expires "soon"
    await checkAuthExpiration(createFakeConnection(MINUTES_UNTIL_REAUTH_WARNING - 1));
    // warning notification should show up
    assertReauthWarningPromptOpened();
    // error notification should not show up
    assertAuthExpiredPromptNotOpened();

    // reset the stubs so we can check the next notification
    showWarningMessageStub.resetHistory();
    showErrorMessageStub.resetHistory();

    // PART 2) check again once we're past the auth expiration time
    await checkAuthExpiration(createFakeConnection(-5));
    // warning notification should not show up again, but should still be open
    assertReauthWarningPromptNotOpened();
    assert.ok(AUTH_PROMPT_TRACKER.reauthWarningPromptOpen);
    // error notification should show up
    console.error("part 2: error notification");
    assertAuthExpiredPromptOpened();
  });

  it("should handle undefined `requires_authentication_at`", async () => {
    // no expiration time available, e.g. auth flow hasn't completed yet
    try {
      await checkAuthExpiration(createFakeConnection(undefined));
    } catch {
      assert.fail("checkAuthExpiration threw an error with undefined expiration");
    }
    // warning notification should not show up
    assertReauthWarningPromptNotOpened();
    assert.ok(!AUTH_PROMPT_TRACKER.reauthWarningPromptOpen);
    // error notification should not show up
    assertAuthExpiredPromptNotOpened();
  });
});

describe("CCloud connection status polling", () => {
  let sandbox: sinon.SinonSandbox;
  let getCCloudConnectionStub: sinon.SinonStub;
  let nonInvalidTokenStatusFireStub: sinon.SinonStub;

  before(async () => {
    await getExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    getCCloudConnectionStub = sandbox.stub(connections, "getCCloudConnection");
    nonInvalidTokenStatusFireStub = sandbox.stub(nonInvalidTokenStatus, "fire");
  });

  afterEach(() => {
    sandbox.restore();
  });

  const nonTransientStatuses: Status[] = ["FAILED", "NO_TOKEN", "VALID_TOKEN"];
  nonTransientStatuses.forEach((status) => {
    it(`should fire the nonInvalidTokenStatus event emitter when the CCloud auth status is ${status}`, async () => {
      const connection = createFakeConnection(120);
      connection.status.authentication.status = status;
      getCCloudConnectionStub.resolves(connection);

      await watchCCloudConnectionStatus();

      assert.ok(nonInvalidTokenStatusFireStub.called);
    });
  });

  it("should NOT fire the nonInvalidTokenStatus event emitter when the CCloud auth status is INVALID_TOKEN", async () => {
    const connection = createFakeConnection(120);
    connection.status.authentication.status = "INVALID_TOKEN";
    getCCloudConnectionStub.resolves(connection);

    await watchCCloudConnectionStatus();

    assert.ok(nonInvalidTokenStatusFireStub.notCalled);
  });
});
