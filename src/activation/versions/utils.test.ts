import * as assert from "assert";
import * as sinon from "sinon";
import { StubbedWorkspaceConfiguration } from "../../../tests/stubs/workspaceConfiguration";
import { SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS } from "../../extensionSettings/constants";
import { canShowNewOrUpdatedExtensionNotifications } from "./utils";

describe("activation/versions/utils.ts canShowNewOrUpdatedExtensionNotifications", () => {
  let sandbox: sinon.SinonSandbox;

  let stubbedConfigs: StubbedWorkspaceConfiguration;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  // user could edit settings.json for null, but undefined is harder to reproduce
  for (const settingValue of [true, undefined, null]) {
    it(`should return true when the "${SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS.id}" setting is set to ${settingValue}`, () => {
      stubbedConfigs.configure({
        [SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS.id]: settingValue,
      });

      const result: boolean = canShowNewOrUpdatedExtensionNotifications();

      sinon.assert.calledOnceWithExactly(
        stubbedConfigs.get,
        SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS.id,
        true,
      );
      assert.strictEqual(result, true);
    });
  }

  it(`should return false when the "${SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS.id}" setting is set to false`, () => {
    stubbedConfigs.configure({
      [SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS.id]: false,
    });

    const result: boolean = canShowNewOrUpdatedExtensionNotifications();

    sinon.assert.calledOnceWithExactly(
      stubbedConfigs.get,
      SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS.id,
      true,
    );
    assert.strictEqual(result, false);
  });
});
