import * as sinon from "sinon";
import { commands, window } from "vscode";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { TEST_CCLOUD_ENVIRONMENT } from "../../tests/unit/testResources";
import { currentFlinkStatementsResourceChanged } from "../emitters";
import { CCLOUD_PRIVATE_NETWORK_ENDPOINTS } from "../extensionSettings/constants";
import * as notifications from "../notifications";
import * as envQuickpicks from "../quickpicks/environments";
import { FlinkStatementsViewProvider } from "../viewProviders/flinkStatements";
import * as envCommands from "./environments";

describe("commands/environments.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("setFlinkStatementsEnvironmentCommand()", () => {
    let flinkStatementsViewProvider: sinon.SinonStubbedInstance<FlinkStatementsViewProvider>;
    let flinkCcloudEnvironmentQuickPickStub: sinon.SinonStub;
    let currentFlinkStatementsResourceChangedStub: sinon.SinonStub;
    let executeCommandStub: sinon.SinonStub;

    beforeEach(() => {
      flinkStatementsViewProvider = sandbox.createStubInstance(FlinkStatementsViewProvider);
      flinkStatementsViewProvider.withProgress.callsFake(async (options, task) => await task());
      sandbox.stub(FlinkStatementsViewProvider, "getInstance").returns(flinkStatementsViewProvider);

      flinkCcloudEnvironmentQuickPickStub = sandbox
        .stub(envQuickpicks, "flinkCcloudEnvironmentQuickPick")
        .resolves();

      currentFlinkStatementsResourceChangedStub = sandbox.stub(
        currentFlinkStatementsResourceChanged,
        "fire",
      );

      executeCommandStub = sandbox.stub(commands, "executeCommand").resolves();
    });

    afterEach(() => {
      flinkStatementsViewProvider.dispose();
      sandbox.restore();
    });

    it("should show a (Flink) CCloud environment quickpick if no env is provided", async () => {
      // user chooses an environment from the quickpick
      flinkCcloudEnvironmentQuickPickStub.resolves(TEST_CCLOUD_ENVIRONMENT);

      await envCommands.setFlinkStatementsEnvironmentCommand();

      sinon.assert.calledOnce(flinkStatementsViewProvider.withProgress);
      sinon.assert.calledWith(
        flinkStatementsViewProvider.withProgress,
        "Select Environment",
        sinon.match.func,
      );

      sinon.assert.calledOnce(flinkCcloudEnvironmentQuickPickStub);
      sinon.assert.calledOnce(currentFlinkStatementsResourceChangedStub);
      sinon.assert.calledWith(currentFlinkStatementsResourceChangedStub, TEST_CCLOUD_ENVIRONMENT);
      sinon.assert.calledOnce(executeCommandStub);
      sinon.assert.calledWith(executeCommandStub, "confluent-flink-statements.focus");
    });

    it("should exit early if no environment is selected from the quickpick", async () => {
      // user cancels the quickpick
      flinkCcloudEnvironmentQuickPickStub.resolves(undefined);

      await envCommands.setFlinkStatementsEnvironmentCommand();

      sinon.assert.calledOnce(flinkStatementsViewProvider.withProgress);
      sinon.assert.calledWith(
        flinkStatementsViewProvider.withProgress,
        "Select Environment",
        sinon.match.func,
      );
      sinon.assert.calledOnce(flinkCcloudEnvironmentQuickPickStub);
      sinon.assert.notCalled(currentFlinkStatementsResourceChangedStub);
      sinon.assert.notCalled(executeCommandStub);
    });

    it("should skip the quickpick if a CCloud environment is passed", async () => {
      await envCommands.setFlinkStatementsEnvironmentCommand(TEST_CCLOUD_ENVIRONMENT);

      sinon.assert.notCalled(flinkStatementsViewProvider.withProgress);
      sinon.assert.notCalled(flinkCcloudEnvironmentQuickPickStub);
      sinon.assert.calledOnce(currentFlinkStatementsResourceChangedStub);
      sinon.assert.calledWith(currentFlinkStatementsResourceChangedStub, TEST_CCLOUD_ENVIRONMENT);
      sinon.assert.calledOnce(executeCommandStub);
      sinon.assert.calledWith(executeCommandStub, "confluent-flink-statements.focus");
    });
  });

  describe("setPrivateNetworkEndpointCommand()", () => {
    let ccloudEnvironmentQuickPickStub: sinon.SinonStub;
    let stubbedConfigs: StubbedWorkspaceConfiguration;
    let showInputBoxStub: sinon.SinonStub;
    let showInfoNotificationWithButtonsStub: sinon.SinonStub;

    const fakeEndpoints = "private.network.endpoint1,private.network.endpoint2";

    beforeEach(() => {
      ccloudEnvironmentQuickPickStub = sandbox
        .stub(envQuickpicks, "ccloudEnvironmentQuickPick")
        .resolves(TEST_CCLOUD_ENVIRONMENT);

      // no private network endpoints set by default
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
      stubbedConfigs.stubGet(CCLOUD_PRIVATE_NETWORK_ENDPOINTS, {});

      showInputBoxStub = sandbox.stub(window, "showInputBox").resolves(fakeEndpoints);

      showInfoNotificationWithButtonsStub = sandbox.stub(
        notifications,
        "showInfoNotificationWithButtons",
      );
    });

    it("should show a CCloud environment quickpick if no argument is provided", async () => {
      await envCommands.setPrivateNetworkEndpointCommand();

      sinon.assert.calledOnce(ccloudEnvironmentQuickPickStub);
    });

    it("should exit early if no environment is selected from the quickpick", async () => {
      ccloudEnvironmentQuickPickStub.resolves(undefined);

      await envCommands.setPrivateNetworkEndpointCommand();

      sinon.assert.calledOnce(ccloudEnvironmentQuickPickStub);
      sinon.assert.notCalled(showInputBoxStub);
      sinon.assert.notCalled(stubbedConfigs.update);
      sinon.assert.notCalled(showInfoNotificationWithButtonsStub);
    });

    it("should skip the quickpick if a CCloud environment is provided", async () => {
      await envCommands.setPrivateNetworkEndpointCommand(TEST_CCLOUD_ENVIRONMENT);

      sinon.assert.notCalled(ccloudEnvironmentQuickPickStub);
    });

    it("should show an input box to set private network endpoints", async () => {
      await envCommands.setPrivateNetworkEndpointCommand(TEST_CCLOUD_ENVIRONMENT);

      sinon.assert.calledOnce(showInputBoxStub);
      sinon.assert.calledOnceWithExactly(showInputBoxStub, {
        title: "Set Private Network Endpoint(s)",
        prompt: `Enter private network endpoint(s) for environment "${TEST_CCLOUD_ENVIRONMENT.name}" (${TEST_CCLOUD_ENVIRONMENT.id}), separated by commas.`,
        placeHolder: "endpoint1,endpoint2",
        value: sinon.match.string,
        ignoreFocusOut: true,
      });
    });

    it("should exit early if the user cancels the input box", async () => {
      // user cancels the input box
      showInputBoxStub.resolves(undefined);

      await envCommands.setPrivateNetworkEndpointCommand(TEST_CCLOUD_ENVIRONMENT);

      sinon.assert.calledOnce(showInputBoxStub);
      sinon.assert.notCalled(stubbedConfigs.update);
      sinon.assert.notCalled(showInfoNotificationWithButtonsStub);
    });

    it(`should update the "${CCLOUD_PRIVATE_NETWORK_ENDPOINTS.id}" setting and show a notification`, async () => {
      await envCommands.setPrivateNetworkEndpointCommand(TEST_CCLOUD_ENVIRONMENT);

      sinon.assert.calledOnce(stubbedConfigs.update);
      sinon.assert.calledWith(
        stubbedConfigs.update,
        CCLOUD_PRIVATE_NETWORK_ENDPOINTS.id,
        {
          [TEST_CCLOUD_ENVIRONMENT.id]: fakeEndpoints,
        },
        true,
      );

      sinon.assert.calledOnce(showInfoNotificationWithButtonsStub);
      sinon.assert.calledOnceWithMatch(
        showInfoNotificationWithButtonsStub,
        `Private network endpoint(s) for environment "${TEST_CCLOUD_ENVIRONMENT.name}" (${TEST_CCLOUD_ENVIRONMENT.id}) set to "${fakeEndpoints}"`,
        {
          ["Change For Environment"]: sinon.match.func,
          ["View Settings"]: sinon.match.func,
        },
      );
    });

    it(`should not replace existing endpoints for other environments when updating "${CCLOUD_PRIVATE_NETWORK_ENDPOINTS.id}"`, async () => {
      const existingEndpoints = {
        env1: "existing.endpoint1,existing.endpoint2",
      };
      stubbedConfigs.stubGet(CCLOUD_PRIVATE_NETWORK_ENDPOINTS, existingEndpoints);

      await envCommands.setPrivateNetworkEndpointCommand(TEST_CCLOUD_ENVIRONMENT);

      sinon.assert.calledOnce(stubbedConfigs.update);
      sinon.assert.calledWith(
        stubbedConfigs.update,
        CCLOUD_PRIVATE_NETWORK_ENDPOINTS.id,
        {
          ...existingEndpoints,
          [TEST_CCLOUD_ENVIRONMENT.id]: fakeEndpoints,
        },
        true,
      );
    });
  });
});
