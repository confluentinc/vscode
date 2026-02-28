import * as assert from "assert";
import * as sinon from "sinon";

import * as indexModule from ".";

import { refreshResourceContainerCommand, registerTopicsViewCommands } from "./topicsView";

import { ConnectionType } from "../clients/sidecar";
import {
  KafkaClusterContainerLabel,
  KafkaClusterResourceContainer,
} from "../models/containers/kafkaClusterResourceContainer";
import type { ConsumerGroup } from "../models/consumerGroup";
import type { KafkaTopic } from "../models/topic";
import { TopicViewProvider } from "../viewProviders/topics";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources/kafkaCluster";

describe("commands/topicsView.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("registerTopicsViewCommands", () => {
    let registerCommandWithLoggingStub: sinon.SinonStub;

    beforeEach(() => {
      registerCommandWithLoggingStub = sandbox.stub(indexModule, "registerCommandWithLogging");
    });

    it("should register the expected commands", () => {
      registerTopicsViewCommands();

      assert.strictEqual(registerCommandWithLoggingStub.callCount, 1);

      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub,
        "confluent.topics.refreshResourceContainer",
        refreshResourceContainerCommand,
      );
    });
  });

  describe("refreshResourceContainerCommand", () => {
    let provider: TopicViewProvider;
    let refreshTopicsStub: sinon.SinonStub;
    let refreshConsumerGroupsStub: sinon.SinonStub;

    beforeEach(() => {
      provider = TopicViewProvider.getInstance();
      provider["resource"] = TEST_CCLOUD_KAFKA_CLUSTER;

      refreshTopicsStub = sandbox.stub(provider, "refreshTopics").resolves();
      refreshConsumerGroupsStub = sandbox.stub(provider, "refreshConsumerGroups").resolves();
    });

    afterEach(() => {
      provider.dispose();
      TopicViewProvider["instanceMap"].clear();
    });

    it("should bail early if no container is provided", async () => {
      await refreshResourceContainerCommand(undefined as any);

      sinon.assert.notCalled(refreshTopicsStub);
      sinon.assert.notCalled(refreshConsumerGroupsStub);
    });

    it("should bail early if no Kafka cluster is selected", async () => {
      provider["resource"] = null;
      const container = new KafkaClusterResourceContainer<ConsumerGroup>(
        TEST_CCLOUD_KAFKA_CLUSTER.connectionId,
        ConnectionType.Ccloud,
        KafkaClusterContainerLabel.CONSUMER_GROUPS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshTopicsStub);
      sinon.assert.notCalled(refreshConsumerGroupsStub);
    });

    it("should call refreshTopics when the Topics container is provided", async () => {
      const container = new KafkaClusterResourceContainer<KafkaTopic>(
        TEST_CCLOUD_KAFKA_CLUSTER.connectionId,
        ConnectionType.Ccloud,
        KafkaClusterContainerLabel.TOPICS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.calledOnceWithExactly(refreshTopicsStub, TEST_CCLOUD_KAFKA_CLUSTER, true);
      sinon.assert.notCalled(refreshConsumerGroupsStub);
    });

    it("should call refreshConsumerGroups when the Consumer Groups container is provided", async () => {
      const container = new KafkaClusterResourceContainer<ConsumerGroup>(
        TEST_CCLOUD_KAFKA_CLUSTER.connectionId,
        ConnectionType.Ccloud,
        KafkaClusterContainerLabel.CONSUMER_GROUPS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshTopicsStub);
      sinon.assert.calledOnceWithExactly(
        refreshConsumerGroupsStub,
        TEST_CCLOUD_KAFKA_CLUSTER,
        true,
      );
    });

    it("should log an error for an unknown container label", async () => {
      const container = new KafkaClusterResourceContainer(
        TEST_CCLOUD_KAFKA_CLUSTER.connectionId,
        ConnectionType.Ccloud,
        "Unknown Label" as any,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshTopicsStub);
      sinon.assert.notCalled(refreshConsumerGroupsStub);
    });
  });
});
