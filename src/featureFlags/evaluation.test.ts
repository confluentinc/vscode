import * as assert from "assert";
import { LDElectronMainClient } from "launchdarkly-electron-client-sdk";
import * as sinon from "sinon";
import { commands, env, window } from "vscode";
import { EXTENSION_ID, EXTENSION_VERSION } from "../constants";
import * as clientModule from "./client";
import * as constants from "./constants";
import {
  FEATURE_FLAG_DEFAULTS,
  FeatureFlag,
  FeatureFlags,
  GLOBAL_DISABLED_MESSAGE,
} from "./constants";
import {
  checkForExtensionDisabledReason,
  getFlagValue,
  showExtensionDisabledNotification,
} from "./evaluation";
import * as init from "./init";
import { DisabledVersion } from "./types";

const fakeFlag = "test.flag";
const fakeReason = "TEST TEST TEST This version isn't enabled. TEST TEST TEST";

describe("featureFlags/evaluation.ts", function () {
  let sandbox: sinon.SinonSandbox;

  let showErrorMessageStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;

  let stubbedLDClient: sinon.SinonStubbedInstance<LDElectronMainClient>;
  let clientVariationStub: sinon.SinonStub;
  let getLaunchDarklyClientStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // vscode stubs
    executeCommandStub = sandbox.stub(commands, "executeCommand");
    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves();

    // stub LD_CLIENT_ID instead of process.env
    sandbox.stub(constants, "LD_CLIENT_ID").value(constants.LD_CLIENT_ID);
    clientVariationStub = sandbox.stub();
    stubbedLDClient = {
      on: sandbox.stub(),
      off: sandbox.stub(),
      close: sandbox.stub(),
      variation: clientVariationStub,
    } as unknown as sinon.SinonStubbedInstance<LDElectronMainClient>;
    // stub the init function to return a fake client because we can't stub the SDK's
    // initializeInMain function directly
    sandbox.stub(init, "clientInit").returns(stubbedLDClient);
    getLaunchDarklyClientStub = sandbox
      .stub(clientModule, "getLaunchDarklyClient")
      .returns(stubbedLDClient);

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

  it("getFlagValue() should return client variation value when available", function () {
    clientVariationStub.withArgs(fakeFlag).returns("test-value");

    const value = getFlagValue(fakeFlag);

    assert.strictEqual(value, "test-value");
  });

  for (const missingValue of [undefined, null]) {
    it(`getFlagValue() should return ${missingValue} when client returns ${missingValue}`, function () {
      FeatureFlags[fakeFlag] = "backup-value";
      clientVariationStub.withArgs(fakeFlag).returns(missingValue);

      const value = getFlagValue(fakeFlag);

      assert.strictEqual(value, "backup-value");
    });
  }

  it(`checkForExtensionDisabledReason() should return the GLOBAL_DISABLED_MESSAGE when ${FeatureFlag.GLOBAL_ENABLED}=false`, function () {
    // globally disabled
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = false;
    clientVariationStub.withArgs(FeatureFlag.GLOBAL_ENABLED).returns(false);

    const reason: string | undefined = checkForExtensionDisabledReason();

    assert.strictEqual(reason, GLOBAL_DISABLED_MESSAGE);
  });

  it(`checkForExtensionDisabledReason() should return undefined when ${FeatureFlag.GLOBAL_ENABLED}=true`, function () {
    // globally enabled, no versions disabled
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = [];
    clientVariationStub.withArgs(FeatureFlag.GLOBAL_ENABLED).returns(true);

    const reason: string | undefined = checkForExtensionDisabledReason();

    assert.strictEqual(reason, undefined);
  });

  it("checkForExtensionDisabledReason() should handle non-array GLOBAL_DISABLED_VERSIONS", function () {
    // globally enabled, weird disabled version format
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = "not-an-array";
    clientVariationStub.withArgs(FeatureFlag.GLOBAL_DISABLED_VERSIONS).returns("not-an-array");

    const reason: string | undefined = checkForExtensionDisabledReason();

    assert.strictEqual(reason, undefined);
  });

  it("checkForExtensionDisabledReason() should return a reason when a matching version is disabled", function () {
    // globally enabled, current version disabled
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    const disabledVersion: DisabledVersion = {
      product: env.uriScheme,
      extensionId: EXTENSION_ID,
      version: EXTENSION_VERSION,
      reason: fakeReason,
    };
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = [disabledVersion];

    const reason: string | undefined = checkForExtensionDisabledReason();

    assert.strictEqual(reason, disabledVersion.reason);
  });

  it("checkForExtensionDisabledReason() should return 'Unspecified reason' when disabled version has no reason", function () {
    // globally enabled, current version disabled but missing reason
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    const disabledVersion: any = {
      product: "vscode",
      extensionId: EXTENSION_ID,
      version: EXTENSION_VERSION,
    };
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = [disabledVersion];
    clientVariationStub.withArgs(FeatureFlag.GLOBAL_DISABLED_VERSIONS).returns([disabledVersion]);

    const reason: string | undefined = checkForExtensionDisabledReason();

    assert.strictEqual(reason, "Unspecified reason");
  });

  it("checkForExtensionDisabledReason() should not wait for initialization when client is undefined", function () {
    getLaunchDarklyClientStub.returns(undefined);

    const reason: string | undefined = checkForExtensionDisabledReason();

    // should still use default values from FeatureFlags
    assert.strictEqual(reason, undefined);
  });

  it("checkForExtensionDisabledReason() should ignore disabled versions with different product", function () {
    // globally enabled, some other product disabled
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    const disabledVersion: DisabledVersion = {
      product: "some-other-product",
      extensionId: EXTENSION_ID,
      version: EXTENSION_VERSION,
      reason: fakeReason,
    };
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = [disabledVersion];
    clientVariationStub.withArgs(FeatureFlag.GLOBAL_DISABLED_VERSIONS).returns([disabledVersion]);

    const reason: string | undefined = checkForExtensionDisabledReason();

    assert.strictEqual(reason, undefined);
  });

  it("checkForExtensionDisabledReason() should ignore disabled versions with different extension ID", function () {
    // globally enabled, some other extension ID disabled
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    const disabledVersion: DisabledVersion = {
      product: env.uriScheme,
      extensionId: "different.extension",
      version: EXTENSION_VERSION,
      reason: fakeReason,
    };
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = [disabledVersion];
    clientVariationStub.withArgs(FeatureFlag.GLOBAL_DISABLED_VERSIONS).returns([disabledVersion]);

    const reason: string | undefined = checkForExtensionDisabledReason();

    assert.strictEqual(reason, undefined);
  });

  it("checkForExtensionDisabledReason() should ignore disabled versions with different version", function () {
    // globally enabled, some other version disabled
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    const disabledVersion: DisabledVersion = {
      product: env.uriScheme,
      extensionId: EXTENSION_ID,
      version: "not-a-real-version",
      reason: fakeReason,
    };
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = [disabledVersion];
    clientVariationStub.withArgs(FeatureFlag.GLOBAL_DISABLED_VERSIONS).returns([disabledVersion]);

    const reason: string | undefined = checkForExtensionDisabledReason();

    assert.strictEqual(reason, undefined);
  });

  it("checkForExtensionDisabledReason() should ignore disabled version objects with missing/incorrect fields", async function () {
    // globally enabled, returned object isn't a DisabledVersion
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    const disabledVersion = {
      foo: "bar",
      baz: 123,
    };
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = [disabledVersion];
    clientVariationStub.withArgs(FeatureFlag.GLOBAL_DISABLED_VERSIONS).returns([disabledVersion]);

    const reason: string | undefined = checkForExtensionDisabledReason();

    assert.strictEqual(reason, undefined);
  });

  it("checkForExtensionDisabledReason() should handle unset feature flags", function () {
    // delete all "current" feature flags to simulate hitting the check before even the local
    // defaults are set
    for (const key of Object.keys(FEATURE_FLAG_DEFAULTS)) {
      delete FeatureFlags[key];
    }
    clientVariationStub.returns(undefined);

    const reason: string | undefined = checkForExtensionDisabledReason();

    assert.strictEqual(reason, undefined);
  });

  it("showExtensionDisabledNotification() should show an error notification for a provided reason", async function () {
    await showExtensionDisabledNotification(fakeReason);

    sinon.assert.calledOnce(showErrorMessageStub);
    sinon.assert.calledWithMatch(
      showErrorMessageStub,
      `Extension version "${EXTENSION_VERSION}" is disabled: ${fakeReason}`,
      "Update Extension",
    );
  });

  it("showExtensionDisabledNotification() should show an error notification with an 'Update Extension' button for a disabled version", async function () {
    // simulate the user clicking the "Update Extension" button
    showErrorMessageStub.resolves("Update Extension");

    await showExtensionDisabledNotification(fakeReason);

    sinon.assert.calledOnce(showErrorMessageStub);
    sinon.assert.calledWith(executeCommandStub, "workbench.extensions.view.show");
    sinon.assert.calledWith(
      executeCommandStub,
      "workbench.extensions.search",
      `@id:${EXTENSION_ID}`,
    );
  });

  it("showExtensionDisabledNotification() should not show update button for global disable", async function () {
    await showExtensionDisabledNotification(GLOBAL_DISABLED_MESSAGE);

    sinon.assert.calledOnceWithExactly(
      showErrorMessageStub,
      `Extension version "${EXTENSION_VERSION}" is disabled: ${GLOBAL_DISABLED_MESSAGE}`,
    );
  });

  it("showExtensionDisabledNotification() should show generic message when no reason is provided", async function () {
    await showExtensionDisabledNotification("");

    sinon.assert.calledOnce(showErrorMessageStub);
    sinon.assert.calledWithMatch(
      showErrorMessageStub,
      `Extension version "${EXTENSION_VERSION}" is disabled.`,
      "Update Extension",
    );
  });
});
