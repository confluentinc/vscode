import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { TEST_CCLOUD_ENVIRONMENT } from "../../tests/unit/testResources";
import {
  TEST_CCLOUD_FLINK_COMPUTE_POOL,
  TEST_CCLOUD_FLINK_COMPUTE_POOL_ID,
} from "../../tests/unit/testResources/flinkComputePool";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "../extensionSettings/constants";
import { CCloudResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import * as ccloud from "../sidecar/connections/ccloud";
import { FlinkLanguageClientManager } from "./flinkLanguageClientManager";

describe("FlinkLanguageClientManager", () => {
  let sandbox: sinon.SinonSandbox;
  let configStub: sinon.SinonStub;
  let hasCCloudAuthSessionStub: sinon.SinonStub;
  let flinkManager: FlinkLanguageClientManager;
  let ccloudLoaderStub: sinon.SinonStubbedInstance<CCloudResourceLoader>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    FlinkLanguageClientManager["instance"] = null;
    configStub = sandbox.stub(vscode.workspace, "getConfiguration");
    const configMock = {
      get: sandbox.stub(),
    };
    configStub.returns(configMock);
    hasCCloudAuthSessionStub = sandbox.stub(ccloud, "hasCCloudAuthSession");
    hasCCloudAuthSessionStub.returns(false);
    ccloudLoaderStub = getStubbedCCloudResourceLoader(sandbox);

    const pool: CCloudFlinkComputePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;
    const envWithPool: CCloudEnvironment = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      flinkComputePools: [pool],
    });
    ccloudLoaderStub.getEnvironments.resolves([envWithPool]);
    flinkManager = FlinkLanguageClientManager.getInstance();
  });

  afterEach(() => {
    sandbox.restore();
    FlinkLanguageClientManager["instance"] = null;
  });

  describe("validateFlinkSettings", () => {
    it("should return false when computePoolId is missing", async () => {
      // Set up mocks -> no default Flink settings set
      const configMock = {
        get: sandbox.stub(),
      };
      configMock.get.withArgs(FLINK_CONFIG_COMPUTE_POOL).returns("");
      configMock.get.withArgs(FLINK_CONFIG_DATABASE).returns("");
      configStub.returns(configMock);

      const result = await flinkManager.validateFlinkSettings(null);
      assert.strictEqual(result, false);
    });

    it("should return false when compute pool is invalid", async () => {
      // Set up mocks -> invalid default compute pool
      const configMock = {
        get: sandbox.stub(),
      };
      configMock.get.withArgs(FLINK_CONFIG_COMPUTE_POOL).returns("invalid-pool-id");
      configStub.returns(configMock);

      const result = await flinkManager.validateFlinkSettings("invalid-pool-id");
      assert.strictEqual(result, false);
    });

    it("should return true when compute pool is valid", async () => {
      // Set up mocks -> valid default compute pool
      const configMock = {
        get: sandbox.stub(),
      };
      configMock.get.withArgs(FLINK_CONFIG_COMPUTE_POOL).returns(TEST_CCLOUD_FLINK_COMPUTE_POOL_ID);
      configStub.returns(configMock);

      const result = await flinkManager.validateFlinkSettings(TEST_CCLOUD_FLINK_COMPUTE_POOL_ID);

      assert.strictEqual(result, true);
    });

    it("should check resources availability when compute pool is set", async () => {
      // Set up mocks to indicate valid default Flink settings
      const configMock = {
        get: sandbox.stub(),
      };
      configMock.get.withArgs(FLINK_CONFIG_COMPUTE_POOL).returns(TEST_CCLOUD_FLINK_COMPUTE_POOL_ID);
      configStub.returns(configMock);

      const result = await flinkManager.validateFlinkSettings(TEST_CCLOUD_FLINK_COMPUTE_POOL_ID);
      assert.strictEqual(result, true);
    });
  });
});
