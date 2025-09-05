import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "../extensionSettings/constants";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import * as quickpicks from "../quickpicks/flinkComputePools";
import * as kafkaQuickpicks from "../quickpicks/kafkaClusters";
import * as flinkStatementsViewModule from "../viewProviders/flinkStatements";
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

  describe("selectPoolForStatementsViewCommand", () => {
    let flinkComputePoolQuickPickWithViewProgressStub: sinon.SinonStub;
    let fakeFlinkStatementsViewProvider: {
      computePool: CCloudFlinkComputePool | null;
      setParentResource: sinon.SinonStub;
    };

    beforeEach(() => {
      flinkComputePoolQuickPickWithViewProgressStub = sandbox.stub(
        quickpicks,
        "flinkComputePoolQuickPickWithViewProgress",
      );

      sandbox.stub(vscode.commands, "executeCommand").resolves();

      // stub FlinkStatementsViewProvider.getInstance()
      fakeFlinkStatementsViewProvider = {
        computePool: null,
        setParentResource: sandbox.stub().resolves(),
      };

      sandbox
        .stub(flinkStatementsViewModule.FlinkStatementsViewProvider, "getInstance")
        .returns(fakeFlinkStatementsViewProvider as any);
    });

    const testCases: Array<[string, any]> = [
      ["undefined", undefined],
      ["a FlinkStatement instance", createFlinkStatement()],
    ];
    for (const [description, param] of testCases) {
      it(`should call flinkComputePoolQuickPickWithViewProgress when passed something not a pool: ${description}`, async () => {
        const testPool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

        flinkComputePoolQuickPickWithViewProgressStub.resolves(testPool);

        await commandsModule.selectPoolForStatementsViewCommand(param);

        sinon.assert.calledOnce(flinkComputePoolQuickPickWithViewProgressStub);
        sinon.assert.calledWith(fakeFlinkStatementsViewProvider.setParentResource, testPool);
      });
    }

    it("should return early when user cancels pool selection", async () => {
      flinkComputePoolQuickPickWithViewProgressStub.resolves(undefined);

      await commandsModule.selectPoolForStatementsViewCommand();

      sinon.assert.calledOnce(flinkComputePoolQuickPickWithViewProgressStub);
      sinon.assert.notCalled(fakeFlinkStatementsViewProvider.setParentResource);
    });

    it("should skip call to flinkComputePoolQuickPickWithViewProgress when passed a pool", async () => {
      const testPool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      await commandsModule.selectPoolForStatementsViewCommand(testPool);

      sinon.assert.notCalled(flinkComputePoolQuickPickWithViewProgressStub);
      sinon.assert.calledWith(fakeFlinkStatementsViewProvider.setParentResource, testPool);
    });
  });
});
