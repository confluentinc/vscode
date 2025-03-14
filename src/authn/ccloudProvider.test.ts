import { chromium } from "@playwright/test";
import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
  TEST_AUTHENTICATED_CCLOUD_CONNECTION,
  TEST_CCLOUD_CONNECTION,
  TEST_CCLOUD_USER,
} from "../../tests/unit/testResources/connection";
import { getTestExtensionContext, getTestStorageManager } from "../../tests/unit/testUtils";
import { Connection } from "../clients/sidecar";
import { CCLOUD_AUTH_CALLBACK_URI, CCLOUD_CONNECTION_ID } from "../constants";
import { ccloudAuthSessionInvalidated } from "../emitters";
import { getSidecar } from "../sidecar";
import * as ccloud from "../sidecar/connections/ccloud";
import * as watcher from "../sidecar/connections/watcher";
import { getStorageManager, StorageManager } from "../storage";
import { SecretStorageKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";
import { getUriHandler, UriEventHandler } from "../uriHandler";
import { ConfluentCloudAuthProvider, getAuthProvider } from "./ccloudProvider";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "./constants";
import { AuthCallbackEvent } from "./types";

const TEST_CCLOUD_AUTH_SESSION: vscode.AuthenticationSession = {
  id: TEST_CCLOUD_CONNECTION.id!,
  accessToken: TEST_CCLOUD_CONNECTION.id!,
  account: {
    id: TEST_CCLOUD_USER.id!,
    label: TEST_CCLOUD_USER.username!,
  },
  scopes: [],
};

describe("authn/ccloudProvider.ts ConfluentCloudAuthProvider methods", () => {
  let authProvider: ConfluentCloudAuthProvider;
  let uriHandler: UriEventHandler;

  let sandbox: sinon.SinonSandbox;
  // vscode stubs
  let showErrorMessageStub: sinon.SinonStub;
  let showInfoMessageStub: sinon.SinonStub;
  // helper function stubs
  let getCCloudConnectionStub: sinon.SinonStub;
  let createCCloudConnectionStub: sinon.SinonStub;
  let deleteConnectionStub: sinon.SinonStub;
  // auth provider stubs
  let browserAuthFlowStub: sinon.SinonStub;
  let stubOnDidChangeSessions: sinon.SinonStubbedInstance<
    vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>
  >;

  before(async () => {
    await getTestExtensionContext();

    uriHandler = getUriHandler();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    getCCloudConnectionStub = sandbox.stub(ccloud, "getCCloudConnection");
    createCCloudConnectionStub = sandbox.stub(ccloud, "createCCloudConnection");
    deleteConnectionStub = sandbox.stub(ccloud, "deleteCCloudConnection");

    // assume the connection is immediately usable for most tests
    sandbox
      .stub(watcher, "waitForConnectionToBeStable")
      .resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);

    authProvider = getAuthProvider();
    // don't handle the progress notification, openExternal, etc in this test suite
    browserAuthFlowStub = sandbox.stub(authProvider, "browserAuthFlow").resolves();
    stubOnDidChangeSessions = sandbox.createStubInstance(vscode.EventEmitter);
    authProvider["_onDidChangeSessions"] = stubOnDidChangeSessions;

    showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage").resolves();
    showInfoMessageStub = sandbox.stub(vscode.window, "showInformationMessage").resolves();
  });

  afterEach(() => {
    // reset the singleton instance between tests
    ConfluentCloudAuthProvider["instance"] = null;
    sandbox.restore();
  });

  it("createSession() should create a new CCloud connection when one doesn't exist", async () => {
    // first call doesn't return a Connection, second call returns the connection from createCCloudConnection()
    getCCloudConnectionStub.onFirstCall().resolves(null);
    createCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
    getCCloudConnectionStub.onSecondCall().resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
    // authentication completes successfully
    browserAuthFlowStub.resolves({ success: true, resetPassword: false });

    await authProvider.createSession();

    sinon.assert.calledOnce(createCCloudConnectionStub);
    sinon.assert.calledOnce(browserAuthFlowStub);
  });

  it("createSession() should reuse an existing CCloud connection", async () => {
    getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
    // authentication completes successfully
    browserAuthFlowStub.resolves({ success: true, resetPassword: false });

    await authProvider.createSession();

    sinon.assert.notCalled(createCCloudConnectionStub);
    sinon.assert.calledOnce(browserAuthFlowStub);
  });

  it("createSession() should update the auth status secret on successful authentication", async () => {
    const setSecretStub = sandbox.stub(getStorageManager(), "setSecret").resolves();
    getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
    // authentication completes successfully
    browserAuthFlowStub.resolves({ success: true, resetPassword: false });

    await authProvider.createSession();

    sinon.assert.calledWith(
      setSecretStub,
      SecretStorageKeys.CCLOUD_AUTH_STATUS,
      TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.authentication.status,
    );
  });

  it("createSession() should handle authentication failure", async () => {
    getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
    // authentication fails
    browserAuthFlowStub.resolves({ success: false, resetPassword: false });

    const authFailedMsg = "Confluent Cloud authentication failed. See browser for details.";
    await assert.rejects(authProvider.createSession(), {
      message: authFailedMsg,
    });

    sinon.assert.calledWith(showErrorMessageStub, authFailedMsg);
  });

  it("createSession() should handle password reset scenario", async () => {
    getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
    // password reset occurred
    browserAuthFlowStub.resolves({ success: false, resetPassword: true });

    await assert.rejects(authProvider.createSession(), {
      message: "User reset their password.",
    });

    sinon.assert.calledWith(
      showInfoMessageStub,
      "Your password has been reset. Please sign in again to Confluent Cloud.",
      sinon.match(CCLOUD_SIGN_IN_BUTTON_LABEL),
    );
  });

  it("createSession() should handle user cancellation", async () => {
    getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
    // user cancels the operation
    browserAuthFlowStub.resolves(undefined);

    await assert.rejects(authProvider.createSession(), {
      message: "User cancelled the authentication flow.",
    });

    sinon.assert.notCalled(deleteConnectionStub);
    sinon.assert.notCalled(showInfoMessageStub);
    sinon.assert.notCalled(showErrorMessageStub);
  });

  it("getSessions() should treat connections with a NO_TOKEN/FAILED auth status as nonexistent", async () => {
    getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);

    const sessions = await authProvider.getSessions();

    assert.deepStrictEqual(sessions, []);
  });

  it("getSessions() should return an empty array when no connection exists", async () => {
    getCCloudConnectionStub.resolves(null);

    const sessions = await authProvider.getSessions();

    assert.deepStrictEqual(sessions, []);
  });

  it("getSessions() should return an AuthenticationSession when a valid connection exists", async () => {
    getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);

    const sessions = await authProvider.getSessions();

    assert.strictEqual(sessions.length, 1);
    assert.deepStrictEqual(sessions[0], TEST_CCLOUD_AUTH_SESSION);
  });

  it("removeSession() should delete an existing connection and the auth status secret", async () => {
    const handleSessionRemovedStub = sandbox.stub().resolves();
    authProvider["handleSessionRemoved"] = handleSessionRemovedStub;
    getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
    const deleteSecretStub = sandbox.stub(getStorageManager(), "deleteSecret").resolves();

    await authProvider.removeSession("sessionId");

    assert.ok(deleteConnectionStub.called);
    assert.ok(deleteSecretStub.calledWith(SecretStorageKeys.CCLOUD_AUTH_STATUS));
    assert.ok(handleSessionRemovedStub.calledWith(true));
  });

  it("removeSession() should only update the provider's internal state when no connection exists", async () => {
    const handleSessionRemovedStub = sandbox.stub().resolves();
    authProvider["handleSessionRemoved"] = handleSessionRemovedStub;
    getCCloudConnectionStub.resolves(null);

    authProvider["_session"] = null;
    await authProvider.removeSession("sessionId");

    assert.ok(deleteConnectionStub.notCalled);
    assert.ok(handleSessionRemovedStub.notCalled);
  });

  it("removeSession() should only update the provider's internal state when no connection exists but the provider is still tracking a session internally", async () => {
    const handleSessionRemovedStub = sandbox.stub().resolves();
    authProvider["handleSessionRemoved"] = handleSessionRemovedStub;
    getCCloudConnectionStub.resolves(null);

    authProvider["_session"] = TEST_CCLOUD_AUTH_SESSION;
    await authProvider.removeSession("sessionId");

    assert.ok(deleteConnectionStub.notCalled);
    assert.ok(handleSessionRemovedStub.calledWith(true));
  });

  it("handleSessionCreated() should update the provider's internal state, fire the _onDidChangeSessions event.", async () => {
    const storageManager = getStorageManager();
    const setSecretStub = sandbox.stub(storageManager, "setSecret").resolves();

    await authProvider["handleSessionCreated"](TEST_CCLOUD_AUTH_SESSION, true);

    assert.strictEqual(authProvider["_session"], TEST_CCLOUD_AUTH_SESSION);
    assert.ok(setSecretStub.calledWith(SecretStorageKeys.AUTH_SESSION_EXISTS, "true"));
    assert.ok(stubOnDidChangeSessions.fire.called);
    assert.ok(
      stubOnDidChangeSessions.fire.calledWith({
        added: [TEST_CCLOUD_AUTH_SESSION],
        removed: [],
        changed: [],
      }),
    );
  });

  it("handleSessionRemoved() should update the provider's internal state, fire the _onDidChangeSessions event.", async () => {
    const storageManager = getStorageManager();
    const deleteSecretStub = sandbox.stub(storageManager, "deleteSecret").resolves();

    authProvider["_session"] = TEST_CCLOUD_AUTH_SESSION;
    await authProvider["handleSessionRemoved"](true);

    assert.strictEqual(authProvider["_session"], null);
    assert.ok(deleteSecretStub.calledWith(SecretStorageKeys.AUTH_SESSION_EXISTS));
    assert.ok(deleteSecretStub.calledWith(SecretStorageKeys.AUTH_COMPLETED));
    assert.ok(deleteSecretStub.calledWith(SecretStorageKeys.AUTH_PASSWORD_RESET));
    assert.ok(stubOnDidChangeSessions.fire.called);
    assert.ok(
      stubOnDidChangeSessions.fire.calledWith({
        added: [],
        removed: [TEST_CCLOUD_AUTH_SESSION],
        changed: [],
      }),
    );
  });

  it("handleSessionSecretChange() should call handleSessionCreated() when a session is available", async () => {
    const handleSessionCreatedStub = sandbox.stub().resolves();
    authProvider["handleSessionCreated"] = handleSessionCreatedStub;
    const handleSessionRemovedStub = sandbox.stub().resolves();
    authProvider["handleSessionRemoved"] = handleSessionRemovedStub;
    sandbox.stub(vscode.authentication, "getSession").resolves(TEST_CCLOUD_AUTH_SESSION);

    await authProvider["handleSessionSecretChange"]();

    assert.ok(handleSessionCreatedStub.calledOnceWith(TEST_CCLOUD_AUTH_SESSION));
    assert.ok(handleSessionRemovedStub.notCalled);
  });

  it("handleSessionSecretChange() should call handleSessionRemoved() when no session is available", async () => {
    const handleSessionCreatedStub = sandbox.stub().resolves();
    authProvider["handleSessionCreated"] = handleSessionCreatedStub;
    const handleSessionRemovedStub = sandbox.stub().resolves();
    authProvider["handleSessionRemoved"] = handleSessionRemovedStub;

    sandbox.stub(vscode.authentication, "getSession").resolves(undefined);

    authProvider["_session"] = TEST_CCLOUD_AUTH_SESSION;
    await authProvider["handleSessionSecretChange"]();

    assert.ok(handleSessionCreatedStub.notCalled);
    assert.ok(handleSessionRemovedStub.called);
  });

  for (const success of [true, false] as const) {
    it(`should return '${success}' from waitForUriHandling when the URI query contains 'success=${success}'`, async () => {
      const promise: Promise<AuthCallbackEvent> = authProvider.waitForUriHandling();

      const uri = vscode.Uri.parse(CCLOUD_AUTH_CALLBACK_URI).with({ query: `success=${success}` });
      uriHandler.handleUri(uri);

      const result: AuthCallbackEvent = await promise;
      assert.strictEqual(result.success, success);
    });
  }
});

