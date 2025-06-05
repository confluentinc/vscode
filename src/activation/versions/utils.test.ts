import * as assert from "assert";
import * as sinon from "sinon";
import { workspace, WorkspaceConfiguration } from "vscode";
import {
  SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS,
  SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS_DEFAULT,
} from "../../extensionSettings/constants";
import { canShowNewOrUpdatedExtensionNotifications } from "./utils";

describe("activation/versions/utils.ts canShowNewOrUpdatedExtensionNotifications", () => {
  let sandbox: sinon.SinonSandbox;

  let getConfigStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    getConfigStub = sandbox.stub();
    sandbox.stub(workspace, "getConfiguration").returns({
      get: getConfigStub,
      update: sandbox.stub(),
      has: sandbox.stub(),
      inspect: sandbox.stub(),
    } as unknown as WorkspaceConfiguration);
  });

  afterEach(() => {
    sandbox.restore();
  });

  // user could edit settings.json for null, but undefined is harder to reproduce
  for (const settingValue of [true, undefined, null]) {
    it(`should return true when the "${SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS}" setting is set to ${settingValue}`, () => {
      getConfigStub
        .withArgs(
          SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS,
          SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS_DEFAULT,
        )
        .returns(settingValue);

      const result: boolean = canShowNewOrUpdatedExtensionNotifications();

      sinon.assert.calledOnceWithExactly(
        getConfigStub,
        SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS,
        true,
      );
      assert.strictEqual(result, true);
    });
  }

  it(`should return false when the "${SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS}" setting is set to false`, () => {
    getConfigStub
      .withArgs(
        SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS,
        SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS_DEFAULT,
      )
      .returns(false);

    const result: boolean = canShowNewOrUpdatedExtensionNotifications();

    sinon.assert.calledOnceWithExactly(
      getConfigStub,
      SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS,
      true,
    );
    assert.strictEqual(result, false);
  });
});
