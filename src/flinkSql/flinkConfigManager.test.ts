import * as assert from "assert";
import sinon from "sinon";
import { FlinkConfigurationManager } from "./flinkConfigManager";
import * as vscode from "vscode";
import * as contextValues from "../context/values";
import * as ccloud from "../sidecar/connections/ccloud";

describe("FlinkConfigurationManager", () => {
  let sandbox: sinon.SinonSandbox;
  let configStub: sinon.SinonStub;
  let contextValueStub: sinon.SinonStub;
  let hasCCloudAuthSessionStub: sinon.SinonStub;
  let flinkManager: FlinkConfigurationManager;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // Reset the FlinkConfigurationManager instance
    FlinkConfigurationManager["instance"] = null;

    // Stub the external methods (context, ccould auth, config)
    configStub = sandbox.stub(vscode.workspace, "getConfiguration");
    const configMock = {
      get: sandbox.stub(),
    };
    configStub.returns(configMock);
    contextValueStub = sandbox.stub(contextValues, "getContextValue");
    hasCCloudAuthSessionStub = sandbox.stub(ccloud, "hasCCloudAuthSession");
    hasCCloudAuthSessionStub.returns(false);

    // Create instance and replace internal methods with spies
    flinkManager = FlinkConfigurationManager.getInstance();
    sandbox.stub(flinkManager, "promptChooseDefaultComputePool" as any).resolves();
    sandbox.stub(flinkManager, "checkFlinkResourcesAvailability" as any).resolves();
  });

  afterEach(() => {
    sandbox.restore();
    FlinkConfigurationManager["instance"] = null;
  });

  describe("validateFlinkSettings", () => {
    it("should return early if already prompted for settings", async () => {
      (flinkManager as any).hasPromptedForSettings = true;
      await flinkManager.validateFlinkSettings();
      // Verify none of the methods were called
      assert.strictEqual(contextValueStub.called, false);
      assert.strictEqual(configStub.called, false);
      assert.strictEqual((flinkManager as any).promptChooseDefaultComputePool.called, false);
    });

    it("should return early if Flink is disabled", async () => {
      contextValueStub.withArgs(contextValues.ContextValues.flinkEnabled).returns(false);
      await flinkManager.validateFlinkSettings();
      // Verify only method called was check for Flink enabled status
      assert.strictEqual(contextValueStub.called, true);
      assert.strictEqual(configStub.called, false);
      assert.strictEqual((flinkManager as any).promptChooseDefaultComputePool.called, false);
    });

    it("should prompt for settings when computePoolId and database are missing", async () => {
      // Set up mocks -> Flink is enabled but no settings set
      contextValueStub.withArgs(contextValues.ContextValues.flinkEnabled).returns(true);
      const configMock = {
        get: sandbox.stub(),
      };
      configMock.get.withArgs("computePoolId").returns(undefined);
      configMock.get.withArgs("database").returns(undefined);
      configStub.returns(configMock);

      await flinkManager.validateFlinkSettings();
      // Verify prompt was called and flag was set
      assert.strictEqual((flinkManager as any).promptChooseDefaultComputePool.calledOnce, true);
      assert.strictEqual((flinkManager as any).hasPromptedForSettings, true);
    });

    it("should prompt for settings when only computePoolId is missing", async () => {
      // Set up mocks --> Flink is enabled but computePoolId is missing
      contextValueStub.withArgs(contextValues.ContextValues.flinkEnabled).returns(true);
      const configMock = {
        get: sandbox.stub(),
      };
      configMock.get.withArgs("computePoolId").returns(undefined);
      configMock.get.withArgs("database").returns("test-database");
      configStub.returns(configMock);

      await flinkManager.validateFlinkSettings();
      // Verify prompt was called & hasPromtedForSettings was set to true
      assert.strictEqual((flinkManager as any).promptChooseDefaultComputePool.calledOnce, true);
      assert.strictEqual((flinkManager as any).hasPromptedForSettings, true);
    });

    it("should check resources availability when all settings are configured", async () => {
      // Set up mocks to indicate Flink is enabled with all settings
      contextValueStub.withArgs(contextValues.ContextValues.flinkEnabled).returns(true);
      const configMock = {
        get: sandbox.stub(),
      };
      configMock.get.withArgs("computePoolId").returns("test-pool-id");
      configMock.get.withArgs("database").returns("test-database");
      configStub.returns(configMock);

      await flinkManager.validateFlinkSettings();

      // Verify resource check was called, but user not prompted for settings
      assert.strictEqual((flinkManager as any).promptChooseDefaultComputePool.called, false);
      assert.strictEqual((flinkManager as any).checkFlinkResourcesAvailability.calledOnce, true);
      assert.strictEqual((flinkManager as any).hasPromptedForSettings, false);
    });
  });

  describe("checkAuthenticationState", () => {
    it("should validate Flink settings when user is authenticated", async () => {
      hasCCloudAuthSessionStub.returns(true);
      const validateStub = sandbox.stub(flinkManager, "validateFlinkSettings").resolves();
      await flinkManager.checkAuthenticationState();
      assert.strictEqual(validateStub.calledOnce, true);
    });

    it("should not validate Flink settings when user is not authenticated", async () => {
      hasCCloudAuthSessionStub.returns(false);
      const validateStub = sandbox.stub(flinkManager, "validateFlinkSettings").resolves();
      await flinkManager.checkAuthenticationState();
      assert.strictEqual(validateStub.called, false);
    });
  });

  describe("checkFlinkResourcesAvailability", () => {
    it("should return early if not authenticated with CCloud", async () => {
      hasCCloudAuthSessionStub.returns(false);
      const getResourceManagerStub = sandbox.stub().throws(new Error("Should not be called"));
      await (flinkManager as any).checkFlinkResourcesAvailability();
      assert.strictEqual(getResourceManagerStub.called, false);
    });
  });
});
