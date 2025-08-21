import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import {
  ENABLE_FLINK_ARTIFACTS,
  FLINK_CONFIG_COMPUTE_POOL,
  FLINK_CONFIG_DATABASE,
} from "../extensionSettings/constants";
import * as quickpicks from "../quickpicks/flinkComputePools";
import * as kafkaQuickpicks from "../quickpicks/kafkaClusters";
import * as commandsModule from "./flinkComputePools";

describe("flinkComputePools.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("configureFlinkDefaults command", () => {
    let flinkComputePoolQuickPickStub: sinon.SinonStub;
    let flinkDatabaseQuickpickStub: sinon.SinonStub;
    let stubbedConfigs: StubbedWorkspaceConfiguration;
    let showInformationMessageStub: sinon.SinonStub;

    beforeEach(() => {
      flinkComputePoolQuickPickStub = sandbox.stub(quickpicks, "flinkComputePoolQuickPick");
      flinkDatabaseQuickpickStub = sandbox.stub(kafkaQuickpicks, "flinkDatabaseQuickpick");
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
      showInformationMessageStub = sandbox
        .stub(vscode.window, "showInformationMessage")
        .resolves(undefined);
    });

    it("should return early if no compute pool is selected", async () => {
      flinkComputePoolQuickPickStub.resolves(undefined);

      await commandsModule.configureFlinkDefaults();

      assert.ok(stubbedConfigs.update.notCalled);
      assert.ok(flinkDatabaseQuickpickStub.notCalled);
    });

    it("should update config and show info message after pool and database are selected", async () => {
      flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      flinkDatabaseQuickpickStub.resolves(TEST_CCLOUD_KAFKA_CLUSTER);

      await commandsModule.configureFlinkDefaults();

      sinon.assert.calledWithExactly(
        stubbedConfigs.update,
        FLINK_CONFIG_COMPUTE_POOL.id,
        TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
        true,
      );
      sinon.assert.calledWithExactly(
        stubbedConfigs.update,
        FLINK_CONFIG_DATABASE.id,
        TEST_CCLOUD_KAFKA_CLUSTER.id,
        true,
      );
      sinon.assert.calledOnce(showInformationMessageStub);
    });

    it("should open settings if user selects 'View' in info message", async () => {
      const pool = { id: "pool1" };
      const cluster = { name: "db1" };
      flinkComputePoolQuickPickStub.resolves(pool);
      flinkDatabaseQuickpickStub.resolves(cluster);
      showInformationMessageStub.resolves("View");
      const executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();

      await commandsModule.configureFlinkDefaults();

      assert.ok(
        executeCommandStub.calledWith(
          "workbench.action.openSettings",
          "@ext:confluentinc.vscode-confluent flink",
        ),
      );
    });
  });

  describe("selectPoolFromResourcesViewCommand", () => {
    let executeCommandStub: sinon.SinonStub;
    let stubbedConfigs: StubbedWorkspaceConfiguration;

    beforeEach(() => {
      executeCommandStub = sandbox.stub(vscode.commands, "executeCommand").resolves();
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
    });

    it("should invoke both statements and artifacts pool selection commands when Flink Artifacts is enabled", async () => {
      stubbedConfigs.stubGet(ENABLE_FLINK_ARTIFACTS, true);

      await commandsModule.selectPoolFromResourcesViewCommand(TEST_CCLOUD_FLINK_COMPUTE_POOL);

      sinon.assert.calledWith(
        executeCommandStub,
        "confluent.statements.flink-compute-pool.select",
        TEST_CCLOUD_FLINK_COMPUTE_POOL,
      );
      sinon.assert.calledWith(
        executeCommandStub,
        "confluent.artifacts.flink-compute-pool.select",
        TEST_CCLOUD_FLINK_COMPUTE_POOL,
      );
    });

    it("should only invoke statements pool selection command when Flink Artifacts is disabled", async () => {
      stubbedConfigs.stubGet(ENABLE_FLINK_ARTIFACTS, false);

      await commandsModule.selectPoolFromResourcesViewCommand(TEST_CCLOUD_FLINK_COMPUTE_POOL);

      sinon.assert.calledWith(
        executeCommandStub,
        "confluent.statements.flink-compute-pool.select",
        TEST_CCLOUD_FLINK_COMPUTE_POOL,
      );
      sinon.assert.neverCalledWith(
        executeCommandStub,
        "confluent.artifacts.flink-compute-pool.select",
        TEST_CCLOUD_FLINK_COMPUTE_POOL,
      );
    });
  });
});
