import * as sinon from "sinon";
import { commands, window } from "vscode";
import {
  DEFAULT_ERROR_NOTIFICATION_BUTTONS,
  showErrorNotificationWithButtons,
  showInfoNotificationWithButtons,
  showWarningNotificationWithButtons,
} from "./notifications";
import * as telemetryEvents from "./telemetry/events";

const DEFAULT_BUTTONS = Object.keys(DEFAULT_ERROR_NOTIFICATION_BUTTONS);

describe("notifications.ts showErrorNotificationWithButtons()", () => {
  let sandbox: sinon.SinonSandbox;
  let showErrorMessageStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;
  let logUsageStub: sinon.SinonStub;
  const fakeMessage = "oh no, an error";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves(undefined);
    executeCommandStub = sandbox.stub(commands, "executeCommand");
    logUsageStub = sandbox.stub(telemetryEvents, "logUsage");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should show an error notification with default buttons if none are provided", async () => {
    // showErrorMessageStub simulates user dismissing the notification by default

    await showErrorNotificationWithButtons(fakeMessage);

    sinon.assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, ...DEFAULT_BUTTONS);
    sinon.assert.notCalled(executeCommandStub);
    sinon.assert.notCalled(logUsageStub);
  });

  it("should call the default 'Open Logs' callback function and send a usage event for telemetry for telemetry", async () => {
    // simulate user clicking the "Open Logs" button on the notification
    const buttonLabel = "Open Logs";
    showErrorMessageStub.resolves(buttonLabel);

    await showErrorNotificationWithButtons(fakeMessage);

    sinon.assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, ...DEFAULT_BUTTONS);
    sinon.assert.calledOnceWithExactly(executeCommandStub, "confluent.showOutputChannel");
    sinon.assert.calledOnceWithExactly(
      logUsageStub,
      telemetryEvents.UserEvent.NotificationButtonClicked,
      {
        buttonLabel,
        notificationType: "error",
      },
    );
  });

  it("should call the default 'File Issue' callback function and send a usage event for telemetry", async () => {
    // simulate user clicking the "File Issue" button on the notification
    const buttonLabel = "File Issue";
    showErrorMessageStub.resolves(buttonLabel);

    await showErrorNotificationWithButtons(fakeMessage);

    sinon.assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, ...DEFAULT_BUTTONS);
    sinon.assert.calledOnceWithExactly(executeCommandStub, "confluent.support.issue");
    sinon.assert.calledOnceWithExactly(
      logUsageStub,
      telemetryEvents.UserEvent.NotificationButtonClicked,
      {
        buttonLabel,
        notificationType: "error",
      },
    );
  });

  it("should show an error notification with custom buttons and callback functions", async () => {
    // caller passes in a custom button and callback function
    const buttonLabel = "Click Me";
    const otherButtonLabel = "Do Something Else";
    const customButtons = {
      [buttonLabel]: sandbox.stub(),
      [otherButtonLabel]: sandbox.stub(),
    };
    // showErrorMessageStub simulates user dismissing the notification by default

    await showErrorNotificationWithButtons(fakeMessage, customButtons);

    sinon.assert.calledOnceWithExactly(
      showErrorMessageStub,
      fakeMessage,
      buttonLabel,
      otherButtonLabel,
    );
    sinon.assert.notCalled(customButtons[buttonLabel]);
    sinon.assert.notCalled(customButtons[otherButtonLabel]);
  });

  it("should call a custom callback function and send a usage event for telemetry", async () => {
    // caller passes in a custom button and callback function
    const buttonLabel = "Click Me";
    const otherButtonLabel = "Do Something Else";
    const customButtons = {
      [buttonLabel]: sandbox.stub(),
      [otherButtonLabel]: sandbox.stub(),
    };
    // simulate user clicking one of the buttons
    showErrorMessageStub.resolves(buttonLabel);

    await showErrorNotificationWithButtons(fakeMessage, customButtons);

    sinon.assert.calledOnceWithExactly(
      showErrorMessageStub,
      fakeMessage,
      buttonLabel,
      otherButtonLabel,
    );
    sinon.assert.calledOnce(customButtons[buttonLabel]);
    sinon.assert.notCalled(customButtons[otherButtonLabel]);

    sinon.assert.calledOnceWithExactly(
      logUsageStub,
      telemetryEvents.UserEvent.NotificationButtonClicked,
      {
        buttonLabel,
        notificationType: "error",
      },
    );
  });

  it("should preserve custom button ordering in the notification", async () => {
    const orderedButtons = {
      C: sandbox.stub(),
      A: sandbox.stub(),
      B: sandbox.stub(),
    };

    await showErrorNotificationWithButtons(fakeMessage, orderedButtons);

    sinon.assert.calledWith(showErrorMessageStub, fakeMessage, "C", "A", "B");
  });

  it("should not throw in the event of a failed callback", async () => {
    // caller passes in a custom button and callback function
    const buttonLabel = "Click Me";
    const customButtons = {
      [buttonLabel]: sandbox.stub().throws(new Error("oh no")),
    };
    // simulate user clicking one of the buttons
    showErrorMessageStub.resolves(buttonLabel);

    // no throwing
    await showErrorNotificationWithButtons(fakeMessage, customButtons);

    sinon.assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, buttonLabel);
    sinon.assert.calledOnce(customButtons[buttonLabel]);
  });

  it("should handle async custom callbacks", async () => {
    // caller passes in a custom button and callback function
    const buttonLabel = "Click Me";
    const asyncCallback = sandbox.stub().resolves();
    const customButtons = {
      [buttonLabel]: asyncCallback,
    };
    // simulate user clicking one of the buttons
    showErrorMessageStub.resolves(buttonLabel);

    await showErrorNotificationWithButtons(fakeMessage, customButtons);

    sinon.assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, buttonLabel);
    sinon.assert.calledOnce(asyncCallback);
  });

  it("should not throw/reject in the event of a failed async callback", async () => {
    // caller passes in a custom button and callback function
    const buttonLabel = "Click Me";
    const asyncCallback = sandbox.stub().rejects(new Error("oh no"));
    const customButtons = {
      [buttonLabel]: asyncCallback,
    };
    // simulate user clicking one of the buttons
    showErrorMessageStub.resolves(buttonLabel);

    await showErrorNotificationWithButtons(fakeMessage, customButtons);

    sinon.assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, buttonLabel);
    sinon.assert.calledOnce(asyncCallback);
  });
});

