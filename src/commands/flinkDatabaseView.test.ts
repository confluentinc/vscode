import * as assert from "assert";
import * as sinon from "sinon";

import * as indexModule from ".";
import * as kafkaClusterCommandsModule from "./kafkaClusters";

import {
  createTopicInFlinkDatabaseViewCommand,
  refreshResourceContainerCommand,
  registerFlinkDatabaseViewCommands,
} from "./flinkDatabaseView";

import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import {
  FlinkDatabaseContainerLabel,
  FlinkDatabaseResourceContainer,
} from "../models/flinkDatabaseResourceContainer";
import * as sidecarUtilsModule from "../sidecar/utils";
import { FlinkDatabaseViewProvider } from "../viewProviders/flinkDatabase";

describe("commands/flinkDatabaseView.ts", () => {
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("registerFlinkDatabaseViewCommands", () => {
    let registerCommandWithLoggingStub: sinon.SinonStub;

    beforeEach(() => {
      registerCommandWithLoggingStub = sandbox.stub(indexModule, "registerCommandWithLogging");
    });

    it("should register the expected commands", () => {
      registerFlinkDatabaseViewCommands();

      assert.strictEqual(registerCommandWithLoggingStub.callCount, 2);

      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub,
        "confluent.flinkdatabase.createTopic",
        createTopicInFlinkDatabaseViewCommand,
      );
      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub,
        "confluent.flinkdatabase.refreshResourceContainer",
        refreshResourceContainerCommand,
      );
    });
  });

  describe("createTopicInFlinkDatabaseViewCommand", () => {
    let flinkDatabaseViewProviderInstance: FlinkDatabaseViewProvider;
    let flinkDatabaseViewProviderGetInstanceStub: sinon.SinonStub;
    let createTopicCommandStub: sinon.SinonStub;
    let refreshRelationsStub: sinon.SinonStub;
    let pauseStub: sinon.SinonStub;

    beforeEach(() => {
      flinkDatabaseViewProviderInstance = new FlinkDatabaseViewProvider();
      flinkDatabaseViewProviderGetInstanceStub = sandbox.stub(
        FlinkDatabaseViewProvider,
        "getInstance",
      );
      flinkDatabaseViewProviderGetInstanceStub.returns(flinkDatabaseViewProviderInstance);
      createTopicCommandStub = sandbox.stub(kafkaClusterCommandsModule, "createTopicCommand");
      refreshRelationsStub = sandbox
        .stub(flinkDatabaseViewProviderInstance, "refreshRelationsContainer")
        .resolves();
      pauseStub = sandbox.stub(sidecarUtilsModule, "pause").resolves();
    });

    afterEach(() => {
      flinkDatabaseViewProviderInstance.dispose();
    });

    it("should bail early if no Flink database is selected", async () => {
      // Mock no selected Flink database
      sinon.stub(flinkDatabaseViewProviderInstance, "database").get(() => undefined);
      await createTopicInFlinkDatabaseViewCommand();

      sinon.assert.notCalled(createTopicCommandStub);
    });

    it("should start to create a topic in the selected Flink database's Kafka cluster", async () => {
      // Mock a selected Flink database
      sinon
        .stub(flinkDatabaseViewProviderInstance, "database")
        .get(() => TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);

      // Have the stubbed command indicate that user skipped out of topic creation.
      createTopicCommandStub.resolves(false);

      await createTopicInFlinkDatabaseViewCommand();

      sinon.assert.calledOnceWithExactly(
        createTopicCommandStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
      );

      // Should not attempt to refresh the view if no topic was created.
      sinon.assert.notCalled(refreshRelationsStub);
    });

    it("should refresh the relations container after topic creation", async () => {
      // Mock a selected Flink database
      sinon
        .stub(flinkDatabaseViewProviderInstance, "database")
        .get(() => TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);

      // Have the stubbed command indicate that a topic was created.
      createTopicCommandStub.resolves(true);

      // Simulate that relations are empty initially, then populated after refresh.
      flinkDatabaseViewProviderInstance.relationsContainer.children = [];
      // After first refresh, relations are still empty
      refreshRelationsStub.onFirstCall().callsFake(() => {
        flinkDatabaseViewProviderInstance.relationsContainer.children = [{ id: "topic1" } as any];
        return Promise.resolve();
      });

      await createTopicInFlinkDatabaseViewCommand();

      sinon.assert.calledOnceWithExactly(
        createTopicCommandStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
      );

      // Only took one refresh to get relations.
      sinon.assert.calledOnce(refreshRelationsStub);
      sinon.assert.calledOnce(pauseStub);

      // Deep refresh.
      sinon.assert.calledWithExactly(
        refreshRelationsStub.firstCall,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        true,
      );
    });

    it("should retry several times if relations container stays empty after refresh", async () => {
      // Mock a selected Flink database
      sinon
        .stub(flinkDatabaseViewProviderInstance, "database")
        .get(() => TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);

      // Have the stubbed command indicate that a topic was created.
      createTopicCommandStub.resolves(true);
      // but the relations never populate.
      flinkDatabaseViewProviderInstance.relationsContainer.children = [];

      await createTopicInFlinkDatabaseViewCommand();

      sinon.assert.called(refreshRelationsStub);
      sinon.assert.callCount(refreshRelationsStub, 5); // 5 attempts in the loop then bailed.
    });
  });

  describe("refreshResourceContainerCommand", () => {
    let provider: FlinkDatabaseViewProvider;
    let refreshRelationsStub: sinon.SinonStub;
    let refreshArtifactsStub: sinon.SinonStub;
    let refreshUDFsStub: sinon.SinonStub;
    let refreshAIConnectionsStub: sinon.SinonStub;
    let refreshAIToolsStub: sinon.SinonStub;
    let refreshAIModelsStub: sinon.SinonStub;
    let refreshAIAgentsStub: sinon.SinonStub;

    beforeEach(() => {
      provider = FlinkDatabaseViewProvider.getInstance();
      provider["resource"] = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;

      refreshRelationsStub = sandbox.stub(provider, "refreshRelationsContainer").resolves();
      refreshArtifactsStub = sandbox.stub(provider, "refreshArtifactsContainer").resolves();
      refreshUDFsStub = sandbox.stub(provider, "refreshUDFsContainer").resolves();
      refreshAIConnectionsStub = sandbox.stub(provider, "refreshAIConnectionsContainer").resolves();
      refreshAIToolsStub = sandbox.stub(provider, "refreshAIToolsContainer").resolves();
      refreshAIModelsStub = sandbox.stub(provider, "refreshAIModelsContainer").resolves();
      refreshAIAgentsStub = sandbox.stub(provider, "refreshAIAgentsContainer").resolves();
    });

    afterEach(() => {
      provider.dispose();
      FlinkDatabaseViewProvider["instanceMap"].clear();
    });

    it("should bail early if no container is provided", async () => {
      await refreshResourceContainerCommand(undefined as any);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should bail early if no database is selected", async () => {
      provider["resource"] = null;
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.RELATIONS,
        [],
      );
      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshRelationsContainer when the Table/View Relations container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.RELATIONS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.calledOnceWithExactly(
        refreshRelationsStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        true,
      );
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshArtifactsContainer when the Artifacts container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.ARTIFACTS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.calledOnceWithExactly(
        refreshArtifactsStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        true,
      );
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshUDFsContainer when the UDFs container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(FlinkDatabaseContainerLabel.UDFS, []);

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.calledOnceWithExactly(refreshUDFsStub, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER, true);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshAIConnectionsContainer when the AI Connections container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.AI_CONNECTIONS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.calledOnceWithExactly(
        refreshAIConnectionsStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        true,
      );
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshAIToolsContainer when the AI Tools container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.AI_TOOLS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.calledOnceWithExactly(
        refreshAIToolsStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        true,
      );
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshAIModelsContainer when the AI Models container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.AI_MODELS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.calledOnceWithExactly(
        refreshAIModelsStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        true,
      );
      sinon.assert.notCalled(refreshAIAgentsStub);
    });

    it("should call refreshAIAgentsContainer when the AI Agents container is provided", async () => {
      const container = new FlinkDatabaseResourceContainer(
        FlinkDatabaseContainerLabel.AI_AGENTS,
        [],
      );

      await refreshResourceContainerCommand(container);

      sinon.assert.notCalled(refreshRelationsStub);
      sinon.assert.notCalled(refreshArtifactsStub);
      sinon.assert.notCalled(refreshUDFsStub);
      sinon.assert.notCalled(refreshAIConnectionsStub);
      sinon.assert.notCalled(refreshAIToolsStub);
      sinon.assert.notCalled(refreshAIModelsStub);
      sinon.assert.calledOnceWithExactly(
        refreshAIAgentsStub,
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        true,
      );
    });
  });
});
