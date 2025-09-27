import { chromium } from "@playwright/test";
import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import {
  getStubbedResourceManager,
  getStubbedSecretStorage,
  StubbedSecretStorage,
} from "../../tests/stubs/extensionStorage";
import { TEST_CCLOUD_AUTH_SESSION } from "../../tests/unit/testResources/ccloudAuth";
import {
  TEST_AUTHENTICATED_CCLOUD_CONNECTION,
  TEST_CCLOUD_CONNECTION,
} from "../../tests/unit/testResources/connection";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ConnectedState, Connection, ConnectionFromJSON } from "../clients/sidecar";
import { CCLOUD_AUTH_CALLBACK_URI, CCLOUD_BASE_PATH, CCLOUD_CONNECTION_ID } from "../constants";
import { ccloudAuthCallback, ccloudAuthSessionInvalidated, ccloudConnected } from "../emitters";
import * as errors from "../errors";
import * as notifications from "../notifications";
import { getSidecar } from "../sidecar";
import * as ccloud from "../sidecar/connections/ccloud";
import * as watcher from "../sidecar/connections/watcher";
import * as sidecarLogging from "../sidecar/logging";
import { SecretStorageKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import { clearWorkspaceState } from "../storage/utils";
import { ConfluentCloudAuthProvider, convertToAuthSession } from "./ccloudProvider";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "./constants";
import { CCloudSignInError } from "./errors";
import { AuthCallbackEvent } from "./types";

describe("authn/ccloudProvider.ts", () => {
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("ConfluentCloudAuthProvider", () => {
    let authProvider: ConfluentCloudAuthProvider;
    let stubbedResourceManager: sinon.SinonStubbedInstance<ResourceManager>;

    // used by createSession, getSessions, and deleteSession tests
    let getCCloudConnectionStub: sinon.SinonStub;

    let clearCurrentCCloudResourcesStub: sinon.SinonStub;
    let ccloudConnectedFireStub: sinon.SinonStub;

    beforeEach(() => {
      stubbedResourceManager = getStubbedResourceManager(sandbox);
      // tests need to define whether or not a connection exists
      getCCloudConnectionStub = sandbox.stub(ccloud, "getCCloudConnection").resolves(null);

      clearCurrentCCloudResourcesStub = sandbox
        .stub(ccloud, "clearCurrentCCloudResources")
        .resolves();

      authProvider = ConfluentCloudAuthProvider.getInstance();

      // ensure any firing of this event doesn't affect other parts of the codebase unrelated to the
      // auth provider tests
      ccloudConnectedFireStub = sandbox.stub(ccloudConnected, "fire").resolves();
    });

    afterEach(() => {
      authProvider.dispose();
      // reset the singleton instance between tests
      ConfluentCloudAuthProvider["instance"] = null;
    });

    describe("createSession()", () => {
      let createCCloudConnectionStub: sinon.SinonStub;
      let browserAuthFlowStub: sinon.SinonStub;
      let signInErrorStub: sinon.SinonStub;
      let deleteCCloudConnectionStub: sinon.SinonStub;
      let waitForConnectionToBeStableStub: sinon.SinonStub;
      let showErrorMessageStub: sinon.SinonStub;
      let showInfoNotificationWithButtonsStub: sinon.SinonStub;

      beforeEach(() => {
        createCCloudConnectionStub = sandbox.stub(ccloud, "createCCloudConnection").resolves();

        // don't handle the progress notification, openExternal, etc in this test suite
        browserAuthFlowStub = sandbox.stub(authProvider, "browserAuthFlow").resolves();
        signInErrorStub = sandbox.stub(authProvider, "signInError").resolves();
        deleteCCloudConnectionStub = sandbox.stub(ccloud, "deleteCCloudConnection").resolves();

        // assume the connection is immediately usable for most tests
        waitForConnectionToBeStableStub = sandbox
          .stub(watcher, "waitForConnectionToBeStable")
          .resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);

        showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage").resolves();
        showInfoNotificationWithButtonsStub = sandbox
          .stub(notifications, "showInfoNotificationWithButtons")
          .resolves();
      });

      it("should create a new CCloud connection when one doesn't exist", async () => {
        // first call doesn't return a Connection, second call returns the connection from createCCloudConnection()
        getCCloudConnectionStub.onFirstCall().resolves(null);
        createCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);
        getCCloudConnectionStub.onSecondCall().resolves(TEST_CCLOUD_CONNECTION);
        // authentication completes successfully
        browserAuthFlowStub.resolves({ success: true, resetPassword: false });

        await authProvider.createSession();

        sinon.assert.calledOnce(createCCloudConnectionStub);
        sinon.assert.calledOnce(browserAuthFlowStub);
      });

      it("should reuse an existing CCloud connection", async () => {
        getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);
        // authentication completes successfully
        browserAuthFlowStub.resolves({ success: true, resetPassword: false });

        await authProvider.createSession();

        sinon.assert.notCalled(createCCloudConnectionStub);
        sinon.assert.calledOnce(browserAuthFlowStub);
      });

      it("should update the connected state secret on successful authentication", async () => {
        getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);
        // authentication completes successfully
        browserAuthFlowStub.resolves({ success: true, resetPassword: false });

        await authProvider.createSession();

        sinon.assert.calledWith(
          stubbedResourceManager.setCCloudState,
          TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!.state,
        );
      });

      it("should throw a CCloudSignInError if no sign-in URI is available", async () => {
        getCCloudConnectionStub.resolves({
          ...TEST_CCLOUD_CONNECTION,
          metadata: { ...TEST_CCLOUD_CONNECTION.metadata, sign_in_uri: undefined },
        });
        const noSignInUriError = new CCloudSignInError(
          "Failed to create new connection. Please try again.",
        );
        signInErrorStub.resolves(noSignInUriError);

        await assert.rejects(authProvider.createSession(), noSignInUriError);

        sinon.assert.notCalled(createCCloudConnectionStub);
        sinon.assert.calledOnceWithExactly(signInErrorStub, noSignInUriError.message);
        sinon.assert.notCalled(browserAuthFlowStub);
      });

      it("should handle user cancellation", async () => {
        getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);
        // user cancels the operation
        browserAuthFlowStub.resolves(undefined);
        // not returned from signInError() for this scenario
        const cancellationError = new CCloudSignInError("User cancelled the authentication flow.");

        await assert.rejects(authProvider.createSession(), cancellationError);

        sinon.assert.notCalled(deleteCCloudConnectionStub);
        sinon.assert.notCalled(showInfoNotificationWithButtonsStub);
        sinon.assert.notCalled(showErrorMessageStub);
      });

      it("should handle password resets", async () => {
        getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);
        // password reset occurred
        browserAuthFlowStub.resolves({ success: false, resetPassword: true });
        // not returned from signInError() for this scenario
        const passwordResetError = new CCloudSignInError("User reset their password.");

        await assert.rejects(authProvider.createSession(), passwordResetError);

        sinon.assert.calledWith(
          showInfoNotificationWithButtonsStub,
          "Your password has been reset. Please sign in again to Confluent Cloud.",
          { [CCLOUD_SIGN_IN_BUTTON_LABEL]: sinon.match.func },
        );
      });

      it("should handle authentication failure (success=false)", async () => {
        getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);
        // authentication fails
        browserAuthFlowStub.resolves({ success: false, resetPassword: false });
        const authFailedMsg = "Confluent Cloud authentication failed. See browser for details.";
        // this does not throw, only returns the error to be thrown by createSession()
        const signInError = new CCloudSignInError(authFailedMsg);
        signInErrorStub.resolves(signInError);

        await assert.rejects(authProvider.createSession(), signInError);

        sinon.assert.calledWith(showErrorMessageStub, authFailedMsg);
        sinon.assert.calledOnceWithExactly(signInErrorStub, authFailedMsg);
      });

      it("should throw a CCloudSignInError if no connection is returned from waitForConnectionToBeStable()", async () => {
        getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);
        waitForConnectionToBeStableStub.resolves(null);
        // authentication completes successfully
        browserAuthFlowStub.resolves({ success: true, resetPassword: false });
        const noConnectionError = new CCloudSignInError(
          "CCloud connection failed to become usable after authentication.",
        );
        signInErrorStub.resolves(noConnectionError);

        await assert.rejects(authProvider.createSession(), noConnectionError);

        sinon.assert.notCalled(createCCloudConnectionStub);
        sinon.assert.calledOnceWithExactly(signInErrorStub, noConnectionError.message);
        sinon.assert.calledOnce(browserAuthFlowStub);
      });

      it("should throw a CCloudSignInError if no status.ccloud is available after authentication", async () => {
        const missingStatusConnection = ConnectionFromJSON({
          ...TEST_AUTHENTICATED_CCLOUD_CONNECTION,
          status: {
            ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status,
            ccloud: undefined,
          },
        } satisfies Connection);
        getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);
        waitForConnectionToBeStableStub.resolves(missingStatusConnection);
        // authentication completes successfully
        browserAuthFlowStub.resolves({ success: true, resetPassword: false });
        const noStatusError = new CCloudSignInError(
          "Authenticated connection has no status information.",
        );
        signInErrorStub.resolves(noStatusError);

        await assert.rejects(authProvider.createSession(), noStatusError);

        sinon.assert.notCalled(createCCloudConnectionStub);
        sinon.assert.calledOnceWithExactly(signInErrorStub, noStatusError.message);
        sinon.assert.calledOnce(browserAuthFlowStub);
      });

      it("should throw a CCloudSignInError when no UserInfo is available after authentication", async () => {
        const missingUserInfoConnection = ConnectionFromJSON({
          ...TEST_AUTHENTICATED_CCLOUD_CONNECTION,
          status: {
            ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status,
            ccloud: {
              ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!,
              user: undefined,
            },
          },
        } satisfies Connection);
        getCCloudConnectionStub.resolves(missingUserInfoConnection);
        waitForConnectionToBeStableStub.resolves(missingUserInfoConnection);
        // authentication completes successfully
        browserAuthFlowStub.resolves({ success: true, resetPassword: false });
        const noUserInfoError = new CCloudSignInError(
          "Authenticated connection has no CCloud user.",
        );
        signInErrorStub.resolves(noUserInfoError);

        await assert.rejects(authProvider.createSession(), noUserInfoError);

        sinon.assert.notCalled(createCCloudConnectionStub);
        sinon.assert.calledOnceWithExactly(signInErrorStub, noUserInfoError.message);
        sinon.assert.calledOnce(browserAuthFlowStub);
      });

      it("should show an info notification and fire ccloudConnected after successful sign-in", async () => {
        // plain info notification, not showInfoNotificationWithButtons
        const showInfoMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
        getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
        // authentication completes successfully
        browserAuthFlowStub.resolves({ success: true, resetPassword: false });

        await authProvider.createSession();

        sinon.assert.calledWith(
          showInfoMessageStub,
          `Successfully signed in to Confluent Cloud as ${TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud?.user?.username}`,
        );
        sinon.assert.calledOnce(ccloudConnectedFireStub);
      });
    });

    describe("getSessions()", () => {
      it(`should treat connections with a ${ConnectedState.None}/${ConnectedState.Failed} state as nonexistent`, async () => {
        getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);

        const sessions = await authProvider.getSessions();

        assert.deepStrictEqual(sessions, []);
      });

      it("should return an empty array when no connection exists", async () => {
        getCCloudConnectionStub.resolves(null);

        const sessions = await authProvider.getSessions();

        assert.deepStrictEqual(sessions, []);
      });

      it("should return an AuthenticationSession when a valid connection exists", async () => {
        getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);

        const sessions = await authProvider.getSessions();

        assert.strictEqual(sessions.length, 1);
        assert.deepStrictEqual(sessions[0], TEST_CCLOUD_AUTH_SESSION);
      });
    });

    describe("removeSession()", () => {
      let deleteCCloudConnectionStub: sinon.SinonStub;

      beforeEach(() => {
        deleteCCloudConnectionStub = sandbox.stub(ccloud, "deleteCCloudConnection").resolves();
      });

      it("should delete an existing connection and the connected state secret", async () => {
        const handleSessionRemovedStub = sandbox.stub().resolves();
        authProvider["handleSessionRemoved"] = handleSessionRemovedStub;
        getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
        const stubbedSecretStorage: StubbedSecretStorage = getStubbedSecretStorage(sandbox);

        await authProvider.removeSession("sessionId");

        sinon.assert.calledOnce(deleteCCloudConnectionStub);
        sinon.assert.calledOnceWithExactly(
          stubbedSecretStorage.delete,
          SecretStorageKeys.CCLOUD_STATE,
        );
        sinon.assert.calledOnceWithExactly(handleSessionRemovedStub, true);
      });

      it("should only update the provider's internal state when no connection exists", async () => {
        const handleSessionRemovedStub = sandbox.stub().resolves();
        authProvider["handleSessionRemoved"] = handleSessionRemovedStub;
        getCCloudConnectionStub.resolves(null);

        authProvider["_session"] = null;
        await authProvider.removeSession("sessionId");

        sinon.assert.notCalled(deleteCCloudConnectionStub);
        sinon.assert.notCalled(handleSessionRemovedStub);
      });

      it("should only update the provider's internal state when no connection exists but the provider is still tracking a session internally", async () => {
        const handleSessionRemovedStub = sandbox.stub().resolves();
        authProvider["handleSessionRemoved"] = handleSessionRemovedStub;
        getCCloudConnectionStub.resolves(null);

        authProvider["_session"] = TEST_CCLOUD_AUTH_SESSION;
        await authProvider.removeSession("sessionId");

        sinon.assert.notCalled(deleteCCloudConnectionStub);
        sinon.assert.calledOnceWithExactly(handleSessionRemovedStub, true);
      });
    });

    describe("handleSessionCreated()", () => {
      let stubOnDidChangeSessions: sinon.SinonStubbedInstance<
        vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>
      >;

      beforeEach(() => {
        stubOnDidChangeSessions = sandbox.createStubInstance(vscode.EventEmitter);
        authProvider["_onDidChangeSessions"] = stubOnDidChangeSessions;
      });

      it("should update the provider's internal state, fire the _onDidChangeSessions event.", async () => {
        const stubbedSecretStorage: StubbedSecretStorage = getStubbedSecretStorage(sandbox);

        await authProvider["handleSessionCreated"](TEST_CCLOUD_AUTH_SESSION, true);

        assert.strictEqual(authProvider["_session"], TEST_CCLOUD_AUTH_SESSION);
        sinon.assert.calledWith(
          stubbedSecretStorage.store,
          SecretStorageKeys.AUTH_SESSION_EXISTS,
          "true",
        );
        sinon.assert.called(stubOnDidChangeSessions.fire);
        sinon.assert.calledWith(stubOnDidChangeSessions.fire, {
          added: [TEST_CCLOUD_AUTH_SESSION],
          removed: [],
          changed: [],
        });
      });
    });

    describe("handleSessionRemoved()", () => {
      let stubOnDidChangeSessions: sinon.SinonStubbedInstance<
        vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>
      >;

      beforeEach(() => {
        stubOnDidChangeSessions = sandbox.createStubInstance(vscode.EventEmitter);
        authProvider["_onDidChangeSessions"] = stubOnDidChangeSessions;
      });

      it("should update the provider's internal state, fire the _onDidChangeSessions event.", async () => {
        const stubbedSecretStorage: StubbedSecretStorage = getStubbedSecretStorage(sandbox);

        authProvider["_session"] = TEST_CCLOUD_AUTH_SESSION;
        await authProvider["handleSessionRemoved"](true);

        assert.strictEqual(authProvider["_session"], null);
        sinon.assert.calledOnce(clearCurrentCCloudResourcesStub);
        sinon.assert.calledWith(stubbedSecretStorage.delete, SecretStorageKeys.AUTH_SESSION_EXISTS);
        sinon.assert.calledWith(stubbedSecretStorage.delete, SecretStorageKeys.AUTH_COMPLETED);
        sinon.assert.calledWith(stubbedSecretStorage.delete, SecretStorageKeys.AUTH_PASSWORD_RESET);
        sinon.assert.called(stubOnDidChangeSessions.fire);
        sinon.assert.calledWith(stubOnDidChangeSessions.fire, {
          added: [],
          removed: [TEST_CCLOUD_AUTH_SESSION],
          changed: [],
        });
      });
    });

    describe("handleSessionSecretChange()", () => {
      let handleSessionCreatedStub: sinon.SinonStub;
      let handleSessionRemovedStub: sinon.SinonStub;

      beforeEach(() => {
        handleSessionCreatedStub = sandbox.stub().resolves();
        authProvider["handleSessionCreated"] = handleSessionCreatedStub;
        handleSessionRemovedStub = sandbox.stub().resolves();
        authProvider["handleSessionRemoved"] = handleSessionRemovedStub;
      });

      it("should call handleSessionCreated() when a session is available", async () => {
        sandbox.stub(vscode.authentication, "getSession").resolves(TEST_CCLOUD_AUTH_SESSION);

        await authProvider["handleSessionSecretChange"]();

        sinon.assert.calledOnceWithExactly(handleSessionCreatedStub, TEST_CCLOUD_AUTH_SESSION);
        sinon.assert.notCalled(handleSessionRemovedStub);
      });

      it("should call handleSessionRemoved() when no session is available", async () => {
        sandbox.stub(vscode.authentication, "getSession").resolves(undefined);

        authProvider["_session"] = TEST_CCLOUD_AUTH_SESSION;
        await authProvider["handleSessionSecretChange"]();

        sinon.assert.notCalled(handleSessionCreatedStub);
        sinon.assert.calledOnce(handleSessionRemovedStub);
      });
    });

    describe("waitForUriHandling()", () => {
      for (const success of [true, false] as const) {
        it(`should return '${success}' when the URI query contains 'success=${success}'`, async () => {
          const promise: Promise<AuthCallbackEvent> = authProvider.waitForUriHandling();
          const uri = vscode.Uri.parse(CCLOUD_AUTH_CALLBACK_URI).with({
            query: `success=${success}`,
          });
          ccloudAuthCallback.fire(uri);
          authProvider["_onAuthFlowCompletedSuccessfully"].fire({ success, resetPassword: false });
          const result: AuthCallbackEvent = await promise;

          assert.strictEqual(result.success, success);
        });
      }
    });

    describe("handleCCloudAuthCallback()", () => {
      let deleteCCloudConnectionStub: sinon.SinonStub;
      let showInfoNotificationWithButtonsStub: sinon.SinonStub;
      let ccloudAuthSessionInvalidatedFireStub: sinon.SinonStub;

      beforeEach(() => {
        deleteCCloudConnectionStub = sandbox.stub(ccloud, "deleteCCloudConnection").resolves();
        showInfoNotificationWithButtonsStub = sandbox
          .stub(notifications, "showInfoNotificationWithButtons")
          .resolves();
        ccloudAuthSessionInvalidatedFireStub = sandbox.stub(ccloudAuthSessionInvalidated, "fire");
      });

      for (const success of [true, false] as const) {
        it(`should not invalidate the current CCloud auth session for non-reset-password URI callbacks (success=${success})`, async () => {
          const stubbedSecretStorage: StubbedSecretStorage = getStubbedSecretStorage(sandbox);

          const uri = vscode.Uri.parse(CCLOUD_AUTH_CALLBACK_URI).with({
            query: `success=${success}`,
          });
          await authProvider.handleCCloudAuthCallback(uri);

          sinon.assert.calledWith(stubbedResourceManager.setAuthFlowCompleted, {
            success,
            resetPassword: false,
          });
          sinon.assert.notCalled(deleteCCloudConnectionStub);
          sinon.assert.notCalled(stubbedSecretStorage.delete);
          sinon.assert.notCalled(showInfoNotificationWithButtonsStub);
          sinon.assert.notCalled(ccloudAuthSessionInvalidatedFireStub);
        });
      }

      it("should invalidate the current CCloud auth session for reset-password URI callbacks", async () => {
        const stubbedSecretStorage: StubbedSecretStorage = getStubbedSecretStorage(sandbox);

        const uri = vscode.Uri.parse(CCLOUD_AUTH_CALLBACK_URI).with({
          query: "success=false&reset_password=true",
        });
        await authProvider.handleCCloudAuthCallback(uri);

        sinon.assert.calledWith(stubbedResourceManager.setAuthFlowCompleted, {
          success: false,
          resetPassword: true,
        });
        sinon.assert.calledOnce(deleteCCloudConnectionStub);
        sinon.assert.calledWith(stubbedSecretStorage.delete, SecretStorageKeys.CCLOUD_STATE);
        sinon.assert.calledOnce(ccloudAuthSessionInvalidatedFireStub);
        sinon.assert.calledOnceWithExactly(
          showInfoNotificationWithButtonsStub,
          "Your password has been reset. Please sign in again to Confluent Cloud.",
          { [CCLOUD_SIGN_IN_BUTTON_LABEL]: sinon.match.func },
        );
      });
    });

    describe("signInError()", () => {
      let getLastSidecarLogLinesStub: sinon.SinonStub;
      let logErrorStub: sinon.SinonStub;

      const fakeErrorMsg = "uh oh, something went wrong";

      beforeEach(() => {
        getLastSidecarLogLinesStub = sandbox
          .stub(sidecarLogging, "getLastSidecarLogLines")
          .resolves([]);
        logErrorStub = sandbox.stub(errors, "logError").resolves();
      });

      it("should return a CCloudSignInError", async () => {
        const signInError: CCloudSignInError = await authProvider.signInError(fakeErrorMsg);

        assert.ok(signInError instanceof CCloudSignInError);
        assert.strictEqual(signInError.message, fakeErrorMsg);
      });

      it("should call logError() with the provided message and recent sidecar logs", async () => {
        const sidecarLogs = ["log line 1", "log line 2"];
        getLastSidecarLogLinesStub.resolves(sidecarLogs);

        await authProvider.signInError(fakeErrorMsg);

        sinon.assert.calledOnce(getLastSidecarLogLinesStub);
        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledOnceWithExactly(
          logErrorStub,
          sinon.match(
            (error: Error) => error.name === "CCloudSignInError" && error.message === fakeErrorMsg,
          ),
          fakeErrorMsg,
          { extra: { sidecarLogs } },
        );
      });
    });
  });

  describe("convertToAuthSession()", () => {
    it("should throw if the Connection is missing .user", () => {
      // has status.ccloud, but no status.ccloud.user
      const connection = TEST_CCLOUD_CONNECTION;

      assert.throws(
        () => convertToAuthSession(connection),
        Error("Connection has no CCloud user."),
      );
    });

    for (const missingField of ["id", "username"]) {
      it(`should throw if the Connection's UserInfo is missing '${missingField}'`, () => {
        const connection = ConnectionFromJSON({
          ...TEST_AUTHENTICATED_CCLOUD_CONNECTION,
          status: {
            ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status,
            ccloud: {
              ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!,
              user: {
                ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!.user!,
                [missingField]: undefined,
              },
            },
          },
        } satisfies Connection);

        assert.throws(
          () => convertToAuthSession(connection),
          Error("Connection has CCloud user with no id or username."),
        );
      });
    }

    it("should convert a Connection to an AuthenticationSession", () => {
      // has valid status.ccloud.user data
      const connection = TEST_AUTHENTICATED_CCLOUD_CONNECTION;

      const session: vscode.AuthenticationSession = convertToAuthSession(connection);

      assert.deepStrictEqual(session, TEST_CCLOUD_AUTH_SESSION);
    });
  });
});

