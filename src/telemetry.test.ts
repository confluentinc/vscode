import { sendTelemetryIdentifyEvent } from "./telem";
import * as vscode from "vscode";
import * as telemetry from "./telemetry";
import Sinon from "sinon";

describe.only("sendTelemetryIdentifyEvent", () => {
  let mockTelemetryLogger: any;
  let logUsageStub: Sinon.SinonStub;
  let sdbx: sinon.SinonSandbox;

  beforeEach(() => {
    sdbx = Sinon.createSandbox();
    mockTelemetryLogger = {
      logUsage: sdbx.stub(),
    };
    sdbx.stub(telemetry, "getTelemetryLogger").returns(mockTelemetryLogger);
    logUsageStub = mockTelemetryLogger.logUsage;
  });

  afterEach(() => {
    sdbx.restore();
  });

  it("should send to logUsage with correct user info and domain", () => {
    const userInfo = {
      id: "user123",
      username: "user@mycooldomain.com",
      social_connection: "github",
    };
    const session = undefined;

    sendTelemetryIdentifyEvent({
      eventName: "testEvent",
      userInfo,
      session,
    });

    Sinon.assert.called(logUsageStub);
    Sinon.assert.calledWith(logUsageStub, "testEvent", {
      identify: true,
      user: {
        id: "user123",
        domain: "mycooldomain.com",
        social_connection: "github",
      },
    });
  });
  it("should send to logUsage with correct session info and domain", () => {
    const userInfo = undefined;
    const session = {
      account: {
        id: "session123",
        label: "session@example.com",
      },
    } as vscode.AuthenticationSession;

    sendTelemetryIdentifyEvent({
      eventName: "testEvent",
      userInfo,
      session,
    });

    Sinon.assert.called(logUsageStub);
    Sinon.assert.calledWith(logUsageStub, "testEvent", {
      identify: true,
      user: {
        id: "session123",
        domain: "example.com",
        social_connection: undefined,
      },
    });
  });
  it("should not send to logUsage if user id is not available", () => {
    const userInfo = {
      id: undefined,
      username: "user@example.com",
      social_connection: "github",
    };
    const session = undefined;

    sendTelemetryIdentifyEvent({
      eventName: "testEvent",
      userInfo,
      session,
    });

    Sinon.assert.notCalled(logUsageStub);
  });
});
