import * as assert from "assert";
import { LDElectronMainClient } from "launchdarkly-electron-client-sdk";
import * as sinon from "sinon";
import * as clientModule from "./client";
import * as constants from "./constants";
import { FEATURE_FLAG_DEFAULTS, FeatureFlags } from "./constants";
import * as handlers from "./handlers";

describe("featureFlags/client.ts", function () {
  let sandbox: sinon.SinonSandbox;
  let setEventListenersStub: sinon.SinonStub;
  let ldClientIdStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // stub handlers.setEventListeners
    setEventListenersStub = sandbox.stub(handlers, "setEventListeners");

    // stub LD_CLIENT_ID instead of process.env
    ldClientIdStub = sandbox.stub(constants, "LD_CLIENT_ID").value(constants.LD_CLIENT_ID);

    // reset feature flags before each test
    clientModule.setFlagDefaults();
  });

  afterEach(function () {
    // reset feature flags and client after each test
    clientModule.setFlagDefaults();
    clientModule.disposeLaunchDarklyClient();
    sandbox.restore();
  });

  it("getLaunchDarklyClient() should return undefined when LD_CLIENT_ID is not set", function () {
    // no client ID set
    ldClientIdStub.value(undefined);

    const client: LDElectronMainClient | undefined = clientModule.getLaunchDarklyClient();

    assert.strictEqual(client, undefined);
  });

  it("getLaunchDarklyClient() should not set up the client when LD_CLIENT_ID is not set", function () {
    // no client ID set
    ldClientIdStub.value(undefined);

    clientModule.getLaunchDarklyClient();

    // setEventListeners should not be called
    sinon.assert.notCalled(setEventListenersStub);
    // verify that feature flags are set to local default values
    assert.deepStrictEqual(FeatureFlags, FEATURE_FLAG_DEFAULTS);
  });

  it("getLaunchDarklyClient() should set up the client and register event handlers when LD_CLIENT_ID is set", function () {
    const client: LDElectronMainClient | undefined = clientModule.getLaunchDarklyClient();

    assert.ok(client);
    // setEventListeners should be called
    sinon.assert.calledOnce(setEventListenersStub);
    sinon.assert.calledWith(setEventListenersStub, client);
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
    sinon.assert.calledOnce(setEventListenersStub);

    // get rid of it
    clientModule.disposeLaunchDarklyClient();

    const clientAfterDispose: LDElectronMainClient | undefined =
      clientModule.getLaunchDarklyClient();
    assert.ok(clientAfterDispose);
    // this is the kicker: the client should have transitioned to undefined, which means calling
    // `getLaunchDarklyClient()` again will re-initialize it and set up the event listeners again
    sinon.assert.calledTwice(setEventListenersStub);
  });

  it("setFlagDefaults() should set feature flags to default values", function () {
    clientModule.setFlagDefaults();

    assert.deepStrictEqual(FeatureFlags, FEATURE_FLAG_DEFAULTS);
  });
});
