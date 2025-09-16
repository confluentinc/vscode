import * as assert from "assert";
import * as sinon from "sinon";
import {
  createWrappedCommand,
  getCommandArgsContext,
  registerCommandWithLogging,
  RESOURCE_ID_FIELDS,
} from ".";
import { ConnectionType } from "../clients/sidecar";
import * as errors from "../errors";
import * as featureFlags from "../featureFlags/evaluation";
import { ConnectionId, IResourceBase } from "../models/resource";
import * as notifications from "../notifications";
import * as telemetry from "../telemetry/events";
import { titleCase } from "../utils";

describe("commands/index.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("registerCommandWithLogging", () => {
    it("should throw if command name does not start with 'confluent.'", () => {
      assert.throws(() => {
        registerCommandWithLogging("not-a-valid-command", () => {});
      }, /must start with "confluent."/);
    });
  });

  describe("createWrappedCommand", () => {
    let showErrorNotificationWithButtonsStub: sinon.SinonStub;
    let checkForExtensionDisabledReasonStub: sinon.SinonStub;

    beforeEach(() => {
      checkForExtensionDisabledReasonStub = sandbox.stub(
        featureFlags,
        "checkForExtensionDisabledReason",
      );

      showErrorNotificationWithButtonsStub = sandbox.stub(
        notifications,
        "showErrorNotificationWithButtons",
      );

      // stub other dependencies to avoid side effects
      sandbox.stub(telemetry, "logUsage");
      sandbox.stub(errors, "logError");
    });

    it("should call showErrorNotificationWithButtons when async command rejects with Error", async () => {
      // set extension to be enabled by default
      checkForExtensionDisabledReasonStub.resolves(undefined);
      const testError = new Error("Async command failed");
      const asyncCommand = sandbox.stub().rejects(testError);
      const wrappedCommand = createWrappedCommand("confluent.test", asyncCommand);

      await wrappedCommand();

      sinon.assert.calledOnceWithExactly(
        showErrorNotificationWithButtonsStub,
        `Error invoking command "confluent.test": ${testError}`,
      );
    });

    it("should show extension disabled notification and not execute command when extension is disabled", async () => {
      // set extension to be disabled
      checkForExtensionDisabledReasonStub.resolves("Extension has been disabled due to policy");

      const showExtensionDisabledNotificationStub = sandbox.stub(
        featureFlags,
        "showExtensionDisabledNotification",
      );

      const mockCommand = sandbox.stub();
      const wrappedCommand = createWrappedCommand("confluent.test", mockCommand);

      await wrappedCommand();

      sinon.assert.calledOnce(checkForExtensionDisabledReasonStub);
      sinon.assert.calledOnceWithExactly(
        showExtensionDisabledNotificationStub,
        "Extension has been disabled due to policy",
      );
      sinon.assert.notCalled(mockCommand);
    });
  });

  describe("getCommandArgsContext", () => {
    it("should handle no args", () => {
      const result = getCommandArgsContext([]);

      assert.deepStrictEqual(result, {});
    });

    it("should handle undefined first arg", () => {
      const result = getCommandArgsContext([undefined]);

      assert.deepStrictEqual(result, {});
    });

    it("should include 'resourceConnectionType' when the first arg implements IResourceBase", () => {
      const fakeResource: IResourceBase = {
        connectionId: "abc123" as ConnectionId,
        connectionType: ConnectionType.Direct,
      };

      const result = getCommandArgsContext([fakeResource]);

      assert.deepStrictEqual(result, {
        resourceConnectionType: fakeResource.connectionType,
      });
    });

    for (const idField of RESOURCE_ID_FIELDS) {
      const expectedField = `resource${titleCase(idField)}`;

      it(`should include '${expectedField}' if '${idField}' exists on the first arg`, () => {
        const fakeResource = {
          [idField]: "abc123",
        };

        const result = getCommandArgsContext([fakeResource]);

        assert.deepStrictEqual(result, {
          [expectedField]: fakeResource[idField],
        });
      });
    }
  });
});
