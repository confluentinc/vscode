import * as assert from "assert";
import * as sinon from "sinon";
import { TEST_CCLOUD_AUTH_SESSION } from "../../tests/unit/testResources/ccloudAuth";
import { TEST_CCLOUD_CONNECTION } from "../../tests/unit/testResources/connection";
import { Authentication, AuthErrors, ConnectedState, Connection, Status } from "../clients/sidecar";
import { observabilityContext } from "../context/observability";
import { ccloudAuthSessionInvalidated, nonInvalidTokenStatus } from "../emitters";
import * as notifications from "../notifications";
import { SecretStorageKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import { handleUpdatedConnection, REAUTH_BUTTON_TEXT } from "./ccloudStateHandling";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "./constants";
import * as utils from "./utils";

describe("authn/ccloudStateHandling.ts handleUpdatedConnection()", () => {
  let sandbox: sinon.SinonSandbox;
  let stubbedResourceManager: sinon.SinonStubbedInstance<ResourceManager>;
  let nonInvalidTokenStatusFireStub: sinon.SinonStub;
  let ccloudAuthSessionInvalidatedFireStub: sinon.SinonStub;
  let showErrorNotificationWithButtonsStub: sinon.SinonStub;
  let showInfoNotificationWithButtonsStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // stub resource manager
    stubbedResourceManager = sandbox.createStubInstance(ResourceManager);
    // simulate no connected state by default
    stubbedResourceManager.getCCloudAuthStatus.resolves(Status.NoToken);
    observabilityContext.ccloudAuthLastSeenStatus = Status.NoToken;
    sandbox.stub(ResourceManager, "getInstance").returns(stubbedResourceManager);

    // stub emitters
    nonInvalidTokenStatusFireStub = sandbox.stub(nonInvalidTokenStatus, "fire");
    ccloudAuthSessionInvalidatedFireStub = sandbox.stub(ccloudAuthSessionInvalidated, "fire");

    // helper stubs
    showErrorNotificationWithButtonsStub = sandbox
      .stub(notifications, "showErrorNotificationWithButtons")
      .resolves();
    showInfoNotificationWithButtonsStub = sandbox
      .stub(notifications, "showInfoNotificationWithButtons")
      .resolves();
    // assume we have a valid CCloud auth session from VS Code's perspective for these tests
    sandbox.stub(utils, "getCCloudAuthSession").resolves(TEST_CCLOUD_AUTH_SESSION);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return early when no CCloud status is found in connection", async () => {
    const connectionWithoutCCloudStatus: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        // no `ccloud` status
        authentication: undefined as unknown as Authentication,
      },
    };

    await handleUpdatedConnection(connectionWithoutCCloudStatus);

    sinon.assert.notCalled(stubbedResourceManager.setCCloudAuthStatus);
    sinon.assert.notCalled(nonInvalidTokenStatusFireStub);
    sinon.assert.notCalled(ccloudAuthSessionInvalidatedFireStub);
  });

  it(`should update ${SecretStorageKeys.CCLOUD_AUTH_STATUS} in storage when the connected state changes`, async () => {
    stubbedResourceManager.getCCloudAuthStatus.resolves(Status.NoToken);
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Success },
        authentication: { status: Status.ValidToken },
      },
    };

    await handleUpdatedConnection(connection);

    assert.strictEqual(observabilityContext.ccloudAuthLastSeenStatus, Status.ValidToken);
    sinon.assert.calledOnceWithExactly(
      stubbedResourceManager.setCCloudAuthStatus,
      Status.ValidToken,
    );
  });

  it(`should not update "${SecretStorageKeys.CCLOUD_AUTH_STATUS}" in storage when the connection state hasn't changed`, async () => {
    stubbedResourceManager.getCCloudAuthStatus.resolves(Status.NoToken);
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.None },
        authentication: { status: Status.NoToken },
      },
    };

    await handleUpdatedConnection(connection);

    // observability context should not be updated when state doesn't change
    assert.strictEqual(observabilityContext.ccloudAuthLastSeenStatus, Status.NoToken);
    sinon.assert.notCalled(stubbedResourceManager.setCCloudAuthStatus);
  });

  const stableStates: [ConnectedState, Status][] = [
    [ConnectedState.Success, Status.ValidToken],
    [ConnectedState.Failed, Status.Failed],
    [ConnectedState.None, Status.NoToken],
  ];
  for (const [currentState, authStatus] of stableStates) {
    it(`should fire a nonInvalidTokenStatus event when the connected state is stable (${currentState}/${authStatus})`, async () => {
      // previous connected state doesn't matter for this test
      const connection: Connection = {
        ...TEST_CCLOUD_CONNECTION,
        status: {
          ccloud: { state: currentState },
          authentication: { status: authStatus },
        },
      };

      await handleUpdatedConnection(connection);

      sinon.assert.calledOnce(nonInvalidTokenStatusFireStub);
    });
  }

  it(`should not fire a nonInvalidTokenStatus event when the connected state is not stable (${Status.InvalidToken})`, async () => {
    // previous connected state doesn't matter for this test
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Attempting },
        authentication: { status: Status.InvalidToken },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.notCalled(nonInvalidTokenStatusFireStub);
  });

  const badStates: [ConnectedState, Status][] = [
    [ConnectedState.None, Status.NoToken],
    [ConnectedState.Failed, Status.Failed],
  ];
  for (const [currentState, authStatus] of badStates) {
    it(`should fire ccloudAuthSessionInvalidated when the connected state is ${currentState}`, async () => {
      // previous connected state doesn't matter for this test
      const connection: Connection = {
        ...TEST_CCLOUD_CONNECTION,
        status: {
          ccloud: { state: currentState },
          authentication: { status: authStatus },
        },
      };

      await handleUpdatedConnection(connection);

      sinon.assert.calledOnce(ccloudAuthSessionInvalidatedFireStub);
    });
  }

  it(`should not fire ccloudAuthSessionInvalidated when the connected state is ${Status.InvalidToken}`, async () => {
    // previous connected state doesn't matter for this test
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Expired },
        authentication: { status: Status.InvalidToken },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.notCalled(ccloudAuthSessionInvalidatedFireStub);
  });

  const happyStates: [ConnectedState, Status][] = [
    [ConnectedState.Success, Status.ValidToken],
    [ConnectedState.Attempting, Status.InvalidToken],
    [ConnectedState.Expired, Status.InvalidToken],
  ];
  for (const [currentState, authStatus] of happyStates) {
    it(`should not show any notifications when the connected state is ${currentState}`, async () => {
      // previous connected state doesn't matter for this test
      const connection: Connection = {
        ...TEST_CCLOUD_CONNECTION,
        status: {
          ccloud: { state: currentState },
          authentication: { status: authStatus },
        },
      };

      await handleUpdatedConnection(connection);

      sinon.assert.notCalled(showInfoNotificationWithButtonsStub);
      sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
    });
  }

  for (const previousState of [Status.ValidToken, Status.InvalidToken]) {
    it(`should show an info notification for session expiration when transitioning from ${previousState} to ${Status.NoToken}`, async () => {
      stubbedResourceManager.getCCloudAuthStatus.resolves(previousState);

      const connection: Connection = {
        ...TEST_CCLOUD_CONNECTION,
        status: {
          ccloud: { state: ConnectedState.None },
          authentication: { status: Status.NoToken },
        },
      };

      await handleUpdatedConnection(connection);

      sinon.assert.calledOnceWithExactly(
        showInfoNotificationWithButtonsStub,
        "Your Confluent Cloud session has expired. Please sign in again to continue.",
        {
          [REAUTH_BUTTON_TEXT]: sinon.match.func,
        },
      );
    });
  }

  it(`should not show an info notification for a ${Status.NoToken} connected state`, async () => {
    stubbedResourceManager.getCCloudAuthStatus.resolves(Status.NoToken);

    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.None },
        authentication: { status: Status.NoToken },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.notCalled(showInfoNotificationWithButtonsStub);
  });

  it(`should show an error notification with a "${CCLOUD_SIGN_IN_BUTTON_LABEL}" button when the connected state is ${Status.Failed}`, async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Failed },
        authentication: { status: Status.Failed },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
    sinon.assert.calledOnceWithExactly(
      showErrorNotificationWithButtonsStub,
      "Error authenticating with Confluent Cloud. Please try again.",
      {
        [CCLOUD_SIGN_IN_BUTTON_LABEL]: sinon.match.func,
      },
    );
  });

  for (const errorKey of ["auth_status_check", "sign_in", "token_refresh"]) {
    it(`should show an error notification for non-transient '${errorKey}' errors`, async () => {
      stubbedResourceManager.getCCloudAuthStatus.resolves(Status.InvalidToken);

      const errors: AuthErrors = {
        [errorKey]: { message: "Uh oh", is_transient: false },
      };
      const connection: Connection = {
        ...TEST_CCLOUD_CONNECTION,
        status: {
          ccloud: {
            state: ConnectedState.Expired,
            errors,
          },
          authentication: {
            status: Status.InvalidToken,
            errors,
          },
        },
      };

      await handleUpdatedConnection(connection);

      sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
      sinon.assert.calledOnceWithMatch(
        showErrorNotificationWithButtonsStub,
        "Error authenticating with Confluent Cloud. Please try again.",
        {
          [CCLOUD_SIGN_IN_BUTTON_LABEL]: sinon.match.func,
        },
      );
      sinon.assert.calledOnce(ccloudAuthSessionInvalidatedFireStub);
    });
  }

  for (const errorKey of ["auth_status_check", "sign_in", "token_refresh"]) {
    it(`should not show an error notification for transient '${errorKey} errors`, async () => {
      stubbedResourceManager.getCCloudAuthStatus.resolves(Status.InvalidToken);

      const errors: AuthErrors = {
        [errorKey]: { message: "Uh oh", is_transient: true },
      };
      const connection: Connection = {
        ...TEST_CCLOUD_CONNECTION,
        status: {
          ccloud: {
            state: ConnectedState.Expired,
            errors,
          },
          authentication: {
            status: Status.InvalidToken,
            errors,
          },
        },
      };

      await handleUpdatedConnection(connection);

      sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
      sinon.assert.notCalled(ccloudAuthSessionInvalidatedFireStub);
    });
  }

  it("should not show an error notification when `errors` is an empty object", async () => {
    // connected state doesn't really matter here since we'll look at the errors
    // no matter what the state is
    stubbedResourceManager.getCCloudAuthStatus.resolves(Status.ValidToken);

    const errors: AuthErrors = {};
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: {
          state: ConnectedState.Success,
          errors,
        },
        authentication: {
          status: Status.ValidToken,
          errors,
        },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
  });

  it("should not show an error notification when no `errors` are present", async () => {
    // connected state doesn't really matter here since we'll look at the errors
    // no matter what the state is
    stubbedResourceManager.getCCloudAuthStatus.resolves(Status.ValidToken);
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Success },
        authentication: { status: Status.ValidToken },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
  });
});
