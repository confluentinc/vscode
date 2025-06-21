import * as assert from "assert";
import * as sinon from "sinon";
import { TEST_CCLOUD_CONNECTION } from "../../tests/unit/testResources/connection";
import { ConnectedState, Connection } from "../clients/sidecar";
import { observabilityContext } from "../context/observability";
import { ccloudAuthSessionInvalidated, stableCCloudConnectedState } from "../emitters";
import * as notifications from "../notifications";
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
  let getCCloudAuthSessionStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // stub resource manager
    stubbedResourceManager = sandbox.createStubInstance(ResourceManager);
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
    getCCloudAuthSessionStub = sandbox.stub(utils, "getCCloudAuthSession").resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return early when no CCloud status is found in connection", async () => {
    const connectionWithoutCCloudStatus: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {},
    };

    await handleUpdatedConnection(connectionWithoutCCloudStatus);

    sinon.assert.notCalled(stubbedResourceManager.setCCloudState);
    sinon.assert.notCalled(stableCCloudConnectedStateFireStub);
    sinon.assert.notCalled(ccloudAuthSessionInvalidatedFireStub);
  });

  it("should set observability context and resource manager state for all valid states", async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: {
          state: ConnectedState.Success,
          requires_authentication_at: new Date(),
        },
      },
    };

    await handleUpdatedConnection(connection);

    assert.strictEqual(observabilityContext.ccloudAuthLastSeenState, ConnectedState.Success);
    sinon.assert.calledOnceWithExactly(
      stubbedResourceManager.setCCloudState,
      ConnectedState.Success,
    );
  });

  it("should fire stable connection state event for Success state", async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: {
          state: ConnectedState.Success,
        },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.calledOnce(stableCCloudConnectedStateFireStub);
  });

  it("should not fire stable connection state event for Attempting state", async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: {
          state: ConnectedState.Attempting,
        },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.notCalled(stableCCloudConnectedStateFireStub);
  });

  it("should fire stable connection state event for Failed state", async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: {
          state: ConnectedState.Failed,
        },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.calledOnce(stableCCloudConnectedStateFireStub);
  });

  for (const state of [ConnectedState.Success, ConnectedState.Attempting]) {
    it(`should return early when the connected state is ${state}`, async () => {
      const connection: Connection = {
        ...TEST_CCLOUD_CONNECTION,
        status: {
          ccloud: {
            state,
          },
        },
      };

      await handleUpdatedConnection(connection);

      sinon.assert.notCalled(ccloudAuthSessionInvalidatedFireStub);
      sinon.assert.notCalled(showInfoNotificationWithButtonsStub);
      sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
    });
  }

  it(`should fire ccloudAuthSessionInvalidated when the connected state is ${ConnectedState.Expired}`, async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: {
          state: ConnectedState.Expired,
        },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.calledOnce(ccloudAuthSessionInvalidatedFireStub);
  });

  it(`should show an info notification with reauthenticate button when the connected state is ${ConnectedState.Expired}`, async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: {
          state: ConnectedState.Expired,
        },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.calledOnceWithExactly(
      showInfoNotificationWithButtonsStub,
      "Confluent Cloud authentication expired.",
      {
        [REAUTH_BUTTON_TEXT]: sinon.match.func,
      },
    );
  });

  it(`should call getCCloudAuthSession when "${REAUTH_BUTTON_TEXT}" is clicked and the connected state is ${ConnectedState.Expired} state`, async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: {
          state: ConnectedState.Expired,
        },
      },
    };

    await handleUpdatedConnection(connection);

    // simulate clicking the notification button to reauthenticate
    const notificationCall = showInfoNotificationWithButtonsStub.getCall(0);
    const buttons = notificationCall.args[1];
    const reauthCallback = buttons[REAUTH_BUTTON_TEXT];
    await reauthCallback();

    sinon.assert.calledOnceWithExactly(getCCloudAuthSessionStub, true);
  });

  for (const state of [ConnectedState.None, ConnectedState.Failed]) {
    it(`should fire ccloudAuthSessionInvalidated when the connected state is ${state}`, async () => {
      const connection: Connection = {
        ...TEST_CCLOUD_CONNECTION,
        status: {
          ccloud: {
            state: ConnectedState.Failed,
          },
        },
      };

      await handleUpdatedConnection(connection);

      sinon.assert.calledOnce(ccloudAuthSessionInvalidatedFireStub);
    });
  }

  it("should show an error notification when `errors` data is present", async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: {
          state: ConnectedState.Failed,
          errors: {
            sign_in: { message: "Invalid credentials" },
          },
        },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.calledOnceWithExactly(
      showErrorNotificationWithButtonsStub,
      "Error authenticating with Confluent Cloud. Please try again.",
      {
        [CCLOUD_SIGN_IN_BUTTON_LABEL]: sinon.match.func,
      },
    );
  });

  it("should not show an error notification when `errors` data isn't present", async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: {
          state: ConnectedState.Failed,
        },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
  });

  it("should not show an error notification when `errors` object is empty", async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: {
          state: ConnectedState.Failed,
          errors: {},
        },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.notCalled(showErrorNotificationWithButtonsStub);
  });

  it(`should show both an info notification and error notification when the connected state is ${ConnectedState.Expired} and \`errors\` data is present`, async () => {
    const connection: Connection = {
      ...TEST_CCLOUD_CONNECTION,
      status: {
        ccloud: {
          state: ConnectedState.Expired,
          errors: {
            auth_status_check: { message: "Connection timeout", is_transient: true },
          },
        },
      },
    };

    await handleUpdatedConnection(connection);

    sinon.assert.calledOnce(showInfoNotificationWithButtonsStub);
    sinon.assert.calledOnce(showErrorNotificationWithButtonsStub);
    sinon.assert.calledOnce(ccloudAuthSessionInvalidatedFireStub);
  });
});
