import * as assert from "assert";
import * as sinon from "sinon";
import { TEST_CCLOUD_AUTH_SESSION } from "../../tests/unit/testResources/ccloudAuth";
import { TEST_CCLOUD_CONNECTION } from "../../tests/unit/testResources/connection";
import { AuthErrors, ConnectedState, Connection } from "../clients/sidecar";
import { observabilityContext } from "../context/observability";
import { ccloudAuthSessionInvalidated, stableCCloudConnectedState } from "../emitters";
import * as notifications from "../notifications";
import { SecretStorageKeys } from "../storage/constants";
import { ResourceManager } from "../storage/resourceManager";
import { handleUpdatedConnection, REAUTH_BUTTON_TEXT } from "./ccloudStateHandling";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "./constants";
import * as utils from "./utils";

describe("authn/ccloudStateHandling.ts handleUpdatedConnection()", () => {
  let sandbox: sinon.SinonSandbox;
  let stubbedResourceManager: sinon.SinonStubbedInstance<ResourceManager>;
  let stableCCloudConnectedStateFireStub: sinon.SinonStub;
  let ccloudAuthSessionInvalidatedFireStub: sinon.SinonStub;
  let showErrorNotificationWithButtonsStub: sinon.SinonStub;
  let showInfoNotificationWithButtonsStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // stub resource manager
    stubbedResourceManager = sandbox.createStubInstance(ResourceManager);
    // simulate no connected state by default
    stubbedResourceManager.getCCloudState.resolves(ConnectedState.None);
    observabilityContext.ccloudAuthLastSeenState = ConnectedState.None;
    sandbox.stub(ResourceManager, "getInstance").returns(stubbedResourceManager);

    // stub emitters
    stableCCloudConnectedStateFireStub = sandbox.stub(stableCCloudConnectedState, "fire");
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
      },
    };

    await handleUpdatedConnection(connectionWithoutCCloudStatus);

    sinon.assert.notCalled(stubbedResourceManager.setCCloudState);
    sinon.assert.notCalled(stableCCloudConnectedStateFireStub);
    sinon.assert.notCalled(ccloudAuthSessionInvalidatedFireStub);
  });

  it(`should update ${SecretStorageKeys.CCLOUD_STATE} in storage when the connected state changes`, async () => {
    stubbedResourceManager.getCCloudState.resolves(ConnectedState.None);
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Success },
      },
    };

    await handleUpdatedConnection(connection);

    assert.strictEqual(observabilityContext.ccloudAuthLastSeenState, ConnectedState.Success);
    sinon.assert.calledOnceWithExactly(
      stubbedResourceManager.setCCloudState,
      ConnectedState.Success,
    );
  });

  it(`should not update "${SecretStorageKeys.CCLOUD_STATE}" in storage when the connection state hasn't changed`, async () => {
    stubbedResourceManager.getCCloudState.resolves(ConnectedState.None);
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.None },
      },
    };

    await handleUpdatedConnection(connection);

    // observability context should not be updated when state doesn't change
    assert.strictEqual(observabilityContext.ccloudAuthLastSeenState, ConnectedState.None);
    sinon.assert.notCalled(stubbedResourceManager.setCCloudState);
  });

  for (const currentState of [
    ConnectedState.None,
    ConnectedState.Expired,
    ConnectedState.Success,
    ConnectedState.Failed,
  ]) {
    it(`should fire a stableCCloudConnectedState event when the connected state is stable (${currentState})`, async () => {
      // previous connected state doesn't matter for this test
      const connection: Connection = {
        ...TEST_CCLOUD_CONNECTION,
        status: {
          ccloud: { state: currentState },
        },
      };

      await handleUpdatedConnection(connection);

      sinon.assert.calledOnce(stableCCloudConnectedStateFireStub);
    });
  }

  it(`should not fire a stableCCloudConnectedState event when the connected state is not stable (${ConnectedState.Expired})`, async () => {
    // previous connected state doesn't matter for this test
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Expired },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.notCalled(stableCCloudConnectedStateFireStub);
  });

  it(`should fire ccloudAuthSessionInvalidated when the connected state is ${ConnectedState.Failed}`, async () => {
    // previous connected state doesn't matter for this test
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Failed },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.calledOnce(ccloudAuthSessionInvalidatedFireStub);
  });

  for (const currentState of [
    ConnectedState.Success,
    ConnectedState.Expired,
    ConnectedState.None,
  ]) {
    it(`should not fire ccloudAuthSessionInvalidated when the connected state is not ${ConnectedState.Failed} (state=${currentState})`, async () => {
      stubbedResourceManager.getCCloudState.resolves(ConnectedState.None);
      const connection: Connection = {
        ...TEST_CCLOUD_CONNECTION,
        status: {
          ccloud: { state: currentState },
        },
      };

      await handleUpdatedConnection(connection);

      sinon.assert.notCalled(ccloudAuthSessionInvalidatedFireStub);
    });
  }

  for (const previousState of [ConnectedState.Success, ConnectedState.Expired]) {
    it(`should fire ccloudAuthSessionInvalidated when transitioning from ${previousState} to ${ConnectedState.None}`, async () => {
      stubbedResourceManager.getCCloudState.resolves(previousState);
      const connection: Connection = {
        ...TEST_CCLOUD_CONNECTION,
        status: {
          ccloud: { state: ConnectedState.None },
        },
      };

      await handleUpdatedConnection(connection);

      sinon.assert.notCalled(ccloudAuthSessionInvalidatedFireStub);
    });
  }

  it(`should not fire ccloudAuthSessionInvalidated when already in ${ConnectedState.None} state`, async () => {
    stubbedResourceManager.getCCloudState.resolves(ConnectedState.None);

    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.None },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.notCalled(ccloudAuthSessionInvalidatedFireStub);
  });

  for (const currentState of [ConnectedState.Success, ConnectedState.Expired]) {
    it(`should not show any notifications when the connected state is ${currentState}`, async () => {
      // previous connected state doesn't matter for this test
      const connection: Connection = {
        ...TEST_CCLOUD_CONNECTION,
        status: {
          ccloud: { state: currentState },
        },
      };

      await handleUpdatedConnection(connection);

      sinon.assert.notCalled(showInfoNotificationWithButtonsStub);
      sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
    });
  }

  for (const previousState of [ConnectedState.Success, ConnectedState.Expired]) {
    it(`should show an info notification for session expiration when transitioning from ${previousState} to ${ConnectedState.None}`, async () => {
      stubbedResourceManager.getCCloudState.resolves(previousState);

      const connection: Connection = {
        ...TEST_CCLOUD_CONNECTION,
        status: {
          ccloud: { state: ConnectedState.None },
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
      sinon.assert.calledOnce(ccloudAuthSessionInvalidatedFireStub);
    });
  }

  it(`should not show an info notification for a ${ConnectedState.None} connected state`, async () => {
    stubbedResourceManager.getCCloudState.resolves(ConnectedState.None);

    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.None },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.notCalled(showInfoNotificationWithButtonsStub);
  });

  it(`should show an error notification with a "${CCLOUD_SIGN_IN_BUTTON_LABEL}" button when the connected state is ${ConnectedState.Failed}`, async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Failed },
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
      stubbedResourceManager.getCCloudState.resolves(ConnectedState.Expired);

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
      stubbedResourceManager.getCCloudState.resolves(ConnectedState.Expired);

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
    stubbedResourceManager.getCCloudState.resolves(ConnectedState.Success);

    const errors: AuthErrors = {};
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: {
          state: ConnectedState.Success,
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
    stubbedResourceManager.getCCloudState.resolves(ConnectedState.Success);
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: { state: ConnectedState.Success },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
  });
});
