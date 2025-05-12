import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { TEST_CCLOUD_ENVIRONMENT } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import * as contextValues from "../context/values";
import * as environmentsModule from "../graphql/environments";
import { CCloudResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "../preferences/constants";
import * as ccloud from "../sidecar/connections/ccloud";
import { FlinkConfigurationManager } from "./flinkConfigManager";

describe("FlinkConfigurationManager", () => {
  let sandbox: sinon.SinonSandbox;
  let configStub: sinon.SinonStub;
  let contextValueStub: sinon.SinonStub;
  let hasCCloudAuthSessionStub: sinon.SinonStub;
  let flinkManager: FlinkConfigurationManager;
  let ccloudLoaderStub: sinon.SinonStubbedInstance<CCloudResourceLoader>;
  let getEnvironmentsStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    FlinkConfigurationManager["instance"] = null;
    configStub = sandbox.stub(vscode.workspace, "getConfiguration");
    const configMock = {
      get: sandbox.stub(),
    };
    configStub.returns(configMock);
    contextValueStub = sandbox.stub(contextValues, "getContextValue");
    hasCCloudAuthSessionStub = sandbox.stub(ccloud, "hasCCloudAuthSession");
    hasCCloudAuthSessionStub.returns(false);

    ccloudLoaderStub = sandbox.createStubInstance(CCloudResourceLoader);
    sandbox.stub(CCloudResourceLoader, "getInstance").returns(ccloudLoaderStub);

    getEnvironmentsStub = sandbox.stub(environmentsModule, "getEnvironments");

    flinkManager = FlinkConfigurationManager.getInstance();
    sandbox.stub(flinkManager, "promptChooseDefaultComputePool" as any).resolves();
    sandbox.stub(flinkManager, "checkFlinkResourcesAvailability" as any).resolves();
  });
  afterEach(() => {
    sandbox.restore();
    FlinkConfigurationManager["instance"] = null;
  });

  describe("validateFlinkSettings", () => {
    it("should return false if Flink is disabled", async () => {
      contextValueStub.withArgs(contextValues.ContextValues.flinkEnabled).returns(false);
      const result = await flinkManager.validateFlinkSettings();

      // Verify only method called was check for Flink enabled status
      assert.strictEqual(contextValueStub.called, true);
      assert.strictEqual(configStub.called, false);
      assert.strictEqual(result, false);
    });

    it("should return false when computePoolId is missing", async () => {
      // Set up mocks -> Flink is enabled but no settings set
      contextValueStub.withArgs(contextValues.ContextValues.flinkEnabled).returns(true);
      const configMock = {
        get: sandbox.stub(),
      };
      configMock.get.withArgs(FLINK_CONFIG_COMPUTE_POOL).returns("");
      configMock.get.withArgs(FLINK_CONFIG_DATABASE).returns("");
      configStub.returns(configMock);

      const result = await flinkManager.validateFlinkSettings();
      assert.strictEqual(result, false);
    });

    it("should return false when compute pool is invalid", async () => {
      // Set up mocks -> Flink is enabled with invalid compute pool
      contextValueStub.withArgs(contextValues.ContextValues.flinkEnabled).returns(true);
      const configMock = {
        get: sandbox.stub(),
      };
      configMock.get.withArgs(FLINK_CONFIG_COMPUTE_POOL).returns("invalid-pool-id");
      configStub.returns(configMock);

      (flinkManager as any).checkFlinkResourcesAvailability.resolves(false);

      const result = await flinkManager.validateFlinkSettings();

      sinon.assert.calledOnceWithExactly(
        (flinkManager as any).checkFlinkResourcesAvailability,
        "invalid-pool-id",
      );
      assert.strictEqual(result, false);
    });

    it("should return true when compute pool is valid", async () => {
      // Set up mocks -> Flink is enabled with valid compute pool
      contextValueStub.withArgs(contextValues.ContextValues.flinkEnabled).returns(true);
      const configMock = {
        get: sandbox.stub(),
      };
      configMock.get.withArgs(FLINK_CONFIG_COMPUTE_POOL).returns("valid-pool-id");
      configStub.returns(configMock);
      (flinkManager as any).checkFlinkResourcesAvailability.resolves(true);

      const result = await flinkManager.validateFlinkSettings();

      sinon.assert.calledOnceWithExactly(
        (flinkManager as any).checkFlinkResourcesAvailability,
        "valid-pool-id",
      );
      assert.strictEqual(result, true);
    });

    it("should check resources availability when compute pool is set", async () => {
      // Set up mocks to indicate Flink is enabled with all settings
      contextValueStub.withArgs(contextValues.ContextValues.flinkEnabled).returns(true);
      const configMock = {
        get: sandbox.stub(),
      };
      configMock.get.withArgs(FLINK_CONFIG_COMPUTE_POOL).returns("test-pool-id");
      configStub.returns(configMock);
      (flinkManager as any).checkFlinkResourcesAvailability.resolves(true);

      const result = await flinkManager.validateFlinkSettings();

      sinon.assert.calledOnceWithExactly(
        (flinkManager as any).checkFlinkResourcesAvailability,
        "test-pool-id",
      );
      assert.strictEqual(result, true);
    });
  });

  describe("checkFlinkResourcesAvailability", () => {
    beforeEach(() => {
      // Restore the stub to test the actual implementation
      (flinkManager as any).checkFlinkResourcesAvailability.restore();

      // Create stub for lookupComputePoolInfo
      sandbox.stub(flinkManager as any, "lookupComputePoolInfo").resolves({
        organizationId: "test-org",
        environmentId: "test-env",
        region: "us-west-1",
        provider: "aws",
      });
    });

    it("should return false if no environments found", async () => {
      getEnvironmentsStub.resolves([]);

      const result = await (flinkManager as any).checkFlinkResourcesAvailability("test-pool-id");

      sinon.assert.calledOnce(getEnvironmentsStub);
      assert.strictEqual(result, false);
    });

    it("should return true if compute pool is found in environments", async () => {
      const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;
      const envWithPool: CCloudEnvironment = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [pool],
      });
      getEnvironmentsStub.resolves([envWithPool]);
      const result = await (flinkManager as any).checkFlinkResourcesAvailability(
        TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
      );

      sinon.assert.calledOnce(getEnvironmentsStub);
      assert.strictEqual(result, true);
    });

    it("should return false if compute pool is not found in any environment", async () => {
      getEnvironmentsStub.resolves([TEST_CCLOUD_ENVIRONMENT]);

      const result = await (flinkManager as any).checkFlinkResourcesAvailability("test-pool-id");

      sinon.assert.calledOnce(getEnvironmentsStub);
      assert.strictEqual(result, false);
    });

    it("should return false if error occurs during check", async () => {
      getEnvironmentsStub.rejects(new Error("Network error"));

      const result = await (flinkManager as any).checkFlinkResourcesAvailability("test-pool-id");

      sinon.assert.calledOnce(getEnvironmentsStub);
      assert.strictEqual(result, false);
    });
  });
});
