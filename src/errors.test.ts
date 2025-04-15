import * as assert from "assert";
import * as sinon from "sinon";
import { commands, window } from "vscode";
import { ResponseError } from "./clients/sidecar";
import {
  getNestedErrorChain,
  hasErrorCause,
  logError,
  showErrorNotificationWithButtons,
} from "./errors";
import { Logger } from "./logging";
import * as telemetryEvents from "./telemetry/events";

const fakeMessage = "oh no, an error";
const DEFAULT_BUTTONS = ["Open Logs", "File Issue"];

describe("errors.ts showErrorNotificationWithButtons()", () => {
  let sandbox: sinon.SinonSandbox;
  let showErrorMessageStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;
  let logUsageStub: sinon.SinonStub;

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

describe("errors.ts logError()", () => {
  let sandbox: sinon.SinonSandbox;
  let loggerErrorSpy: sinon.SinonSpy;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
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
    const logMessage = "test message";
    await logError(error, logMessage);

    sinon.assert.calledOnceWithExactly(loggerErrorSpy, `Error: ${logMessage} --> ${error}`, {
      errorType: error.name,
      errorMessage,
      errorStack: error.stack,
    });
  });

  it("should log ResponseErrors with status, statusText, and body", async () => {
    const status = 400;
    const statusText = "Bad Request";
    const body = "Bad Request";
    const error: ResponseError = createResponseError(status, statusText, body);
    const logMessage = "api call";
    await logError(error, logMessage);

    sinon.assert.calledOnceWithExactly(loggerErrorSpy, `Error response: ${logMessage}`, {
      responseStatus: status,
      responseStatusText: statusText,
      responseBody: body,
      responseErrorType: error.name,
    });
  });

  for (const nonError of [null, undefined, 42, "string", {}, []]) {
    it(`should handle non-Error objects (${typeof nonError}: ${nonError})`, async () => {
      const logPrefix = "test message";
      const extra = {};
      await logError(nonError, logPrefix, extra);

      sinon.assert.calledWithExactly(
        loggerErrorSpy,
        `non-Error passed: ${JSON.stringify(nonError)}`,
        extra,
      );
    });
  }

  it("should include extra context in error logs", async () => {
    const error = new Error("test");
    const logMessage = "test message";
    await logError(error, logMessage);

    sinon.assert.calledWithMatch(loggerErrorSpy, `Error: ${logMessage} --> ${error}`, {
      errorType: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    });
  });

  it("should truncate long 'body' values for ResponseErrors", async () => {
    const status = 400;
    const statusText = "Bad Request";
    const longBody = "a".repeat(6000);
    const error = createResponseError(status, statusText, longBody);
    const logMessage = "test";
    await logError(error, logMessage);

    sinon.assert.calledOnceWithExactly(loggerErrorSpy, `Error response: ${logMessage}`, {
      responseStatus: status,
      responseStatusText: statusText,
      responseBody: "a".repeat(5000),
      responseErrorType: error.name,
    });
  });
});

describe("errors.ts hasErrorCause()", () => {
  it("should return true if the error has a 'cause' property of type Error", () => {
    const error = new Error("test");
    error.cause = new Error("cause");
    assert.strictEqual(hasErrorCause(error), true);
  });

  it("should return false if the error does not have a 'cause' property", () => {
    const error = new Error("test");
    assert.strictEqual(hasErrorCause(error), false);
  });

  it("should return false if the error has a 'cause' property that is not an Error", () => {
    const error = new Error("test");
    error.cause = "cause";
    assert.strictEqual(hasErrorCause(error), false);
  });
});

describe("errors.ts getNestedErrorChain()", () => {
  it("should return an array of all nested errors starting from the first 'cause' property", () => {
    const error1 = new Error("error1");
    const error2 = new Error("error2");
    error1.cause = error2;
    const error3 = new Error("error3");
    error2.cause = error3;

    const errorChain = getNestedErrorChain(error1);

    assert.strictEqual(errorChain.length, 3);

    assert.deepStrictEqual(errorChain[0]["errorType0"], error1.name);
    assert.deepStrictEqual(errorChain[0]["errorMessage0"], error1.message);
    assert.deepStrictEqual(errorChain[0]["errorStack0"], error1.stack);
    assert.deepStrictEqual(errorChain[1]["errorType1"], error2.name);
    assert.deepStrictEqual(errorChain[1]["errorMessage1"], error2.message);
    assert.deepStrictEqual(errorChain[1]["errorStack1"], error2.stack);
    assert.deepStrictEqual(errorChain[2]["errorType2"], error3.name);
    assert.deepStrictEqual(errorChain[2]["errorMessage2"], error3.message);
    assert.deepStrictEqual(errorChain[2]["errorStack2"], error3.stack);
  });

  it("should not recurse if the error does not have a 'cause' property", () => {
    const error = new Error("test");
    const errorChain = getNestedErrorChain(error);

    assert.strictEqual(errorChain.length, 1);
    assert.deepStrictEqual(errorChain[0]["errorType0"], error.name);
    assert.deepStrictEqual(errorChain[0]["errorMessage0"], error.message);
    assert.deepStrictEqual(errorChain[0]["errorStack0"], error.stack);
  });
});
