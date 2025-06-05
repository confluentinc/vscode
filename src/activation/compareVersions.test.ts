import * as sinon from "sinon";
import { getStubbedGlobalState, StubbedGlobalState } from "../../tests/stubs/extensionStorage";
import * as constants from "../constants";
import { GlobalStorageKeys } from "../storage/constants";
import { handleNewOrUpdatedExtensionInstallation } from "./compareVersions";
import * as updates from "./updates";

describe("activation/compareVersions.ts", () => {
  let sandbox: sinon.SinonSandbox;

  let stubbedGlobalState: StubbedGlobalState;
  let handleExtensionVersionUpdateStub: sinon.SinonSpy;
  let extensionVersionStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // vscode stubs
    stubbedGlobalState = getStubbedGlobalState(sandbox);

    handleExtensionVersionUpdateStub = sandbox.spy(updates, "handleExtensionVersionUpdate");
    // use current/default EXTENSION_VERSION from constants for most tests
    extensionVersionStub = sandbox
      .stub(constants, "EXTENSION_VERSION")
      .value(constants.EXTENSION_VERSION);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("handleNewOrUpdatedExtensionInstallation() should handle new extension installation (no previous version in storage)", async () => {
    stubbedGlobalState.get
      .withArgs(GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION)
      .resolves(undefined);
    // extensionVersionStub already returns EXTENSION_VERSION by default

    await handleNewOrUpdatedExtensionInstallation();

    sinon.assert.calledOnceWithExactly(
      stubbedGlobalState.get,
      GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION,
    );
    sinon.assert.calledOnceWithExactly(
      stubbedGlobalState.update,
      GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION,
      constants.EXTENSION_VERSION,
    );
    // undefined != current version, so we're handling an update (until we maybe change the behavior
    // to have dedicated new-installation handling)
    sinon.assert.calledOnce(handleExtensionVersionUpdateStub);
  });

  it("handleNewOrUpdatedExtensionInstallation() should handle version upgrades", async () => {
    // upgrade from 1.4.0 to 1.5.0
    stubbedGlobalState.get
      .withArgs(GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION)
      .resolves("1.4.0");
    extensionVersionStub.value("1.5.0");

    await handleNewOrUpdatedExtensionInstallation();

    sinon.assert.calledOnceWithExactly(
      stubbedGlobalState.get,
      GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION,
    );
    sinon.assert.calledOnceWithExactly(
      stubbedGlobalState.update,
      GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION,
      constants.EXTENSION_VERSION,
    );
    sinon.assert.calledOnce(handleExtensionVersionUpdateStub);
  });

  it("handleNewOrUpdatedExtensionInstallation() should handle version downgrades", async () => {
    // downgrade from 1.5.0 to 1.4.0
    stubbedGlobalState.get
      .withArgs(GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION)
      .resolves("1.5.0");
    extensionVersionStub.value("1.4.0");

    await handleNewOrUpdatedExtensionInstallation();

    sinon.assert.calledOnceWithExactly(
      stubbedGlobalState.get,
      GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION,
    );
    sinon.assert.calledOnceWithExactly(
      stubbedGlobalState.update,
      GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION,
      constants.EXTENSION_VERSION,
    );
    sinon.assert.calledOnce(handleExtensionVersionUpdateStub);
  });

  it("handleNewOrUpdatedExtensionInstallation() should not trigger update handling when version has not changed", async () => {
    stubbedGlobalState.get
      .withArgs(GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION)
      .resolves(constants.EXTENSION_VERSION);
    // extensionVersionStub already returns EXTENSION_VERSION by default

    await handleNewOrUpdatedExtensionInstallation();

    sinon.assert.calledOnceWithExactly(
      stubbedGlobalState.get,
      GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION,
    );
    sinon.assert.calledOnceWithExactly(
      stubbedGlobalState.update,
      GlobalStorageKeys.LAST_ACTIVATED_EXTENSION_VERSION,
      constants.EXTENSION_VERSION,
    );
    sinon.assert.notCalled(handleExtensionVersionUpdateStub);
  });
});
