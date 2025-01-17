import { SinonSandbox, SinonStub, assert, createSandbox } from "sinon";
import { commands, window } from "vscode";
import { showErrorNotificationWithButtons } from "./errors";
import * as telemetryEvents from "./telemetry/events";

const fakeMessage = "oh no, an error";
const DEFAULT_BUTTONS = ["Open Logs", "File Issue"];

describe.only("errors.ts", () => {
  let sandbox: SinonSandbox;
  let showErrorMessageStub: SinonStub;
  let executeCommandStub: SinonStub;
  let logUsageStub: SinonStub;

  beforeEach(() => {
    sandbox = createSandbox();
    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves(undefined);
    executeCommandStub = sandbox.stub(commands, "executeCommand");
    logUsageStub = sandbox.stub(telemetryEvents, "logUsage");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("showErrorNotificationWithButtons() should show an error notification with default buttons if none are provided", async () => {
    // showErrorMessageStub simulates user dismissing the notification by default

    await showErrorNotificationWithButtons(fakeMessage);

    assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, ...DEFAULT_BUTTONS);
    assert.notCalled(executeCommandStub);
    assert.notCalled(logUsageStub);
  });

  it("showErrorNotificationWithButtons() should call the default 'Open Logs' callback function and send a usage event for telemetry for telemetry", async () => {
    // simulate user clicking the "Open Logs" button on the notification
    const buttonLabel = "Open Logs";
    showErrorMessageStub.resolves(buttonLabel);

    await showErrorNotificationWithButtons(fakeMessage);

    assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, ...DEFAULT_BUTTONS);
    assert.calledOnceWithExactly(executeCommandStub, "confluent.showOutputChannel");
    assert.calledOnceWithExactly(
      logUsageStub,
      telemetryEvents.UserEvent.NotificationButtonClicked,
      {
        buttonLabel,
        notificationType: "error",
      },
    );
  });

  it("showErrorNotificationWithButtons() should call the default 'File Issue' callback function and send a usage event for telemetry", async () => {
    // simulate user clicking the "File Issue" button on the notification
    const buttonLabel = "File Issue";
    showErrorMessageStub.resolves(buttonLabel);

    await showErrorNotificationWithButtons(fakeMessage);

    assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, ...DEFAULT_BUTTONS);
    assert.calledOnceWithExactly(executeCommandStub, "confluent.support.issue");
    assert.calledOnceWithExactly(
      logUsageStub,
      telemetryEvents.UserEvent.NotificationButtonClicked,
      {
        buttonLabel,
        notificationType: "error",
      },
    );
  });

  it("showErrorNotificationWithButtons() should show an error notification with custom buttons and callback functions", async () => {
    // caller passes in a custom button and callback function
    const buttonLabel = "Click Me";
    const otherButtonLabel = "Do Something Else";
    const customButtons = {
      [buttonLabel]: sandbox.stub(),
      [otherButtonLabel]: sandbox.stub(),
    };
    // showErrorMessageStub simulates user dismissing the notification by default

    await showErrorNotificationWithButtons(fakeMessage, customButtons);

    assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, buttonLabel, otherButtonLabel);
    assert.notCalled(customButtons[buttonLabel]);
    assert.notCalled(customButtons[otherButtonLabel]);
  });

  it("showErrorNotificationWithButtons() should call a custom callback function and send a usage event for telemetry", async () => {
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

    assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, buttonLabel, otherButtonLabel);
    assert.calledOnce(customButtons[buttonLabel]);
    assert.notCalled(customButtons[otherButtonLabel]);

    assert.calledOnceWithExactly(
      logUsageStub,
      telemetryEvents.UserEvent.NotificationButtonClicked,
      {
        buttonLabel,
        notificationType: "error",
      },
    );
  });

  it("showErrorNotificationWithButtons() should preserve custom button ordering in the notification", async () => {
    const orderedButtons = {
      C: sandbox.stub(),
      A: sandbox.stub(),
      B: sandbox.stub(),
    };

    await showErrorNotificationWithButtons(fakeMessage, orderedButtons);

    assert.calledWith(showErrorMessageStub, fakeMessage, "C", "A", "B");
  });

  it("showErrorNotificationWithButtons() should not throw in the event of a failed callback", async () => {
    // caller passes in a custom button and callback function
    const buttonLabel = "Click Me";
    const customButtons = {
      [buttonLabel]: sandbox.stub().throws(new Error("oh no")),
    };
    // simulate user clicking one of the buttons
    showErrorMessageStub.resolves(buttonLabel);

    // no throwing
    await showErrorNotificationWithButtons(fakeMessage, customButtons);

    assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, buttonLabel);
  });

  it("showErrorNotificationWithButtons() should handle async custom callbacks", async () => {
    // caller passes in a custom button and callback function
    const buttonLabel = "Click Me";
    const asyncCallback = sandbox.stub().resolves();
    const customButtons = {
      [buttonLabel]: asyncCallback,
    };
    // simulate user clicking one of the buttons
    showErrorMessageStub.resolves(buttonLabel);

    await showErrorNotificationWithButtons(fakeMessage, customButtons);

    assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, buttonLabel);
    assert.calledOnce(asyncCallback);
  });

  it("showErrorNotificationWithButtons() should not throw/reject in the event of a failed async callback", async () => {
    // caller passes in a custom button and callback function
    const buttonLabel = "Click Me";
    const asyncCallback = sandbox.stub().rejects(new Error("oh no"));
    const customButtons = {
      [buttonLabel]: asyncCallback,
    };
    // simulate user clicking one of the buttons
    showErrorMessageStub.resolves(buttonLabel);

    await showErrorNotificationWithButtons(fakeMessage, customButtons);

    assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, buttonLabel);
    assert.calledOnce(asyncCallback);
  });
});
