import * as assert from "assert";
import * as sinon from "sinon";
import { commands, env, window } from "vscode";
import { EXTENSION_ID, EXTENSION_VERSION } from "../constants";
import * as clientModule from "./client";
import {
  FEATURE_FLAG_DEFAULTS,
  FeatureFlag,
  FeatureFlags,
  GLOBAL_DISABLED_MESSAGE,
} from "./constants";
import * as enablement from "./enablement";
import { DisabledVersion } from "./types";

const fakeReason = "TEST TEST TEST This version isn't enabled. TEST TEST TEST";

describe("featureFlags/enablement.ts", function () {
  let sandbox: sinon.SinonSandbox;

  let getLaunchDarklyClientStub: sinon.SinonStub;
  let showErrorMessageStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // vscode stubs
    executeCommandStub = sandbox.stub(commands, "executeCommand");
    showErrorMessageStub = sandbox.stub(window, "showErrorMessage").resolves();

    // stub the call to get the client; we don't care about the return value for these tests
    getLaunchDarklyClientStub = sandbox.stub(clientModule, "getLaunchDarklyClient");

    // reset feature flags before each test
    clientModule.setFlagDefaults();
  });

  afterEach(function () {
    // reset feature flags after each test
    clientModule.setFlagDefaults();

    sandbox.restore();
  });

  it("checkForExtensionDisabledReason() should call getLaunchDarklyClient() to (re)try client initialization", async function () {
    await enablement.checkForExtensionDisabledReason();

    sinon.assert.calledOnce(getLaunchDarklyClientStub);
  });

  it(`checkForExtensionDisabledReason() should return the GLOBAL_DISABLED_MESSAGE when ${FeatureFlag.GLOBAL_ENABLED}=false`, async function () {
    // globally disabled
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = false;

    const reason: string | undefined = await enablement.checkForExtensionDisabledReason();

    assert.strictEqual(reason, GLOBAL_DISABLED_MESSAGE);
  });

  it(`checkForExtensionDisabledReason() should return undefined when ${FeatureFlag.GLOBAL_ENABLED}=true`, async function () {
    // globally enabled, no versions disabled
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = [];

    const reason: string | undefined = await enablement.checkForExtensionDisabledReason();

    assert.strictEqual(reason, undefined);
  });

  it("checkForExtensionDisabledReason() should return a reason when a matching version is disabled", async function () {
    // globally enabled, current version disabled
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    const disabledVersion: DisabledVersion = {
      product: env.uriScheme,
      extensionId: EXTENSION_ID,
      version: EXTENSION_VERSION,
      reason: fakeReason,
    };
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = [disabledVersion];

    const reason: string | undefined = await enablement.checkForExtensionDisabledReason();

    assert.ok(reason);
    assert.strictEqual(reason, disabledVersion.reason);
  });

  it("checkForExtensionDisabledReason() should return 'Unspecified reason' when disabled version has no reason", async function () {
    // globally enabled, current version disabled but missing reason
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    const disabledVersion: any = {
      product: "vscode",
      extensionId: EXTENSION_ID,
      version: EXTENSION_VERSION,
    };
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = [disabledVersion];

    const reason: string | undefined = await enablement.checkForExtensionDisabledReason();

    assert.ok(reason);
    assert.strictEqual(reason, "Unspecified reason");
  });

  it("checkForExtensionDisabledReason() should not wait for initialization when client is undefined", async function () {
    getLaunchDarklyClientStub.returns(undefined);

    const reason: string | undefined = await enablement.checkForExtensionDisabledReason();

    // should still use default values from FeatureFlags
    assert.strictEqual(reason, undefined);
  });

  it("checkForExtensionDisabledReason() should ignore disabled versions with different product", async function () {
    // globally enabled, some other product disabled
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    const disabledVersion: DisabledVersion = {
      product: "some-other-product",
      extensionId: EXTENSION_ID,
      version: EXTENSION_VERSION,
      reason: fakeReason,
    };
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = [disabledVersion];

    const reason: string | undefined = await enablement.checkForExtensionDisabledReason();

    assert.strictEqual(reason, undefined);
  });

  it("checkForExtensionDisabledReason() should ignore disabled versions with different extension ID", async function () {
    // globally enabled, some other extension ID disabled
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    const disabledVersion: DisabledVersion = {
      product: env.uriScheme,
      extensionId: "different.extension",
      version: EXTENSION_VERSION,
      reason: fakeReason,
    };
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = [disabledVersion];

    const reason: string | undefined = await enablement.checkForExtensionDisabledReason();

    assert.strictEqual(reason, undefined);
  });

  it("checkForExtensionDisabledReason() should ignore disabled versions with different version", async function () {
    // globally enabled, some other version disabled
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    const disabledVersion: DisabledVersion = {
      product: env.uriScheme,
      extensionId: EXTENSION_ID,
      version: "not-a-real-version",
      reason: fakeReason,
    };
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = [disabledVersion];

    const reason: string | undefined = await enablement.checkForExtensionDisabledReason();

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

    const reason: string | undefined = await enablement.checkForExtensionDisabledReason();

    assert.strictEqual(reason, undefined);
  });

  it("checkForExtensionDisabledReason() should handle unset feature flags", async function () {
    // delete all "current" feature flags to simulate hitting the check before even the local
    // defaults are set
    for (const key of Object.keys(FEATURE_FLAG_DEFAULTS)) {
      delete FeatureFlags[key];
    }

    const reason: string | undefined = await enablement.checkForExtensionDisabledReason();

    assert.strictEqual(reason, undefined);
  });

  it("showExtensionDisabledNotification() should show an error notification for a provided reason", async function () {
    await enablement.showExtensionDisabledNotification(fakeReason);

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

    await enablement.showExtensionDisabledNotification(fakeReason);

    sinon.assert.calledOnce(showErrorMessageStub);
    sinon.assert.calledWith(executeCommandStub, "workbench.extensions.view.show");
    sinon.assert.calledWith(
      executeCommandStub,
      "workbench.extensions.search",
      `@id:${EXTENSION_ID}`,
    );
  });

  it("showExtensionDisabledNotification() should not show update button for global disable", async function () {
    await enablement.showExtensionDisabledNotification(GLOBAL_DISABLED_MESSAGE);

    sinon.assert.calledOnceWithExactly(
      showErrorMessageStub,
      `Extension version "${EXTENSION_VERSION}" is disabled: ${GLOBAL_DISABLED_MESSAGE}`,
    );
  });

  it("showExtensionDisabledNotification() should show generic message when no reason is provided", async function () {
    await enablement.showExtensionDisabledNotification("");

    sinon.assert.calledOnce(showErrorMessageStub);
    sinon.assert.calledWithMatch(
      showErrorMessageStub,
      `Extension version "${EXTENSION_VERSION}" is disabled.`,
      "Update Extension",
    );
  });
});
