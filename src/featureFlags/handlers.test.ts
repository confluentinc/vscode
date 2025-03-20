import * as assert from "assert";
import { LDElectronMainClient, LDFlagChangeset, LDFlagSet } from "launchdarkly-electron-client-sdk";
import * as sinon from "sinon";
import { env } from "vscode";
import { EXTENSION_ID, EXTENSION_VERSION } from "../constants";
import * as clientModule from "./client";
import { FEATURE_FLAG_DEFAULTS, FeatureFlag, FeatureFlags } from "./constants";
import * as handlers from "./handlers";
import { DisabledVersion } from "./types";

describe("featureFlags/handlers", function () {
  let sandbox: sinon.SinonSandbox;

  let stubbedLDClient: sinon.SinonStubbedInstance<LDElectronMainClient>;
  let clientOnStub: sinon.SinonStub;
  let clientVariationStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // stub the LD client and methods we care about for this module
    clientOnStub = sandbox.stub();
    clientVariationStub = sandbox.stub();
    stubbedLDClient = {
      on: clientOnStub,
      variation: clientVariationStub,
    } as unknown as sinon.SinonStubbedInstance<LDElectronMainClient>;

    // reset feature flags before each test
    clientModule.setFlagDefaults();
  });

  afterEach(function () {
    // reset feature flags after each test
    clientModule.setFlagDefaults();
    sandbox.restore();
  });

  it("setEventListeners() should register all required event handlers", function () {
    handlers.setEventListeners(stubbedLDClient);

    sinon.assert.callCount(clientOnStub, 4); // ready, failed, error, change
    // unfortunately we can't assert that `handleClientReady` since it's using an arrow function, but
    // the other tests should cover it
    sinon.assert.calledWith(clientOnStub, "ready", sinon.match.func);
    sinon.assert.calledWith(clientOnStub, "failed", sinon.match.func);
    sinon.assert.calledWith(clientOnStub, "error", sinon.match.func);
    sinon.assert.calledWith(clientOnStub, "change", handlers.handleFlagChanges);
  });

  it("handleClientReady() should update FeatureFlags with values from client.variation", async function () {
    // simulate the client.variation method returning specific values from the LD stream
    const fakeFlags: LDFlagSet = {
      [FeatureFlag.GLOBAL_ENABLED]: false,
      [FeatureFlag.GLOBAL_DISABLED_VERSIONS]: [
        { product: "test", extensionId: "test.id", version: "1.0.0", reason: "test" },
      ],
      [FeatureFlag.GLOBAL_NOTICES]: ["Test notice"],
      [FeatureFlag.SEGMENT_ENABLE]: false,
      [FeatureFlag.CCLOUD_ENABLE]: false,
      "some.other.flag": "some-other-value",
    };
    clientVariationStub.callsFake((key) => fakeFlags[key]);

    await handlers.handleClientReady(stubbedLDClient);

    // client.variation should've been called for each flag we care about, and the values should
    // match the fake flags
    Object.keys(FEATURE_FLAG_DEFAULTS).forEach((flag) => {
      sinon.assert.calledWith(clientVariationStub, flag);
      assert.deepStrictEqual(FeatureFlags[flag], fakeFlags[flag]);
    });
    // but unrelated flags are skipped
    sinon.assert.neverCalledWith(clientVariationStub, "some.other.flag");
  });

  it("handleClientReady() should use local defaults when client.variation returns null", async function () {
    // simulate the LD stream returning null for all flags, for some reason
    clientVariationStub.returns(null);

    await handlers.handleClientReady(stubbedLDClient);

    // we should fall back to the local defaults
    Object.entries(FEATURE_FLAG_DEFAULTS).forEach(([key, value]) => {
      assert.deepStrictEqual(FeatureFlags[key], value);
    });
  });

  it("handleClientReady() should handle a mix of server and default values", async function () {
    // simulate the client.variation method returning specific values from the LD stream
    // ...except this time, some of them are nullish
    const fakeFlags: LDFlagSet = {
      [FeatureFlag.GLOBAL_ENABLED]: null,
      [FeatureFlag.GLOBAL_DISABLED_VERSIONS]: [
        { product: "test", extensionId: "test.id", version: "1.0.0", reason: "test" },
      ],
      [FeatureFlag.GLOBAL_NOTICES]: null,
      [FeatureFlag.SEGMENT_ENABLE]: false,
      [FeatureFlag.CCLOUD_ENABLE]: null,
    };
    clientVariationStub.callsFake((key) => fakeFlags[key]);

    await handlers.handleClientReady(stubbedLDClient);

    // nullish values should fall back to the local defaults
    assert.strictEqual(
      FeatureFlags[FeatureFlag.GLOBAL_ENABLED],
      FEATURE_FLAG_DEFAULTS[FeatureFlag.GLOBAL_ENABLED],
    );
    assert.deepStrictEqual(
      FeatureFlags[FeatureFlag.GLOBAL_NOTICES],
      FEATURE_FLAG_DEFAULTS[FeatureFlag.GLOBAL_NOTICES],
    );
    assert.strictEqual(
      FeatureFlags[FeatureFlag.CCLOUD_ENABLE],
      FEATURE_FLAG_DEFAULTS[FeatureFlag.CCLOUD_ENABLE],
    );

    // but the values from the LD stream should still be used for the rest
    assert.deepStrictEqual(
      FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS],
      fakeFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS],
    );
    assert.strictEqual(
      FeatureFlags[FeatureFlag.SEGMENT_ENABLE],
      fakeFlags[FeatureFlag.SEGMENT_ENABLE],
    );
  });

  it("handleFlagChanges() should update tracked flags with new values", async function () {
    // initial flag values
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    FeatureFlags[FeatureFlag.SEGMENT_ENABLE] = true;

    const fakeChanges: LDFlagChangeset = {
      [FeatureFlag.GLOBAL_ENABLED]: {
        current: false,
        previous: true,
      },
      [FeatureFlag.SEGMENT_ENABLE]: {
        current: false,
        previous: true,
      },
    };
    await handlers.handleFlagChanges(fakeChanges);

    // verify the flags were updated based on the "current" changeset
    assert.strictEqual(
      FeatureFlags[FeatureFlag.GLOBAL_ENABLED],
      fakeChanges[FeatureFlag.GLOBAL_ENABLED].current,
    );
    assert.strictEqual(
      FeatureFlags[FeatureFlag.SEGMENT_ENABLE],
      fakeChanges[FeatureFlag.SEGMENT_ENABLE].current,
    );
  });

  it("handleFlagChanges() should ignore changes for untracked flags", async function () {
    // some other flag change we don't care about
    const fakeChanges: LDFlagChangeset = {
      "untracked.flag": {
        current: "new value",
        previous: "old value",
      },
    };

    await handlers.handleFlagChanges(fakeChanges);

    // no changes should be applied to the current FeatureFlags (and since we reset to the defaults
    // between tests, it should jive with the defaults)
    assert.deepStrictEqual(FeatureFlags, FEATURE_FLAG_DEFAULTS);
  });

  it("handleFlagChanges() should handle nested object changes", async function () {
    // initial disabled version
    const previousDisabledVersions: DisabledVersion[] = [
      {
        product: env.uriScheme,
        extensionId: EXTENSION_ID,
        version: EXTENSION_VERSION,
        reason: "test",
      },
    ];
    FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS] = previousDisabledVersions;

    // new disabled version added
    const currentDisabledVersions: DisabledVersion[] = [
      ...previousDisabledVersions,
      {
        product: env.uriScheme,
        extensionId: EXTENSION_ID,
        version: "111.222.333",
        reason: "new version",
      },
    ];
    const fakeChanges: LDFlagChangeset = {
      [FeatureFlag.GLOBAL_DISABLED_VERSIONS]: {
        current: currentDisabledVersions,
        previous: previousDisabledVersions,
      },
    };
    await handlers.handleFlagChanges(fakeChanges);

    assert.deepStrictEqual(
      FeatureFlags[FeatureFlag.GLOBAL_DISABLED_VERSIONS],
      currentDisabledVersions,
    );
  });

  it("handleFlagChanges() should process multiple flag changes in a single event", async function () {
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;
    FeatureFlags[FeatureFlag.SEGMENT_ENABLE] = true;
    FeatureFlags[FeatureFlag.CCLOUD_ENABLE] = true;

    // change event with multiple flag updates to flip the boolean values
    const fakeChanges: LDFlagChangeset = {
      [FeatureFlag.GLOBAL_ENABLED]: {
        current: !FeatureFlags[FeatureFlag.GLOBAL_ENABLED],
        previous: FeatureFlags[FeatureFlag.GLOBAL_ENABLED],
      },
      [FeatureFlag.SEGMENT_ENABLE]: {
        current: !FeatureFlags[FeatureFlag.SEGMENT_ENABLE],
        previous: FeatureFlags[FeatureFlag.SEGMENT_ENABLE],
      },
      [FeatureFlag.CCLOUD_ENABLE]: {
        current: !FeatureFlags[FeatureFlag.CCLOUD_ENABLE],
        previous: FeatureFlags[FeatureFlag.CCLOUD_ENABLE],
      },
    };
    await handlers.handleFlagChanges(fakeChanges);

    assert.strictEqual(
      FeatureFlags[FeatureFlag.GLOBAL_ENABLED],
      fakeChanges[FeatureFlag.GLOBAL_ENABLED].current,
    );
    assert.strictEqual(
      FeatureFlags[FeatureFlag.SEGMENT_ENABLE],
      fakeChanges[FeatureFlag.SEGMENT_ENABLE].current,
    );
    assert.strictEqual(
      FeatureFlags[FeatureFlag.CCLOUD_ENABLE],
      fakeChanges[FeatureFlag.CCLOUD_ENABLE].current,
    );
  });

  it("handleFlagChanges() should handle a mix of tracked and untracked flag changes", async function () {
    FeatureFlags[FeatureFlag.GLOBAL_ENABLED] = true;

    const fakeChanges: LDFlagChangeset = {
      [FeatureFlag.GLOBAL_ENABLED]: {
        current: false,
        previous: true,
      },
      "untracked.flag": {
        current: "new value",
        previous: "old value",
      },
    };
    await handlers.handleFlagChanges(fakeChanges);

    // only tracked flag should be updated
    assert.strictEqual(FeatureFlags[FeatureFlag.GLOBAL_ENABLED], false);
    // untracked flag shouldn't even exist in FeatureFlags
    assert.strictEqual(FeatureFlags["untracked.flag"], undefined);
  });
});
