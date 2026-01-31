import { chromium } from "@playwright/test";
import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { StubbedSecretStorage } from "../../tests/stubs/extensionStorage";
import {
  getStubbedResourceManager,
  getStubbedSecretStorage,
} from "../../tests/stubs/extensionStorage";
import { TEST_CCLOUD_AUTH_SESSION } from "../../tests/unit/testResources/ccloudAuth";
import {
  TEST_AUTHENTICATED_CCLOUD_CONNECTION,
  TEST_CCLOUD_CONNECTION,
} from "../../tests/unit/testResources/connection";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import type { Connection } from "../connections";
import { ConnectedState, ConnectionFromJSON } from "../connections";
import { CCLOUD_AUTH_CALLBACK_URI, CCLOUD_BASE_PATH } from "../constants";
import { ccloudAuthSessionInvalidated, ccloudConnected } from "../emitters";
import * as errors from "../errors";
import * as notifications from "../notifications";
import { SecretStorageKeys } from "../storage/constants";
import type { CCloudSessionInfo, ResourceManager } from "../storage/resourceManager";
import { clearWorkspaceState } from "../storage/utils";
import { ConfluentCloudAuthProvider } from "./ccloudProvider";
import * as ccloud from "./ccloudSession";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "./constants";
import { CCloudConnectionError } from "./errors";
import type { AuthCallbackEvent } from "./types";

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

    // used by createSession, getSessions, and/or deleteSession tests
    let getCCloudConnectionStub: sinon.SinonStub;
    let createAndLogConnectionErrorStub: sinon.SinonStub;
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
      createAndLogConnectionErrorStub = sandbox
        .stub(authProvider, "createAndLogConnectionError")
        .resolves();

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
      let deleteCCloudConnectionStub: sinon.SinonStub;
      let waitForConnectionToBeStableStub: sinon.SinonStub;
      let showErrorMessageStub: sinon.SinonStub;
      let showInfoNotificationWithButtonsStub: sinon.SinonStub;

      beforeEach(() => {
        createCCloudConnectionStub = sandbox.stub(ccloud, "createCCloudConnection").resolves();

        // don't handle the progress notification, openExternal, etc in this test suite
        browserAuthFlowStub = sandbox.stub(authProvider, "browserAuthFlow").resolves();
        deleteCCloudConnectionStub = sandbox.stub(ccloud, "deleteCCloudConnection").resolves();

        // assume the connection is immediately usable for most tests
        waitForConnectionToBeStableStub = sandbox
          .stub(ccloud, "waitForConnectionToBeStable")
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

      it("should store session info on successful authentication", async () => {
        getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);
        // authentication completes successfully
        browserAuthFlowStub.resolves({ success: true, resetPassword: false });

        await authProvider.createSession();

        sinon.assert.calledWith(stubbedResourceManager.setCCloudSession, {
          userId: TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!.user!.id,
          username: TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!.user!.username,
        });
      });

      it("should throw a CCloudConnectionError if no sign-in URI is available", async () => {
        const missingSignInUriConnection = ConnectionFromJSON({
          ...TEST_CCLOUD_CONNECTION,
          metadata: { ...TEST_CCLOUD_CONNECTION.metadata, signInUri: undefined },
        } satisfies Connection);
        getCCloudConnectionStub.resolves(missingSignInUriConnection);
        const noSignInUriError = new CCloudConnectionError(
          "Failed to create new connection. Please try again.",
        );
        createAndLogConnectionErrorStub.resolves(noSignInUriError);

        await assert.rejects(authProvider.createSession(), noSignInUriError);

        sinon.assert.notCalled(createCCloudConnectionStub);
        sinon.assert.calledOnceWithExactly(
          createAndLogConnectionErrorStub,
          noSignInUriError.message,
          missingSignInUriConnection,
        );
        sinon.assert.notCalled(browserAuthFlowStub);
      });

      it("should handle user cancellation", async () => {
        getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);
        // user cancels the operation
        browserAuthFlowStub.resolves(undefined);
        // not returned from signInError() for this scenario
        const cancellationError = new CCloudConnectionError(
          "User cancelled the authentication flow.",
        );

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
        const passwordResetError = new CCloudConnectionError("User reset their password.");

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
        const signInError = new CCloudConnectionError(authFailedMsg);
        createAndLogConnectionErrorStub.resolves(signInError);

        await assert.rejects(authProvider.createSession(), signInError);

        sinon.assert.calledWith(showErrorMessageStub, authFailedMsg);
        sinon.assert.calledOnceWithExactly(createAndLogConnectionErrorStub, authFailedMsg);
      });

      it("should throw a CCloudConnectionError if no connection is returned from waitForConnectionToBeStable()", async () => {
        getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);
        waitForConnectionToBeStableStub.resolves(null);
        // authentication completes successfully
        browserAuthFlowStub.resolves({ success: true, resetPassword: false });
        const noConnectionError = new CCloudConnectionError(
          "CCloud connection failed to become usable after authentication.",
        );
        createAndLogConnectionErrorStub.resolves(noConnectionError);

        await assert.rejects(authProvider.createSession(), noConnectionError);

        sinon.assert.notCalled(createCCloudConnectionStub);
        sinon.assert.calledOnceWithExactly(
          createAndLogConnectionErrorStub,
          noConnectionError.message,
        );
        sinon.assert.calledOnce(browserAuthFlowStub);
      });

      it("should throw a CCloudConnectionError if no status.ccloud is available after authentication", async () => {
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
        const noStatusError = new CCloudConnectionError(
          "Authenticated connection has no status information.",
        );
        createAndLogConnectionErrorStub.resolves(noStatusError);

        await assert.rejects(authProvider.createSession(), noStatusError);

        sinon.assert.notCalled(createCCloudConnectionStub);
        sinon.assert.calledOnceWithExactly(
          createAndLogConnectionErrorStub,
          noStatusError.message,
          missingStatusConnection,
        );
        sinon.assert.calledOnce(browserAuthFlowStub);
      });

      it("should throw a CCloudConnectionError when no UserInfo is available after authentication", async () => {
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
        const noUserInfoError = new CCloudConnectionError(
          "Authenticated connection has no CCloud user.",
        );
        createAndLogConnectionErrorStub.resolves(noUserInfoError);

        await assert.rejects(authProvider.createSession(), noUserInfoError);

        sinon.assert.notCalled(createCCloudConnectionStub);
        sinon.assert.calledOnceWithExactly(
          createAndLogConnectionErrorStub,
          noUserInfoError.message,
          missingUserInfoConnection,
        );
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
      it(`should treat connections with a ${ConnectedState.NONE}/${ConnectedState.FAILED} state as nonexistent`, async () => {
        getCCloudConnectionStub.resolves(TEST_CCLOUD_CONNECTION);
        stubbedResourceManager.getCCloudSession.resolves(null);

        const sessions = await authProvider.getSessions();

        assert.deepStrictEqual(sessions, []);
      });

      it("should return an empty array when no connection exists", async () => {
        getCCloudConnectionStub.resolves(null);
        stubbedResourceManager.getCCloudSession.resolves(null);

        const sessions = await authProvider.getSessions();

        assert.deepStrictEqual(sessions, []);
      });

      it("should return an AuthenticationSession when a valid connection exists", async () => {
        getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
        stubbedResourceManager.getCCloudSession.resolves({
          userId: TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!.user!.id,
          username: TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!.user!.username,
        });

        const sessions = await authProvider.getSessions();

        assert.strictEqual(sessions.length, 1);
        assert.deepStrictEqual(sessions[0], TEST_CCLOUD_AUTH_SESSION);
      });

      it("should clear stale stored session when no connection exists", async () => {
        getCCloudConnectionStub.resolves(null);
        stubbedResourceManager.getCCloudSession.resolves({
          userId: "some-user-id",
          username: "some-username",
        });

        const sessions = await authProvider.getSessions();

        assert.deepStrictEqual(sessions, []);
        sinon.assert.calledOnceWithExactly(stubbedResourceManager.setCCloudSession, null);
        sinon.assert.calledOnce(clearCurrentCCloudResourcesStub);
      });

      it("should update stored session when connection differs from stored", async () => {
        getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
        stubbedResourceManager.getCCloudSession.resolves({
          userId: "different-user-id",
          username: "different-username",
        });

        await authProvider.getSessions();

        sinon.assert.calledWith(stubbedResourceManager.setCCloudSession, {
          userId: TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!.user!.id,
          username: TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!.user!.username,
        });
      });

      it("should handle missing 'user' info when connection exists", async () => {
        const badConnection = ConnectionFromJSON({
          ...TEST_AUTHENTICATED_CCLOUD_CONNECTION,
          status: {
            ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status,
            ccloud: {
              ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!,
              user: undefined,
            },
          },
        } satisfies Connection);
        getCCloudConnectionStub.resolves(badConnection);
        stubbedResourceManager.getCCloudSession.resolves(null);

        const sessions = await authProvider.getSessions();

        assert.deepStrictEqual(sessions, []);
        sinon.assert.calledOnce(createAndLogConnectionErrorStub);
      });

      it("should handle missing user ID/username when connection exists", async () => {
        const badConnection = ConnectionFromJSON({
          ...TEST_AUTHENTICATED_CCLOUD_CONNECTION,
          status: {
            ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status,
            ccloud: {
              ...TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!,
              user: {
                id: "",
                username: "",
              },
            },
          },
        } satisfies Connection);
        getCCloudConnectionStub.resolves(badConnection);
        stubbedResourceManager.getCCloudSession.resolves(null);

        const sessions = await authProvider.getSessions();

        assert.deepStrictEqual(sessions, []);
        sinon.assert.calledOnce(createAndLogConnectionErrorStub);
      });
    });

    describe("removeSession()", () => {
      let deleteCCloudConnectionStub: sinon.SinonStub;

      beforeEach(() => {
        deleteCCloudConnectionStub = sandbox.stub(ccloud, "deleteCCloudConnection").resolves();
      });

      it("should delete an existing connection and the connected state secret", async () => {
        getCCloudConnectionStub.resolves(TEST_AUTHENTICATED_CCLOUD_CONNECTION);
        const storedSession: CCloudSessionInfo = {
          userId: TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!.user!.id,
          username: TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!.user!.username,
        };
        stubbedResourceManager.getCCloudSession.resolves(storedSession);
        const stubbedSecretStorage: StubbedSecretStorage = getStubbedSecretStorage(sandbox);

        await authProvider.removeSession("sessionId");

        sinon.assert.calledOnce(deleteCCloudConnectionStub);
        sinon.assert.calledOnceWithExactly(
          stubbedSecretStorage.delete,
          SecretStorageKeys.CCLOUD_STATE,
        );
        sinon.assert.calledOnceWithExactly(stubbedResourceManager.setCCloudSession, null);
      });

      it("should only clear stored session when no connection exists but stored session exists", async () => {
        getCCloudConnectionStub.resolves(null);
        const storedSession: CCloudSessionInfo = {
          userId: "some-user-id",
          username: "some-username",
        };
        stubbedResourceManager.getCCloudSession.resolves(storedSession);

        await authProvider.removeSession("sessionId");

        sinon.assert.notCalled(deleteCCloudConnectionStub);
        sinon.assert.calledOnceWithExactly(stubbedResourceManager.setCCloudSession, null);
      });

      it("should do nothing when no connection and no stored session exists", async () => {
        getCCloudConnectionStub.resolves(null);
        stubbedResourceManager.getCCloudSession.resolves(null);

        await authProvider.removeSession("sessionId");

        sinon.assert.notCalled(deleteCCloudConnectionStub);
        sinon.assert.notCalled(stubbedResourceManager.setCCloudSession);
      });
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

          sinon.assert.notCalled(deleteCCloudConnectionStub);
          sinon.assert.notCalled(stubbedSecretStorage.delete);
          sinon.assert.notCalled(showInfoNotificationWithButtonsStub);
          sinon.assert.notCalled(ccloudAuthSessionInvalidatedFireStub);
        });
      }

      it("should invalidate the current CCloud auth session for reset-password URI callbacks", async () => {
        const stubbedSecretStorage: StubbedSecretStorage = getStubbedSecretStorage(sandbox);
        stubbedResourceManager.getCCloudSession.resolves({
          userId: "some-user-id",
          username: "some-username",
        });

        const uri = vscode.Uri.parse(CCLOUD_AUTH_CALLBACK_URI).with({
          query: "success=false&reset_password=true",
        });
        await authProvider.handleCCloudAuthCallback(uri);

        sinon.assert.calledOnce(deleteCCloudConnectionStub);
        sinon.assert.calledWith(stubbedSecretStorage.delete, SecretStorageKeys.CCLOUD_STATE);
        sinon.assert.calledOnce(ccloudAuthSessionInvalidatedFireStub);
        sinon.assert.calledOnceWithExactly(
          showInfoNotificationWithButtonsStub,
          "Your password has been reset. Please sign in again to Confluent Cloud.",
          { [CCLOUD_SIGN_IN_BUTTON_LABEL]: sinon.match.func },
        );
      });

      it("should notify pending auth flow callback when URI is handled", async () => {
        // Set up a pending callback
        let callbackResult: AuthCallbackEvent | null = null;
        authProvider["_pendingAuthFlowCallback"] = (event) => {
          callbackResult = event;
        };

        const uri = vscode.Uri.parse(CCLOUD_AUTH_CALLBACK_URI).with({
          query: "success=true",
        });
        await authProvider.handleCCloudAuthCallback(uri);

        assert.deepStrictEqual(callbackResult, { success: true, resetPassword: false });
      });
    });

    describe("createAndLogConnectionError()", () => {
      let logErrorStub: sinon.SinonStub;

      const fakeErrorMsg = "uh oh, something went wrong";

      beforeEach(() => {
        // revert to the original method for these tests
        createAndLogConnectionErrorStub.restore();
        logErrorStub = sandbox.stub(errors, "logError").resolves();
      });

      it("should return a CCloudConnectionError", () => {
        const signInError: CCloudConnectionError =
          authProvider.createAndLogConnectionError(fakeErrorMsg);

        assert.ok(signInError instanceof CCloudConnectionError);
        assert.strictEqual(signInError.message, fakeErrorMsg);
      });

      it("should call logError() with the provided message and connection context", () => {
        authProvider.createAndLogConnectionError(fakeErrorMsg);

        sinon.assert.calledOnce(logErrorStub);
        sinon.assert.calledOnceWithExactly(
          logErrorStub,
          sinon.match(
            (error: Error) =>
              error.name === "CCloudConnectionError" && error.message === fakeErrorMsg,
          ),
          fakeErrorMsg,
          { extra: { connection: undefined } },
        );
      });
    });

    describe("createAuthSession()", () => {
      it("should create an AuthenticationSession from user info", () => {
        const userInfo = {
          id: TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!.user!.id,
          username: TEST_AUTHENTICATED_CCLOUD_CONNECTION.status.ccloud!.user!.username,
        };

        const session: vscode.AuthenticationSession = authProvider.createAuthSession(userInfo);

        assert.deepStrictEqual(session, TEST_CCLOUD_AUTH_SESSION);
      });
    });

    describe("handlePendingAuthChange()", () => {
      let stubbedSecretStorage: StubbedSecretStorage;

      beforeEach(() => {
        stubbedSecretStorage = getStubbedSecretStorage(sandbox);
      });

      it("should resolve pending callback when pending flow is cleared (auth completed in another window)", async () => {
        // Simulate having a pending callback from this window
        let callbackResult: { success: boolean; resetPassword: boolean } | null = null;
        authProvider["_pendingAuthFlowCallback"] = (event) => {
          callbackResult = event;
        };

        // Simulate the pending flow being cleared (auth completed in another window)
        stubbedSecretStorage.get.resolves(undefined);

        await authProvider["handlePendingAuthChange"]();

        // Callback should have been resolved with success
        assert.deepStrictEqual(callbackResult, { success: true, resetPassword: false });
      });

      it("should not resolve callback when there is no pending callback", async () => {
        // No pending callback
        authProvider["_pendingAuthFlowCallback"] = null;

        // Simulate the pending flow being cleared
        stubbedSecretStorage.get.resolves(undefined);

        // Should not throw, just complete silently
        await authProvider["handlePendingAuthChange"]();
      });

      it("should ignore invalid JSON in pending flow storage", async () => {
        // No existing pending callback
        authProvider["_pendingAuthFlowCallback"] = null;

        // Simulate invalid JSON
        stubbedSecretStorage.get.resolves("invalid json{");

        // Should not throw, just complete silently
        await authProvider["handlePendingAuthChange"]();
      });
    });

    describe("browserAuthFlow() cross-window coordination", () => {
      let stubbedSecretStorage: StubbedSecretStorage;

      beforeEach(() => {
        stubbedSecretStorage = getStubbedSecretStorage(sandbox);
      });

      it("should clear stale pending flow before starting", async () => {
        // Mock a stale pending flow (older than 5 minutes)
        const stalePendingFlow = JSON.stringify({
          startedAt: Date.now() - 6 * 60 * 1000, // 6 minutes ago
          signInUri: "https://old.example.com",
        });
        stubbedSecretStorage.get.resolves(stalePendingFlow);

        // Stub openExternal to prevent actual browser open
        sandbox.stub(vscode.env, "openExternal").resolves(true);

        // Create a pending auth flow that immediately resolves
        const promise = authProvider.browserAuthFlow("https://test.example.com");

        // Simulate immediate cancellation
        setTimeout(() => {
          authProvider["_pendingAuthFlowCallback"]?.({ success: true, resetPassword: false });
        }, 10);

        await promise;

        // Should have deleted the stale pending flow
        sinon.assert.calledWith(stubbedSecretStorage.delete, SecretStorageKeys.CCLOUD_AUTH_PENDING);
      });

      it("should store pending flow in SecretStorage when starting auth", async () => {
        stubbedSecretStorage.get.resolves(undefined);

        // Stub openExternal to prevent actual browser open
        sandbox.stub(vscode.env, "openExternal").resolves(true);

        const testUri = "https://test.confluent.cloud/signin";
        const promise = authProvider.browserAuthFlow(testUri);

        // Immediately resolve to finish the test
        setTimeout(() => {
          authProvider["_pendingAuthFlowCallback"]?.({ success: true, resetPassword: false });
        }, 10);

        await promise;

        // Should have stored the pending flow with the signInUri
        sinon.assert.calledWith(
          stubbedSecretStorage.store,
          SecretStorageKeys.CCLOUD_AUTH_PENDING,
          sinon.match((value: string) => {
            const parsed = JSON.parse(value);
            return parsed.signInUri === testUri && typeof parsed.startedAt === "number";
          }),
        );
      });

      it("should clear pending flow after auth completes", async () => {
        stubbedSecretStorage.get.resolves(undefined);

        // Stub openExternal to prevent actual browser open
        sandbox.stub(vscode.env, "openExternal").resolves(true);

        const promise = authProvider.browserAuthFlow("https://test.example.com");

        // Simulate successful auth completion
        setTimeout(() => {
          authProvider["_pendingAuthFlowCallback"]?.({ success: true, resetPassword: false });
        }, 10);

        await promise;

        // Should have deleted the pending flow marker
        sinon.assert.calledWith(stubbedSecretStorage.delete, SecretStorageKeys.CCLOUD_AUTH_PENDING);
      });
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
    await testAuthFlow(newConnection.metadata.signInUri!, testUsername!, testPassword!);

    // make sure the newly-created connection is available
    const connection = await ccloud.getCCloudConnection();
    assert.ok(
      connection,
      "No connections found; make sure to manually log in with the test username/password, because the 'Authorize App: Confluent VS Code Extension is requesting access to your Confluent account' (https://login.confluent.io/u/consent?...) page may be blocking the auth flow for this test. If that doesn't work, try running the test with `{ headless: false }` (in testAuthFlow()) to see what's happening.",
    );
    assert.ok(connection);
    assert.notEqual(connection.status.ccloud?.state, ConnectedState.NONE);
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