describe("notifications.ts showInfoNotificationWithButtons()", () => {
  let sandbox: sinon.SinonSandbox;
  let showInfoMessageStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;
  let logUsageStub: sinon.SinonStub;
  const fakeMessage = "info message";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    showInfoMessageStub = sandbox.stub(window, "showInformationMessage").resolves(undefined);
    executeCommandStub = sandbox.stub(commands, "executeCommand");
    logUsageStub = sandbox.stub(telemetryEvents, "logUsage");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should show an info notification with no default buttons", async () => {
    // showInfoMessageStub simulates user dismissing the notification by default

    await showInfoNotificationWithButtons(fakeMessage);

    sinon.assert.calledOnceWithExactly(showInfoMessageStub, fakeMessage);
    sinon.assert.notCalled(executeCommandStub);
    sinon.assert.notCalled(logUsageStub);
  });

  it("should show an info notification with custom buttons when provided", async () => {
    const buttonLabel = "Custom Action";
    const customButtons = { [buttonLabel]: sandbox.stub() };

    await showInfoNotificationWithButtons(fakeMessage, customButtons);

    sinon.assert.calledOnceWithExactly(showInfoMessageStub, fakeMessage, buttonLabel);
    sinon.assert.notCalled(executeCommandStub);
    sinon.assert.notCalled(logUsageStub);
    sinon.assert.notCalled(customButtons[buttonLabel]);
  });
});

describe("notifications.ts showWarningNotificationWithButtons()", () => {
  let sandbox: sinon.SinonSandbox;
  let showWarningMessageStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;
  let logUsageStub: sinon.SinonStub;
  const fakeMessage = "watch out!";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    showWarningMessageStub = sandbox.stub(window, "showWarningMessage").resolves(undefined);
    executeCommandStub = sandbox.stub(commands, "executeCommand");
    logUsageStub = sandbox.stub(telemetryEvents, "logUsage");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should show a warning notification with no provided buttons, so gets default buttons.", async () => {
    // showWarningMessageStub simulates user dismissing the notification by default

    await showWarningNotificationWithButtons(fakeMessage);

    sinon.assert.calledOnceWithExactly(showWarningMessageStub, fakeMessage, ...DEFAULT_BUTTONS);
    sinon.assert.notCalled(executeCommandStub);
    sinon.assert.notCalled(logUsageStub);
  });

  it("should show a warning notification with custom buttons when provided", async () => {
    const buttonLabel = "Custom Action";
    const customButtons = { [buttonLabel]: sandbox.stub() };

    await showWarningNotificationWithButtons(fakeMessage, customButtons);

    sinon.assert.calledOnceWithExactly(showWarningMessageStub, fakeMessage, buttonLabel);
    sinon.assert.notCalled(executeCommandStub);
    sinon.assert.notCalled(logUsageStub);
    sinon.assert.notCalled(customButtons[buttonLabel]);
  });
});