describe("authn/ccloudProvider.ts ConfluentCloudAuthProvider URI handling", () => {
  let authProvider: ConfluentCloudAuthProvider;

  let sandbox: sinon.SinonSandbox;
  // vscode stubs
  let showInfoMessageStub: sinon.SinonStub;
  // helper function stubs
  let deleteConnectionStub: sinon.SinonStub;
  // auth provider stubs
  let createSessionStub: sinon.SinonStub;
  let stubOnDidChangeSessions: sinon.SinonStubbedInstance<
    vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>
  >;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    showInfoMessageStub = sandbox.stub(vscode.window, "showInformationMessage").resolves();

    deleteConnectionStub = sandbox.stub(ccloud, "deleteCCloudConnection");

    authProvider = getAuthProvider();
    createSessionStub = sandbox.stub(authProvider, "createSession").resolves();
    // don't handle the progress notification, openExternal, etc in this test suite
    stubOnDidChangeSessions = sandbox.createStubInstance(vscode.EventEmitter);
    authProvider["_onDidChangeSessions"] = stubOnDidChangeSessions;

    // assume the connection is immediately usable for most tests
    sandbox
      .stub(watcher, "waitForConnectionToBeStable")
      .resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
  });

  afterEach(() => {
    // reset the singleton instance between tests
    ConfluentCloudAuthProvider["instance"] = null;
    sandbox.restore();
  });

  it("showResetPasswordNotification() should display a message with sign-in button", async () => {
    // user dismissed the notification
    showInfoMessageStub.resolves(undefined);

    authProvider.showResetPasswordNotification();

    sinon.assert.calledWith(
      showInfoMessageStub,
      "Your password has been reset. Please sign in again to Confluent Cloud.",
      CCLOUD_SIGN_IN_BUTTON_LABEL,
    );
    sinon.assert.notCalled(createSessionStub);
  });

  it("showResetPasswordNotification() should call createSession when the sign-in button is clicked", async () => {
    const clock = sandbox.useFakeTimers(Date.now());
    // user clicked the sign-in button
    showInfoMessageStub.resolves(CCLOUD_SIGN_IN_BUTTON_LABEL);

    authProvider.showResetPasswordNotification();
    // simulate the passage of time to allow the notification to be shown + button clicked
    await clock.tickAsync(100);

    sinon.assert.calledWith(
      showInfoMessageStub,
      "Your password has been reset. Please sign in again to Confluent Cloud.",
      CCLOUD_SIGN_IN_BUTTON_LABEL,
    );
    sinon.assert.calledOnce(createSessionStub);
  });

  for (const success of [true, false] as const) {
    it(`handleUri() should not invalidate the current CCloud auth session for non-reset-password URI callbacks (success=${success})`, async () => {
      const setAuthFlowCompletedStub = sandbox
        .stub(getResourceManager(), "setAuthFlowCompleted")
        .resolves();
      const deleteSecretStub = sandbox.stub(getStorageManager(), "deleteSecret").resolves();
      const showResetPasswordNotificationStub = sandbox.stub(
        authProvider,
        "showResetPasswordNotification",
      );

      const uri = vscode.Uri.parse(CCLOUD_AUTH_CALLBACK_URI).with({ query: `success=${success}` });
      await authProvider.handleUri(uri);

      sinon.assert.calledWith(setAuthFlowCompletedStub, { success, resetPassword: false });
      sinon.assert.notCalled(deleteConnectionStub);
      sinon.assert.notCalled(deleteSecretStub);
      sinon.assert.notCalled(showResetPasswordNotificationStub);
    });
  }

  it("handleUri() should invalidate the current CCloud auth session for reset-password URI callbacks", async () => {
    const setAuthFlowCompletedStub = sandbox
      .stub(getResourceManager(), "setAuthFlowCompleted")
      .resolves();
    const ccloudAuthSessionInvalidatedFireStub = sandbox.stub(ccloudAuthSessionInvalidated, "fire");
    const deleteSecretStub = sandbox.stub(getStorageManager(), "deleteSecret").resolves();
    const showResetPasswordNotificationStub = sandbox.stub(
      authProvider,
      "showResetPasswordNotification",
    );

    const uri = vscode.Uri.parse(CCLOUD_AUTH_CALLBACK_URI).with({
      query: "success=false&reset_password=true",
    });
    await authProvider.handleUri(uri);

    sinon.assert.calledWith(setAuthFlowCompletedStub, { success: false, resetPassword: true });
    sinon.assert.calledOnce(deleteConnectionStub);
    sinon.assert.calledWith(deleteSecretStub, SecretStorageKeys.CCLOUD_AUTH_STATUS);
    sinon.assert.calledOnce(ccloudAuthSessionInvalidatedFireStub);
    sinon.assert.calledOnce(showResetPasswordNotificationStub);
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
    await ccloud.deleteCCloudConnection();
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
    const newConnection: Connection = await ccloud.createCCloudConnection();
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
