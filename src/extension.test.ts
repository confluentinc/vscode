import { type Event } from "@sentry/node";
import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { getAndActivateExtension, getExtensionContext } from "../tests/unit/testUtils";
import { checkTelemetrySettings } from "./telemetry";

describe("Base Extension Test", () => {
  it("should activate the extension", async () => {
    await getAndActivateExtension();
  });
});

describe("Extension manifest tests", () => {
  let context: vscode.ExtensionContext;

  before(async () => {
    context = await getExtensionContext();
  });

  it("should show the correct version format", async () => {
    const version = context.extension.packageJSON.version;
    // if this fails, it's including additional characters that don't match the semver format
    // e.g. "v0.1.0" instead of "0.1.0"
    if (!process.env.CI) {
      // allow the hex string suffixes for local development
      assert.ok(
        /^\d+\.\d+\.\d+(-\d+)?(\+[0-9a-f]+)?$/.test(version),
        `Version "${version}" is not in the correct format (major.minor.patch[-micro][+suffix])`,
      );
    } else {
      assert.ok(
        /^\d+\.\d+\.\d+(-\d+)?$/.test(version),
        `Version "${version}" is not in the correct format (major.minor.patch[-micro])`,
      );
    }
  });

  // not checking any command functionality, just that the commands are registered during activation
  // and that we don't have any commands in package.json that aren't registered/used
  it("should register all commands defined in package.json's contributes.commands", async () => {
    // everything available in VSCode after the extension is activated (including built-in commands)
    const allRegisteredCommands = await vscode.commands.getCommands();
    const registeredCommands = allRegisteredCommands.filter((cmd) => cmd.startsWith("confluent."));

    // just the commands in package.json `contributes.commands` that we're expecting to be registered
    const manifestCommandIds = context.extension.packageJSON.contributes.commands.map(
      (cmd: any) => cmd.command,
    );

    // check for commands that are registered but not in package.json
    const extraCommands = registeredCommands.filter(
      (cmd: any) => !manifestCommandIds.includes(cmd),
    );
    assert.strictEqual(
      extraCommands.length,
      0,
      `Commands missing from package.json: ${JSON.stringify(extraCommands, null, 2)}`,
    );

    // check for commands in package.json that aren't registered during activate()
    const missingCommands = manifestCommandIds.filter(
      (cmd: any) => !registeredCommands.includes(cmd),
    );
    assert.strictEqual(
      missingCommands.length,
      0,
      `Commands that need to be registered during activate(): ${JSON.stringify(missingCommands, null, 2)}`,
    );
  });
});

describe("ExtensionContext subscription tests", () => {
  let context: vscode.ExtensionContext;

  before(async () => {
    context = await getExtensionContext();
  });

  it("should have at least one subscription", async () => {
    assert.ok(
      context.subscriptions.length > 0,
      "No subscriptions found; did activate() run correctly?",
    );
  });
});

describe("Sentry user settings check", () => {
  let getConfigurationStub: sinon.SinonStub;
  let isTelemetryEnabledStub: sinon.SinonStub;

  before(() => {
    getConfigurationStub = sinon.stub(vscode.workspace, "getConfiguration");
    isTelemetryEnabledStub = sinon.stub(vscode.env, "isTelemetryEnabled");
  });

  after(() => {
    getConfigurationStub.restore();
    isTelemetryEnabledStub.restore();
  });

  it("should return null when telemetry is disabled", () => {
    isTelemetryEnabledStub.value(false);
    const event = { message: "Test event" } as Event;
    const result = checkTelemetrySettings(event);
    assert.strictEqual(result, null);
  });

  it("should return null when telemetry level is 'off'", () => {
    isTelemetryEnabledStub.value(true);
    getConfigurationStub.returns({
      get: (key: string) => (key === "telemetry.telemetryLevel" ? "off" : undefined),
    });
    const event = { message: "Test event" } as Event;
    const result = checkTelemetrySettings(event);
    assert.strictEqual(result, null);
  });

  it("should return the event when telemetry level is not 'off'", () => {
    isTelemetryEnabledStub.value(true);
    getConfigurationStub.returns({
      get: (key: string) => (key === "telemetry.telemetryLevel" ? "all" : undefined),
    });
    const event = { message: "Test event" } as Event;
    const result = checkTelemetrySettings(event);
    assert.deepStrictEqual(result, event);
  });
});
