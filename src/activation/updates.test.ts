import * as sinon from "sinon";
import * as constants from "../constants";
import { handleExtensionVersionUpdate } from "./updates";
import * as v1_4 from "./versions/v1_4";

describe("activation/updates.ts 1.4.x", () => {
  let sandbox: sinon.SinonSandbox;

  let showFlinkPreviewNotificationStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    showFlinkPreviewNotificationStub = sandbox
      .stub(v1_4, "showFlinkPreviewNotification")
      .resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  const versionsShowingNotifications: [string, boolean][] = [
    ["1.4.0", true],
    ["1.4.1", true],
    ["1.4.12345", true],
    ["1.4.10-abc123", true],
    ["1.3.0", false],
    ["1.40.0", false],
    ["1.5.0", false],
    ["2.0.0", false],
  ];
  for (const [version, shouldCall] of versionsShowingNotifications) {
    it(`handleNewOrUpdatedExtensionInstallation() should ${shouldCall ? "call" : "not call"} showFlinkPreviewNotification() when the current extension version is "${version}"`, async () => {
      sandbox.stub(constants, "EXTENSION_VERSION").value(version);

      await handleExtensionVersionUpdate();

      if (shouldCall) {
        sinon.assert.calledOnce(showFlinkPreviewNotificationStub);
      } else {
        sinon.assert.notCalled(showFlinkPreviewNotificationStub);
      }
    });
  }
});
