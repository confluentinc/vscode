import * as sinon from "sinon";
import { commands } from "vscode";

import { EXTENSION_ID } from "../../constants";
import { SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS } from "../../extensionSettings/constants";
import * as notifications from "../../notifications";
import * as utils from "./utils";
import { FLINK_PREVIEW_MESSAGE, showFlinkPreviewNotification } from "./v1_4";

describe("activation/versions/v1_4.ts showFlinkPreviewNotification()", () => {
  let sandbox: sinon.SinonSandbox;

  let canShowNewOrUpdatedExtensionNotificationsStub: sinon.SinonStub;
  let showInfoNotificationWithButtonsStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // helper stubs
    canShowNewOrUpdatedExtensionNotificationsStub = sandbox.stub(
      utils,
      "canShowNewOrUpdatedExtensionNotifications",
    );
    showInfoNotificationWithButtonsStub = sandbox.stub(
      notifications,
      "showInfoNotificationWithButtons",
    );

    // vscode stubs
    executeCommandStub = sandbox.stub(commands, "executeCommand");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should show a notification when canShowNewOrUpdatedExtensionNotifications returns true", () => {
    canShowNewOrUpdatedExtensionNotificationsStub.returns(true);

    showFlinkPreviewNotification();

    sinon.assert.calledOnce(canShowNewOrUpdatedExtensionNotificationsStub);
    sinon.assert.calledOnceWithExactly(showInfoNotificationWithButtonsStub, FLINK_PREVIEW_MESSAGE, {
      "Open Flink Settings": sinon.match.func,
      "Change Notification Settings": sinon.match.func,
    });
  });

  it("should not show a notification when canShowNewOrUpdatedExtensionNotifications returns false", () => {
    canShowNewOrUpdatedExtensionNotificationsStub.returns(false);

    showFlinkPreviewNotification();

    sinon.assert.calledOnce(canShowNewOrUpdatedExtensionNotificationsStub);
    sinon.assert.notCalled(showInfoNotificationWithButtonsStub);
    // also shouldn't execute any commands
    sinon.assert.notCalled(executeCommandStub);
  });

  it("should execute the correct command when the 'Open Flink Settings' button is clicked", async () => {
    canShowNewOrUpdatedExtensionNotificationsStub.returns(true);
    executeCommandStub.resolves();

    showFlinkPreviewNotification();

    const notificationCall = showInfoNotificationWithButtonsStub.getCall(0);
    const buttons = notificationCall.args[1];
    const openFlinkSettingsHandler = buttons["Open Flink Settings"];
    await openFlinkSettingsHandler();

    sinon.assert.calledOnceWithExactly(
      executeCommandStub,
      "workbench.action.openSettings",
      `@ext:${EXTENSION_ID} flink`,
    );
  });

  it("should execute the correct command when the 'Change Notification Settings' button is clicked", async () => {
    canShowNewOrUpdatedExtensionNotificationsStub.returns(true);
    executeCommandStub.resolves();

    showFlinkPreviewNotification();

    // get the callback for the button from the notification
    const notificationCall = showInfoNotificationWithButtonsStub.getCall(0);
    const buttons = notificationCall.args[1];
    const changeNotificationSettingsHandler = buttons["Change Notification Settings"];
    await changeNotificationSettingsHandler();

    sinon.assert.calledOnceWithExactly(
      executeCommandStub,
      "workbench.action.openSettings",
      `@id:${SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS}`,
    );
  });
});
