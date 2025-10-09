import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { eventEmitterStubs } from "../../tests/stubs/emitters";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { createFlinkStatement } from "../../tests/unit/testResources/flinkStatement";
import {
  FLINK_CONFIG_COMPUTE_POOL,
  FLINK_CONFIG_DATABASE,
  FLINK_CONFIG_STATEMENT_PREFIX,
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
    let showInputBoxStub: sinon.SinonStub;
    let stubbedConfigs: StubbedWorkspaceConfiguration;
    let showInformationMessageStub: sinon.SinonStub;

    beforeEach(() => {
      flinkComputePoolQuickPickStub = sandbox.stub(quickpicks, "flinkComputePoolQuickPick");
      flinkDatabaseQuickpickStub = sandbox.stub(kafkaQuickpicks, "flinkDatabaseQuickpick");
      showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
      showInformationMessageStub = sandbox
        .stub(vscode.window, "showInformationMessage")
        .resolves(undefined);
    });

    it("should return early if user cancels statement prefix input", async () => {
      showInputBoxStub.resolves(undefined); // User cancelled

      await commandsModule.configureFlinkDefaults();

      sinon.assert.notCalled(flinkDatabaseQuickpickStub);
    });

    it("should update configuration when prefix is provided", async () => {
      flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      flinkDatabaseQuickpickStub.resolves(TEST_CCLOUD_KAFKA_CLUSTER);
      showInputBoxStub.resolves("dev_");

      await commandsModule.configureFlinkDefaults();

      sinon.assert.calledOnce(flinkDatabaseQuickpickStub);
      sinon.assert.calledOnce(flinkComputePoolQuickPickStub);
      sinon.assert.calledOnce(showInputBoxStub);

      sinon.assert.calledWithExactly(
        stubbedConfigs.update.getCall(0),
        FLINK_CONFIG_COMPUTE_POOL.id,
        TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
        true,
      );
      sinon.assert.calledWithExactly(
        stubbedConfigs.update.getCall(1),
        FLINK_CONFIG_DATABASE.id,
        TEST_CCLOUD_KAFKA_CLUSTER.id,
        true,
      );
      sinon.assert.calledWithExactly(
        stubbedConfigs.update.getCall(2),
        FLINK_CONFIG_STATEMENT_PREFIX.id,
        "dev_",
        true,
      );
      sinon.assert.calledThrice(stubbedConfigs.update);
    });

    it("should not update prefix setting when user exits via the escape key", async () => {
      flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      flinkDatabaseQuickpickStub.resolves(TEST_CCLOUD_KAFKA_CLUSTER);
      showInputBoxStub.resolves(undefined); // User exits via escape key

      await commandsModule.configureFlinkDefaults();

      sinon.assert.notCalled(showInformationMessageStub);
    });

    it("should update prefix setting when user provides empty string", async () => {
      flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      flinkDatabaseQuickpickStub.resolves(TEST_CCLOUD_KAFKA_CLUSTER);
      showInputBoxStub.resolves(""); // empty string

      await commandsModule.configureFlinkDefaults();

      sinon.assert.calledWithExactly(
        stubbedConfigs.update.getCall(2),
        FLINK_CONFIG_STATEMENT_PREFIX.id,
        "",
        true,
      );
      sinon.assert.calledThrice(stubbedConfigs.update);
      sinon.assert.calledOnce(showInformationMessageStub);
    });

    it("should return early if no compute pool is selected", async () => {
      flinkComputePoolQuickPickStub.resolves(undefined);

      await commandsModule.configureFlinkDefaults();

      assert.ok(stubbedConfigs.update.notCalled);
      assert.ok(flinkDatabaseQuickpickStub.notCalled);
    });

    it("should return early if no database is selected", async () => {
      flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      flinkDatabaseQuickpickStub.resolves(undefined);

      await commandsModule.configureFlinkDefaults();

      sinon.assert.calledWithExactly(
        stubbedConfigs.update,
        FLINK_CONFIG_COMPUTE_POOL.id,
        TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
        true,
      );

      // and just called once for the compute pool, not the database.
      sinon.assert.calledOnce(stubbedConfigs.update);

      sinon.assert.notCalled(showInformationMessageStub);
    });

    it("should update config and show info message after pool and database are selected", async () => {
      flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
      flinkDatabaseQuickpickStub.resolves(TEST_CCLOUD_KAFKA_CLUSTER);
      showInputBoxStub.resolves("dev_");

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
      showInputBoxStub.resolves("dev_");
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
    let currentFlinkStatementsResourceChangedFireStub: sinon.SinonStub;

    beforeEach(() => {
      flinkComputePoolQuickPickWithViewProgressStub = sandbox.stub(
        quickpicks,
        "flinkComputePoolQuickPickWithViewProgress",
      );

      sandbox.stub(vscode.commands, "executeCommand").resolves();

      // stub out all event emitters
      const emitterStubs = eventEmitterStubs(sandbox);
      currentFlinkStatementsResourceChangedFireStub =
        emitterStubs.currentFlinkStatementsResourceChanged!.fire;
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
        sinon.assert.calledWith(currentFlinkStatementsResourceChangedFireStub, testPool);
      });
    }

    it("should return early when user cancels pool selection", async () => {
      flinkComputePoolQuickPickWithViewProgressStub.resolves(undefined);

      await commandsModule.selectPoolForStatementsViewCommand();

      sinon.assert.calledOnce(flinkComputePoolQuickPickWithViewProgressStub);
      sinon.assert.notCalled(currentFlinkStatementsResourceChangedFireStub);
    });

    it("should skip call to flinkComputePoolQuickPickWithViewProgress when passed a pool", async () => {
      const testPool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      await commandsModule.selectPoolForStatementsViewCommand(testPool);

      sinon.assert.notCalled(flinkComputePoolQuickPickWithViewProgressStub);
      sinon.assert.calledWith(currentFlinkStatementsResourceChangedFireStub, testPool);
    });
  });
});
