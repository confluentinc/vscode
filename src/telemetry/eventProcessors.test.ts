import { type Event } from "@sentry/node";
import * as assert from "assert";
import * as sinon from "sinon";
import { env } from "vscode";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { observabilityContext } from "../context/observability";
import { checkTelemetrySettings, includeObservabilityContext } from "./eventProcessors";

describe("Sentry user settings check", () => {
  let sandbox: sinon.SinonSandbox;
  let stubbedConfigs: StubbedWorkspaceConfiguration;
  let isTelemetryEnabledStub: sinon.SinonStub;

  before(() => {
    sandbox = sinon.createSandbox();
    stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    isTelemetryEnabledStub = sandbox.stub(env, "isTelemetryEnabled");
  });

  after(() => {
    sandbox.restore();
  });

  it("should return null when telemetry is disabled", () => {
    isTelemetryEnabledStub.value(false);
    const event = { message: "Test event" } as Event;
    const result = checkTelemetrySettings(event);
    assert.strictEqual(result, null);
  });

  it("should return null when telemetry level is 'off'", () => {
    isTelemetryEnabledStub.value(true);
    stubbedConfigs.get.withArgs("telemetry.telemetryLevel").returns("off");
    const event = { message: "Test event" } as Event;
    const result = checkTelemetrySettings(event);
    assert.strictEqual(result, null);
  });

  it("should return the event when telemetry level is not 'off'", () => {
    isTelemetryEnabledStub.value(true);
    stubbedConfigs.get.withArgs("telemetry.telemetryLevel").returns("all");
    const event = { message: "Test event" } as Event;
    const result = checkTelemetrySettings(event);
    assert.deepStrictEqual(result, event);
  });
});

describe("eventProcessors.ts includeObservabilityContext()", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should include observability context in the event", () => {
    // stub the observability context's toRecord method to return some fake data
    const fakeObservabilityContext = {
      extensionVersion: "1.0.0",
      extensionActivated: true,
      sidecarVersion: "1.0.0",
    };
    sandbox.stub(observabilityContext, "toRecord").returns(fakeObservabilityContext);

    const event = { message: "Test event" } as Event;
    const result: Event = includeObservabilityContext(event);

    assert.ok(result.extra);
    assert.equal(result.extra.extensionVersion, fakeObservabilityContext.extensionVersion);
    assert.equal(result.extra.extensionActivated, fakeObservabilityContext.extensionActivated);
    assert.equal(result.extra.sidecarVersion, fakeObservabilityContext.sidecarVersion);
  });
});
