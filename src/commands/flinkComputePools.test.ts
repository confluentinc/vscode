import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { FLINK_CONFIG_COMPUTE_POOL, FLINK_CONFIG_DATABASE } from "../extensionSettings/constants";
import * as quickpicks from "../quickpicks/flinkComputePools";
import * as kafkaQuickpicks from "../quickpicks/kafkaClusters";
import * as commandsModule from "./flinkComputePools";

describe("configureFlinkDefaults command", () => {
  let sandbox: sinon.SinonSandbox;
  let flinkComputePoolQuickPickStub: sinon.SinonStub;
  let flinkDatabaseQuickpickStub: sinon.SinonStub;
  // We use this to stub the getConfiguration().update() method, see below
  let getConfigurationStub: sinon.SinonStub; // eslint-disable-line @typescript-eslint/no-unused-vars
  let updateStub: sinon.SinonStub;
  let showInformationMessageStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    flinkComputePoolQuickPickStub = sandbox.stub(quickpicks, "flinkComputePoolQuickPick");
    flinkDatabaseQuickpickStub = sandbox.stub(kafkaQuickpicks, "flinkDatabaseQuickpick");
    updateStub = sandbox.stub();
    getConfigurationStub = sandbox.stub(vscode.workspace, "getConfiguration").returns({
      update: updateStub,
      get: sandbox.stub().callsFake((section: string, defaultValue?: unknown) => defaultValue),
      has: sandbox.stub(),
      inspect: sandbox.stub(),
    });
    showInformationMessageStub = sandbox
      .stub(vscode.window, "showInformationMessage")
      .resolves(undefined);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return early if no compute pool is selected", async () => {
    flinkComputePoolQuickPickStub.resolves(undefined);

    await commandsModule.configureFlinkDefaults();

    assert.ok(updateStub.notCalled);
    assert.ok(flinkDatabaseQuickpickStub.notCalled);
  });

  it("should update config and show info message after pool and database are selected", async () => {
    flinkComputePoolQuickPickStub.resolves(TEST_CCLOUD_FLINK_COMPUTE_POOL);
    flinkDatabaseQuickpickStub.resolves(TEST_CCLOUD_KAFKA_CLUSTER);

    await commandsModule.configureFlinkDefaults();

    sinon.assert.calledWithExactly(
      updateStub,
      FLINK_CONFIG_COMPUTE_POOL,
      TEST_CCLOUD_FLINK_COMPUTE_POOL.id,
      true,
    );
    sinon.assert.calledWithExactly(
      updateStub,
      FLINK_CONFIG_DATABASE,
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
