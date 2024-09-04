import { chromium } from "@playwright/test";
import assert from "assert";
import { configDotenv } from "dotenv";
import sinon from "sinon";
import * as vscode from "vscode";
import { getSidecar } from ".";
import { TEST_CCLOUD_CONNECTION } from "../../tests/unit/testResources/connection";
import { getExtensionContext, getTestStorageManager } from "../../tests/unit/testUtils";
import { Connection } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { StorageManager } from "../storage";
import {
  AUTH_PROMPT_TRACKER,
  MINUTES_UNTIL_REAUTH_WARNING,
  REAUTH_BUTTON_TEXT,
  REMIND_BUTTON_TEXT,
  checkAuthExpiration,
  createCCloudConnection,
  deleteCCloudConnection,
} from "./connections";

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
  let showWarningMessageStub: sinon.SinonStub;
  let showErrorMessageStub: sinon.SinonStub;

  beforeEach(() => {
    // REAUTH_BUTTON_TEXT is the only option that doesn't adjust the AuthPromptTracker's
    // `reauthWarningPromptOpen`, so if we don't use that, we'll see weird state changes
    const warningMessageThenable = Promise.resolve(REAUTH_BUTTON_TEXT);
    showWarningMessageStub = sinon.stub(vscode.window, "showWarningMessage");
    showWarningMessageStub.returns(warningMessageThenable);

    // we don't need to handle any specific return value for this stub
    const errorMessageThenable = Promise.resolve("test");
    showErrorMessageStub = sinon.stub(vscode.window, "showErrorMessage");
    showErrorMessageStub.returns(errorMessageThenable);

    // reset the auth prompt tracker state
    AUTH_PROMPT_TRACKER.authErrorPromptOpen = false;
    AUTH_PROMPT_TRACKER.reauthWarningPromptOpen = false;
    AUTH_PROMPT_TRACKER.earliestReauthWarning = new Date(0);
  });

  afterEach(() => {
    showWarningMessageStub.restore();
    showErrorMessageStub.restore();
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
    // log the showErrorMessageStub properties to help debug
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

describe("CCloud auth flow", () => {
  let storageManager: StorageManager;

  before(async () => {
    storageManager = await getTestStorageManager();
  });

  beforeEach(async () => {
    await storageManager.clearWorkspaceState();
    // make sure we don't have a lingering CCloud connection from other tests
    await deleteCCloudConnection();
  });

  it("should successfully authenticate via CCloud with the sign_in_uri", async function () {
    if (!process.env.E2E_USERNAME || !process.env.E2E_PASSWORD) {
      // These env vars needed within testAuthFlow() for any of this to work.
      console.log("Skipping test: E2E_USERNAME and/or E2E_PASSWORD not set in .env file");
      this.skip();
    }

    // NOTE: can't be used with an arrow-function because it needs to be able to access `this`
    this.slow(10000); // mark this test as slow if it takes longer than 10s
    this.retries(2); // retry this test up to 2 times if it fails
    const newConnection: Connection = await createCCloudConnection();
    await testAuthFlow(newConnection.metadata.sign_in_uri!);
    // make sure the newly-created connection is available via the sidecar
    const client = (await getSidecar()).getConnectionsResourceApi();
    const connection = await client.gatewayV1ConnectionsIdGet({ id: CCLOUD_CONNECTION_ID });
    assert.ok(
      connection,
      "No connections found; make sure to manually log in with the test username/password, because the 'Authorize App: Confluent VS Code Extension is requesting access to your Confluent account' (https://login.confluent.io/u/consent?...) page may be blocking the auth flow for this test. If that doesn't work, try running the test with `{ headless: false }` (in testAuthFlow()) to see what's happening.",
    );
    assert.ok(connection);
    assert.notEqual(connection.status.authentication.status, "NO_TOKEN");
    assert.equal(connection.status.authentication.user?.username, process.env.E2E_USERNAME);
  });
});

async function testAuthFlow(signInUri: string) {
  const browser = await chromium.launch(); // set { headless: false } here for local debugging
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(signInUri);

  await page.locator("[name=email]").fill(process.env.E2E_USERNAME!);
  await page.locator("[type=submit]").click();
  await page.locator("[name=password]").fill(process.env.E2E_PASSWORD!);
  await page.locator("[type=submit]").click();
  await page.waitForURL(/127\.0\.0\.1/, { waitUntil: "networkidle" });
  await page.close();
}
