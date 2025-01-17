import { SinonSandbox, SinonSpy, SinonStub, assert, createSandbox } from "sinon";
import { commands, window } from "vscode";
import { ResponseError } from "./clients/sidecar";
import { logResponseError, showErrorNotificationWithButtons } from "./errors";
import { Logger } from "./logging";
import * as telemetryEvents from "./telemetry/events";

const fakeMessage = "oh no, an error";
const DEFAULT_BUTTONS = ["Open Logs", "File Issue"];

describe("errors.ts showErrorNotificationWithButtons()", () => {
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

  it("should show an error notification with default buttons if none are provided", async () => {
    // showErrorMessageStub simulates user dismissing the notification by default

    await showErrorNotificationWithButtons(fakeMessage);

    assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, ...DEFAULT_BUTTONS);
    assert.notCalled(executeCommandStub);
    assert.notCalled(logUsageStub);
  });

  it("should call the default 'Open Logs' callback function and send a usage event for telemetry for telemetry", async () => {
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

  it("should call the default 'File Issue' callback function and send a usage event for telemetry", async () => {
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

    assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, buttonLabel, otherButtonLabel);
    assert.notCalled(customButtons[buttonLabel]);
    assert.notCalled(customButtons[otherButtonLabel]);
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

  it("should preserve custom button ordering in the notification", async () => {
    const orderedButtons = {
      C: sandbox.stub(),
      A: sandbox.stub(),
      B: sandbox.stub(),
    };

    await showErrorNotificationWithButtons(fakeMessage, orderedButtons);

    assert.calledWith(showErrorMessageStub, fakeMessage, "C", "A", "B");
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

    assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, buttonLabel);
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

    assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, buttonLabel);
    assert.calledOnce(asyncCallback);
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

    assert.calledOnceWithExactly(showErrorMessageStub, fakeMessage, buttonLabel);
    assert.calledOnce(asyncCallback);
  });
});

describe("errors.ts logResponseError()", () => {
  let sandbox: SinonSandbox;
  let loggerErrorSpy: SinonSpy;

  beforeEach(() => {
    sandbox = createSandbox();
    // spy on the `logger.error` calls so we can check the arguments and also see them in test output
    loggerErrorSpy = sandbox.spy(Logger.prototype, "error");
  });

  afterEach(() => {
    sandbox.restore();
  });

  const createResponseError = (status: number, statusText: string, body: string): ResponseError => {
    const response = {
      status,
      statusText,
      clone: () => ({
        text: () => Promise.resolve(body),
      }),
    } as Response;
    return new ResponseError(response);
  };

  it("should log regular Error instances", async () => {
    const errorMessage = "uh oh";
    const error = new Error(errorMessage);
    const logPrefix = "test message";
    await logResponseError(error, logPrefix);

    assert.calledOnceWithExactly(
      loggerErrorSpy,
      `[${logPrefix}] error: ${error.name}: ${errorMessage}`,
      {
        errorType: error.name,
        errorMessage,
      },
    );
  });

  it("should log ResponseErrors with status, statusText, and body", async () => {
    const status = 400;
    const statusText = "Bad Request";
    const body = "Bad Request";
    const error: ResponseError = createResponseError(status, statusText, body);
    const logPrefix = "api call";
    await logResponseError(error, logPrefix);

    assert.calledOnceWithExactly(loggerErrorSpy, `[${logPrefix}] error response:`, {
      status,
      statusText,
      body,
      errorType: error.name,
    });
  });

  it("should handle non-Error objects", async () => {
    const nonError = { foo: "bar" };
    await logResponseError(nonError, "test message");

    assert.calledOnceWithExactly(loggerErrorSpy, "[test message] error: [object Object]", {});
  });

  it("should include extra context in error logs", async () => {
    const error = new Error("test");
    const extra = { foo: "bar" };
    await logResponseError(error, "test", extra);

    assert.calledWithMatch(loggerErrorSpy, "[test] error: Error: test", {
      errorType: "Error",
      errorMessage: "test",
      ...extra,
    });
  });

  it("should truncate long 'body' values for ResponseErrors", async () => {
    const status = 400;
    const statusText = "Bad Request";
    const longBody = "a".repeat(6000);
    const error = createResponseError(status, "Bad Request", longBody);
    const logPrefix = "test";
    await logResponseError(error, logPrefix);

    assert.calledOnceWithExactly(loggerErrorSpy, `[${logPrefix}] error response:`, {
      status,
      statusText,
      body: "a".repeat(5000),
      errorType: "ResponseError",
    });
  });
});
