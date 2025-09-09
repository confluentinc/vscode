import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { eventEmitterStubs, StubbedEventEmitters } from "../../tests/stubs/emitters";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources/kafkaCluster";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import * as kafkaClusterQuickpicks from "../quickpicks/kafkaClusters";
import { copyBootstrapServers, selectTopicsViewKafkaClusterCommand } from "./kafkaClusters";

describe("kafkaClusters.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let kafkaClusterQuickPickWithViewProgressStub: sinon.SinonStub;
  let emitterStubs: StubbedEventEmitters;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    kafkaClusterQuickPickWithViewProgressStub = sandbox.stub(
      kafkaClusterQuickpicks,
      "kafkaClusterQuickPickWithViewProgress",
    );
    emitterStubs = eventEmitterStubs(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("selectTopicsViewKafkaClusterCommand", () => {
    let topicsViewResourceChangedFireStub: sinon.SinonStub;
    let executeCommandStub: sinon.SinonStub;

    beforeEach(() => {
      topicsViewResourceChangedFireStub = emitterStubs.topicsViewResourceChanged!.fire;
      executeCommandStub = sandbox.stub(vscode.commands, "executeCommand");
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