describe("CCloud auth flow", () => {
  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(async () => {
    await clearWorkspaceState();
    // make sure we don't have a lingering CCloud connection from other tests
    await ccloud.deleteCCloudConnection();
  });

  afterEach(async () => {
    // force sign-out so we don't have a lingering CCloud connection for other tests
    await ccloud.deleteCCloudConnection();
  });

  it(`should successfully authenticate via CCloud with the sign_in_uri (${CCLOUD_BASE_PATH})`, async function () {
    const testUsername = getTestUserName();
    const testPassword = getTestPassword();
    if (!(testUsername && testPassword)) {
      // These env vars needed within testAuthFlow() for any of this to work.
      console.log("Skipping test: E2E_USERNAME* and/or E2E_PASSWORD* not set in .env file");
      this.skip();
    }

    // NOTE: can't be used with an arrow-function because it needs to be able to access `this`
    this.slow(10000); // mark this test as slow if it takes longer than 10s
    this.retries(2); // retry this test up to 2 times if it fails

    const newConnection: Connection = await ccloud.createCCloudConnection();
    await testAuthFlow(newConnection.metadata.sign_in_uri!, testUsername!, testPassword!);

    // make sure the newly-created connection is available via the sidecar
    const client = (await getSidecar()).getConnectionsResourceApi();
    const connection = await client.gatewayV1ConnectionsIdGet({ id: CCLOUD_CONNECTION_ID });
    assert.ok(
      connection,
      "No connections found; make sure to manually log in with the test username/password, because the 'Authorize App: Confluent VS Code Extension is requesting access to your Confluent account' (https://login.confluent.io/u/consent?...) page may be blocking the auth flow for this test. If that doesn't work, try running the test with `{ headless: false }` (in testAuthFlow()) to see what's happening.",
    );
    assert.ok(connection);
    assert.notEqual(connection.status.ccloud?.state, ConnectedState.None);
    assert.equal(connection.status.ccloud?.user?.username, testUsername);
  });
});

function getTestUserName(): string | undefined {
  return process.env.E2E_USERNAME || process.env.E2E_USERNAME_STAG;
}

function getTestPassword(): string | undefined {
  return process.env.E2E_PASSWORD || process.env.E2E_PASSWORD_STAG;
}

async function testAuthFlow(signInUri: string, testUsername: string, testPassword: string) {
  const browser = await chromium.launch(); // set { headless: false } here for local debugging
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(signInUri);

  await page.locator("[name=email]").fill(testUsername);
  await page.locator("[type=submit]").click();
  await page.locator("[name=password]").fill(testPassword);
  await page.locator("[type=submit]").click();
  await page.waitForURL(/127\.0\.0\.1/, { waitUntil: "networkidle" });
  await page.close();
}
