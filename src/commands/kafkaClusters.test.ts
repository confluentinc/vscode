import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { eventEmitterStubs, StubbedEventEmitters } from "../../tests/stubs/emitters";
import {
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_CLUSTER,
} from "../../tests/unit/testResources/kafkaCluster";
import { CCloudFlinkDbKafkaCluster, CCloudKafkaCluster } from "../models/kafkaCluster";
import * as kafkaClusterQuickpicks from "../quickpicks/kafkaClusters";
import {
  copyBootstrapServers,
  selectFlinkDatabaseViewKafkaClusterCommand,
  selectTopicsViewKafkaClusterCommand,
} from "./kafkaClusters";

describe("commands/kafkaClusters.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let emitterStubs: StubbedEventEmitters;
  let executeCommandStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    emitterStubs = eventEmitterStubs(sandbox);
    executeCommandStub = sandbox.stub(vscode.commands, "executeCommand");
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("selectTopicsViewKafkaClusterCommand", () => {
    let topicsViewResourceChangedFireStub: sinon.SinonStub;
    let kafkaClusterQuickPickWithViewProgressStub: sinon.SinonStub;

    beforeEach(() => {
      kafkaClusterQuickPickWithViewProgressStub = sandbox.stub(
        kafkaClusterQuickpicks,
        "kafkaClusterQuickPickWithViewProgress",
      );
      topicsViewResourceChangedFireStub = emitterStubs.topicsViewResourceChanged!.fire;
    });

    it("if no cluster provided and user cancels quick pick, should do nothing", async () => {
      kafkaClusterQuickPickWithViewProgressStub.resolves(undefined);

      await selectTopicsViewKafkaClusterCommand();

      sinon.assert.calledOnce(kafkaClusterQuickPickWithViewProgressStub);
      sinon.assert.notCalled(topicsViewResourceChangedFireStub);
      sinon.assert.notCalled(executeCommandStub);
    });

    it("should use the provided cluster if valid", async () => {
      const testCluster: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        id: "cluster-123",
      });

      await selectTopicsViewKafkaClusterCommand(testCluster);

      // skips call to kafkaClusterQuickPickWithViewProgress

      sinon.assert.notCalled(kafkaClusterQuickPickWithViewProgressStub);
      sinon.assert.calledOnceWithExactly(topicsViewResourceChangedFireStub, testCluster);
      sinon.assert.calledOnceWithExactly(executeCommandStub, "confluent-topics.focus");
    });

    it("should use the selected cluster from quick pick if none provided", async () => {
      const testCluster: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        id: "cluster-456",
      });
      kafkaClusterQuickPickWithViewProgressStub.resolves(testCluster);

      await selectTopicsViewKafkaClusterCommand();

      sinon.assert.calledOnce(kafkaClusterQuickPickWithViewProgressStub);
      sinon.assert.calledOnceWithExactly(topicsViewResourceChangedFireStub, testCluster);
      sinon.assert.calledOnceWithExactly(executeCommandStub, "confluent-topics.focus");
    });
  });

  describe("selectFlinkDatabaseViewKafkaClusterCommand", () => {
    let flinkDatabaseViewResourceChangedFireStub: sinon.SinonStub;
    let flinkDatabaseQuickpickStub: sinon.SinonStub;

    beforeEach(() => {
      flinkDatabaseQuickpickStub = sandbox.stub(kafkaClusterQuickpicks, "flinkDatabaseQuickpick");
      flinkDatabaseViewResourceChangedFireStub =
        emitterStubs.flinkDatabaseViewResourceChanged!.fire;
    });

    it("if no cluster provided and user cancels quick pick, should do nothing", async () => {
      flinkDatabaseQuickpickStub.resolves(undefined);

      await selectFlinkDatabaseViewKafkaClusterCommand();
      sinon.assert.calledOnce(flinkDatabaseQuickpickStub);
      sinon.assert.notCalled(flinkDatabaseViewResourceChangedFireStub);
      sinon.assert.notCalled(executeCommandStub);
    });

    it("should use the provided cluster if valid", async () => {
      const testCluster: CCloudFlinkDbKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        id: "cluster-123",
      }) as CCloudFlinkDbKafkaCluster;

      await selectFlinkDatabaseViewKafkaClusterCommand(testCluster);
      // skips call to kafkaClusterQuickPickWithViewProgress

      sinon.assert.notCalled(flinkDatabaseQuickpickStub);
      sinon.assert.calledOnceWithExactly(flinkDatabaseViewResourceChangedFireStub, testCluster);
      sinon.assert.calledOnceWithExactly(executeCommandStub, "confluent-flink-database.focus");
    });

    it("should use the selected cluster from quick pick if none provided", async () => {
      const testCluster: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        id: "cluster-456",
      });
      flinkDatabaseQuickpickStub.resolves(testCluster);

      await selectFlinkDatabaseViewKafkaClusterCommand();
      sinon.assert.calledOnce(flinkDatabaseQuickpickStub);
      sinon.assert.calledOnceWithExactly(flinkDatabaseViewResourceChangedFireStub, testCluster);
      sinon.assert.calledOnceWithExactly(executeCommandStub, "confluent-flink-database.focus");
    });
  });

  describe("copyBootstrapServers", () => {
    let _originalClipboardContents: string | undefined;

    beforeEach(async () => {
      // Try to reduce annoying developer running tests corrupting their clipboard.
      _originalClipboardContents = await vscode.env.clipboard.readText();
    });

    afterEach(async () => {
      if (_originalClipboardContents) {
        await vscode.env.clipboard.writeText(_originalClipboardContents);
      }
    });

    it("should copy protocol-free bootstrap server(s) to the clipboard", async () => {
      const testCluster: CCloudKafkaCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        bootstrapServers: "SASL_SSL://s1.com:2343,FOO://s2.com:1234,s4.com:4455",
      });
      await copyBootstrapServers(testCluster);
      const writtenValue = await vscode.env.clipboard.readText();
      // Look ma, no more protocol:// bits.
      assert.strictEqual(writtenValue, "s1.com:2343,s2.com:1234,s4.com:4455");
    });
  });
});
