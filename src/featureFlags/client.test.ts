import * as assert from "assert";
import { LDElectronMainClient } from "launchdarkly-electron-client-sdk";
import * as sinon from "sinon";
import * as clientModule from "./client";
import * as constants from "./constants";
import { FEATURE_FLAG_DEFAULTS, FeatureFlags } from "./constants";
import * as init from "./init";

describe("featureFlags/client.ts", function () {
  let sandbox: sinon.SinonSandbox;

  let ldClientIdStub: sinon.SinonStub;
  let clientInitStub: sinon.SinonStub;
  let stubbedLDClient: sinon.SinonStubbedInstance<LDElectronMainClient>;
  let clientOnStub: sinon.SinonStub;
  let clientOffStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // stub LD_CLIENT_ID instead of process.env
    ldClientIdStub = sandbox.stub(constants, "LD_CLIENT_ID").value(constants.LD_CLIENT_ID);
    clientOnStub = sandbox.stub();
    clientOffStub = sandbox.stub();
    stubbedLDClient = {
      on: clientOnStub,
      off: clientOffStub,
      close: sandbox.stub(),
    } as unknown as sinon.SinonStubbedInstance<LDElectronMainClient>;
    // stub the init function to return a fake client because we can't stub the SDK's
    // initializeInMain function directly
    clientInitStub = sandbox.stub(init, "clientInit").returns(stubbedLDClient);

    // reset feature flags and client before each test
    clientModule.resetFlagDefaults();
    clientModule.disposeLaunchDarklyClient();
  });

  afterEach(function () {
    // reset feature flags and client after each test
    clientModule.resetFlagDefaults();
    clientModule.disposeLaunchDarklyClient();
    sandbox.restore();
  });

  it("getLaunchDarklyClient() should return undefined when LD_CLIENT_ID is not set", function () {
    // no client ID set
    ldClientIdStub.value(undefined);
    clientInitStub.returns(undefined);

    const client: LDElectronMainClient | undefined = clientModule.getLaunchDarklyClient();

    sinon.assert.calledOnce(clientInitStub);
    assert.strictEqual(client, undefined);
  });

  it("getLaunchDarklyClient() should not set up the client event listeners when LD_CLIENT_ID is not set", function () {
    // no client ID set
    ldClientIdStub.value(undefined);
    clientInitStub.returns(undefined);

    clientModule.getLaunchDarklyClient();

    sinon.assert.calledOnce(clientInitStub);
    // event listeners should not be registered
    sinon.assert.notCalled(clientOnStub);
    // verify that feature flags are set to local default values
    assert.deepStrictEqual(FeatureFlags, FEATURE_FLAG_DEFAULTS);
  });

  it("getLaunchDarklyClient() should set up the client and register event listeners when LD_CLIENT_ID is set", function () {
    const client: LDElectronMainClient | undefined = clientModule.getLaunchDarklyClient();

    assert.ok(client);
    // event listeners should have been registered
    sinon.assert.callCount(clientOnStub, 4);
  });

  it("getLaunchDarklyClient() should handle exceptions during client initialization", function () {
    clientInitStub.throws(new Error("uh oh"));

    const client: LDElectronMainClient | undefined = clientModule.getLaunchDarklyClient();

    assert.strictEqual(client, undefined);
  });

  it("getLaunchDarklyClient() should return the same client instance on repeated calls", function () {
    const clientA: LDElectronMainClient | undefined = clientModule.getLaunchDarklyClient();
    const clientB: LDElectronMainClient | undefined = clientModule.getLaunchDarklyClient();

    assert.strictEqual(clientA, clientB);
  });

  it("disposeLaunchDarklyClient() should close the client and set it to undefined", function () {
    // make sure we have a client to start
    const client: LDElectronMainClient | undefined = clientModule.getLaunchDarklyClient();
    assert.ok(client);
    sinon.assert.callCount(clientOnStub, 4);

    // get rid of it
    clientModule.disposeLaunchDarklyClient();

    const clientAfterDispose: LDElectronMainClient | undefined =
      clientModule.getLaunchDarklyClient();
    assert.ok(clientAfterDispose);
    // this is the kicker: the client should have transitioned to undefined, which means calling
    // `getLaunchDarklyClient()` again will re-initialize it and set up the event listeners again
    sinon.assert.callCount(clientOnStub, 8);
  });

  it("resetFlagDefaults() should set feature flags to default values", function () {
    clientModule.resetFlagDefaults();

    assert.deepStrictEqual(FeatureFlags, FEATURE_FLAG_DEFAULTS);
  });

  it("resetFlagDefaults() should remove any untracked flags", function () {
    FeatureFlags["untrackedFlag"] = true;
    clientModule.resetFlagDefaults();

    assert.strictEqual(FeatureFlags["untrackedFlag"], undefined);
  });
});
