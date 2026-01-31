import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { StubbedEventEmitters } from "../../tests/stubs/emitters";
import { eventEmitterStubs } from "../../tests/stubs/emitters";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import {
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_CLUSTER,
} from "../../tests/unit/testResources/kafkaCluster";
import * as topicsAuthz from "../authz/topics";
import { ClusterSelectSyncOption, SYNC_ON_KAFKA_SELECT } from "../extensionSettings/constants";
import { KafkaAdminError, KafkaAdminErrorCategory, type TopicService } from "../kafka";
import * as topicServiceFactory from "../kafka/topicServiceFactory";
import type { CCloudResourceLoader } from "../loaders";
import { ResourceLoader } from "../loaders/resourceLoader";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { KafkaTopic } from "../models/topic";
import * as kafkaClusterQuickpicks from "../quickpicks/kafkaClusters";
import { TopicViewProvider } from "../viewProviders/topics";
import {
  copyBootstrapServers,
  createTopicCommand,
  deleteTopicCommand,
  selectFlinkDatabaseViewKafkaClusterCommand,
  selectTopicsViewKafkaClusterCommand,
} from "./kafkaClusters";
import * as schemaRegistryCommands from "./schemaRegistry";

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
    let kafkaClusterQuickPickWithViewProgressStub: sinon.SinonStub;
    let selectSchemaRegistryCommandStub: sinon.SinonStub;
    let topicsViewResourceChangedFireStub: sinon.SinonStub;
    let flinkDatabaseViewResourceChangedFireStub: sinon.SinonStub;
    let stubbedConfigs: StubbedWorkspaceConfiguration;
    // no CCloud-specific logic here, but simpler setup without having to juggle loaders
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    const testKafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
    const testSchemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;
    const testFlinkDatabase = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER;

    beforeEach(() => {
      kafkaClusterQuickPickWithViewProgressStub = sandbox.stub(
        kafkaClusterQuickpicks,
        "kafkaClusterQuickPickWithViewProgress",
      );
      selectSchemaRegistryCommandStub = sandbox.stub(
        schemaRegistryCommands,
        "selectSchemaRegistryCommand",
      );

      topicsViewResourceChangedFireStub = emitterStubs.topicsViewResourceChanged!.fire;
      flinkDatabaseViewResourceChangedFireStub =
        emitterStubs.flinkDatabaseViewResourceChanged!.fire;

      stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
    });

    it("if no cluster provided and user cancels quick pick, should do nothing", async () => {
      kafkaClusterQuickPickWithViewProgressStub.resolves(undefined);

      await selectTopicsViewKafkaClusterCommand();

      sinon.assert.calledOnce(kafkaClusterQuickPickWithViewProgressStub);
      sinon.assert.notCalled(topicsViewResourceChangedFireStub);
      sinon.assert.neverCalledWith(executeCommandStub, "confluent-topics.focus");
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

    it(`should sync multiple views when "${SYNC_ON_KAFKA_SELECT.id}=${ClusterSelectSyncOption.ALL}"`, async () => {
      stubbedConfigs.stubGet(SYNC_ON_KAFKA_SELECT, ClusterSelectSyncOption.ALL);
      stubbedLoader.getSchemaRegistryForEnvironmentId.resolves(testSchemaRegistry);

      // assuming we're using a Flink-enabled Kafka cluster
      await selectTopicsViewKafkaClusterCommand(testFlinkDatabase);

      sinon.assert.calledOnceWithExactly(
        stubbedLoader.getSchemaRegistryForEnvironmentId,
        testFlinkDatabase.environmentId,
      );
      sinon.assert.calledOnceWithExactly(selectSchemaRegistryCommandStub, testSchemaRegistry);
      sinon.assert.calledOnceWithExactly(
        flinkDatabaseViewResourceChangedFireStub,
        testFlinkDatabase,
      );
    });

    it(`should only sync the Schemas view when a Schema Registry is available for the selected Kafka cluster's environment and "${SYNC_ON_KAFKA_SELECT.id}=${ClusterSelectSyncOption.SCHEMAS}"`, async () => {
      stubbedConfigs.stubGet(SYNC_ON_KAFKA_SELECT, ClusterSelectSyncOption.SCHEMAS);
      stubbedLoader.getSchemaRegistryForEnvironmentId.resolves(testSchemaRegistry);

      await selectTopicsViewKafkaClusterCommand(testKafkaCluster);

      sinon.assert.calledOnceWithExactly(
        stubbedLoader.getSchemaRegistryForEnvironmentId,
        testKafkaCluster.environmentId,
      );
      sinon.assert.calledOnceWithExactly(selectSchemaRegistryCommandStub, testSchemaRegistry);
      sinon.assert.notCalled(flinkDatabaseViewResourceChangedFireStub);
    });

    for (const option of [ClusterSelectSyncOption.SCHEMAS, ClusterSelectSyncOption.ALL]) {
      it(`should not sync the Schemas view when no Schema Registry is available for the selected Kafka cluster's environment, even if "${SYNC_ON_KAFKA_SELECT.id}=${option}"`, async () => {
        stubbedConfigs.stubGet(SYNC_ON_KAFKA_SELECT, option);
        // wouldn't happen for a CCloud environment, but entirely possible for a local/direct connection
        stubbedLoader.getSchemaRegistryForEnvironmentId.resolves(undefined);

        await selectTopicsViewKafkaClusterCommand(testKafkaCluster);

        sinon.assert.calledOnceWithExactly(
          stubbedLoader.getSchemaRegistryForEnvironmentId,
          testKafkaCluster.environmentId,
        );
        sinon.assert.notCalled(selectSchemaRegistryCommandStub);
      });
    }

    it(`should only sync the Flink Database view when "${SYNC_ON_KAFKA_SELECT.id}=${ClusterSelectSyncOption.FLINK_DATABASE}" and the select Kafka cluster is Flink-enabled`, async () => {
      stubbedConfigs.stubGet(SYNC_ON_KAFKA_SELECT, ClusterSelectSyncOption.FLINK_DATABASE);

      await selectTopicsViewKafkaClusterCommand(testFlinkDatabase);

      sinon.assert.notCalled(stubbedLoader.getSchemaRegistryForEnvironmentId);
      sinon.assert.notCalled(selectSchemaRegistryCommandStub);
      sinon.assert.calledOnceWithExactly(
        flinkDatabaseViewResourceChangedFireStub,
        testFlinkDatabase,
      );
    });

    for (const option of [ClusterSelectSyncOption.FLINK_DATABASE, ClusterSelectSyncOption.ALL]) {
      it(`should not sync the Flink Database view when using a non-Flink-enabled Kafka cluster, even if "${SYNC_ON_KAFKA_SELECT.id}=${option}"`, async () => {
        stubbedConfigs.stubGet(SYNC_ON_KAFKA_SELECT, option);
        stubbedLoader.getSchemaRegistryForEnvironmentId.resolves(testSchemaRegistry);

        await selectTopicsViewKafkaClusterCommand(testKafkaCluster);

        sinon.assert.notCalled(flinkDatabaseViewResourceChangedFireStub);
      });
    }

    it(`should not sync any views when "${SYNC_ON_KAFKA_SELECT.id}=${ClusterSelectSyncOption.NONE}"`, async () => {
      stubbedConfigs.stubGet(SYNC_ON_KAFKA_SELECT, ClusterSelectSyncOption.NONE);

      await selectTopicsViewKafkaClusterCommand(testKafkaCluster);

      sinon.assert.notCalled(stubbedLoader.getSchemaRegistryForEnvironmentId);
      sinon.assert.notCalled(selectSchemaRegistryCommandStub);
      sinon.assert.notCalled(flinkDatabaseViewResourceChangedFireStub);
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
      sinon.assert.neverCalledWith(executeCommandStub, "confluent-flink-database.focus");
    });

    it("if a non-ccloud-flinkable cluster is provided, should call quick pick", async () => {
      flinkDatabaseQuickpickStub.resolves(undefined);

      await selectFlinkDatabaseViewKafkaClusterCommand({} as any as CCloudFlinkDbKafkaCluster);
      sinon.assert.calledOnce(flinkDatabaseQuickpickStub);
      sinon.assert.notCalled(flinkDatabaseViewResourceChangedFireStub);
      sinon.assert.neverCalledWith(executeCommandStub, "confluent-flink-database.focus");
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

  describe("createTopicCommand", () => {
    let showInputBoxStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let kafkaClusterQuickPickStub: sinon.SinonStub;
    let mockTopicService: TopicService;
    let createTopicStub: sinon.SinonStub;
    let deleteTopicStub: sinon.SinonStub;
    let getTopicServiceStub: sinon.SinonStub;
    let topicViewProviderRefreshStub: sinon.SinonStub;

    beforeEach(() => {
      showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
      showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage");
      showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
      kafkaClusterQuickPickStub = sandbox.stub(kafkaClusterQuickpicks, "kafkaClusterQuickPick");

      // Create stub methods
      createTopicStub = sandbox.stub();
      deleteTopicStub = sandbox.stub();

      // Create a mock TopicService with stubs
      mockTopicService = {
        listTopics: sandbox.stub().resolves([]),
        describeTopic: sandbox.stub().resolves({}),
        topicExists: sandbox.stub().resolves(false),
        createTopic: createTopicStub,
        deleteTopic: deleteTopicStub,
      };

      // Stub getTopicService to return our mock
      getTopicServiceStub = sandbox
        .stub(topicServiceFactory, "getTopicService")
        .returns(mockTopicService);

      // Stub the TopicViewProvider refresh
      topicViewProviderRefreshStub = sandbox.stub(TopicViewProvider.getInstance(), "refresh");
    });

    it("should return false if no cluster is available", async () => {
      kafkaClusterQuickPickStub.resolves(undefined);
      // Clear the TopicViewProvider's cluster
      sandbox.stub(TopicViewProvider.getInstance(), "kafkaCluster").value(null);

      const result = await createTopicCommand();

      assert.strictEqual(result, false);
      sinon.assert.calledOnce(kafkaClusterQuickPickStub);
      sinon.assert.notCalled(showInputBoxStub);
    });

    it("should return false if user cancels out the topic name input box", async () => {
      showInputBoxStub.resolves(undefined);

      const result = await createTopicCommand(TEST_CCLOUD_KAFKA_CLUSTER);

      assert.strictEqual(result, false);
      sinon.assert.calledOnce(showInputBoxStub);
      sinon.assert.notCalled(mockTopicService.createTopic);
    });

    it("should fire the topicChanged event after successful creation", async () => {
      showInputBoxStub
        .onFirstCall()
        .resolves("new-topic") // topic name
        .onSecondCall()
        .resolves("3") // partitions
        .onThirdCall()
        .resolves("3"); // replication
      createTopicStub.resolves();
      topicViewProviderRefreshStub.resolves();

      const result = await createTopicCommand(TEST_CCLOUD_KAFKA_CLUSTER);

      assert.strictEqual(result, true);
      sinon.assert.calledOnce(createTopicStub);
      sinon.assert.calledOnce(topicViewProviderRefreshStub);
      sinon.assert.calledOnce(showInformationMessageStub);
    });

    it("should use the cluster from TopicViewProvider if no cluster is provided", async () => {
      sandbox
        .stub(TopicViewProvider.getInstance(), "kafkaCluster")
        .value(TEST_CCLOUD_KAFKA_CLUSTER);
      showInputBoxStub
        .onFirstCall()
        .resolves("new-topic")
        .onSecondCall()
        .resolves("3")
        .onThirdCall()
        .resolves("3");
      createTopicStub.resolves();
      topicViewProviderRefreshStub.resolves();

      const result = await createTopicCommand();

      assert.strictEqual(result, true);
      sinon.assert.notCalled(kafkaClusterQuickPickStub);
      sinon.assert.calledOnce(createTopicStub);
    });

    it("should return false and show an error notification when an unexpected error occurs", async () => {
      showInputBoxStub
        .onFirstCall()
        .resolves("new-topic")
        .onSecondCall()
        .resolves("3")
        .onThirdCall()
        .resolves("3");
      createTopicStub.rejects(new Error("Unexpected error"));

      const result = await createTopicCommand(TEST_CCLOUD_KAFKA_CLUSTER);

      assert.strictEqual(result, false);
    });

    it("should return false and show a permission error notification when a 40301 error code occurs", async () => {
      showInputBoxStub
        .onFirstCall()
        .resolves("new-topic")
        .onSecondCall()
        .resolves("3")
        .onThirdCall()
        .resolves("3");
      createTopicStub.rejects(
        new KafkaAdminError("Permission denied", KafkaAdminErrorCategory.AUTH),
      );

      const result = await createTopicCommand(TEST_CCLOUD_KAFKA_CLUSTER);

      assert.strictEqual(result, false);
    });

    it("should return false and show a generic error notification when a non-40301 error code occurs", async () => {
      showInputBoxStub
        .onFirstCall()
        .resolves("new-topic")
        .onSecondCall()
        .resolves("3")
        .onThirdCall()
        .resolves("3");
      createTopicStub.rejects(
        new KafkaAdminError("Cluster unavailable", KafkaAdminErrorCategory.TRANSIENT),
      );

      const result = await createTopicCommand(TEST_CCLOUD_KAFKA_CLUSTER);

      assert.strictEqual(result, false);
    });

    it("should return false when ResponseError response.json() fails to parse", async () => {
      showInputBoxStub
        .onFirstCall()
        .resolves("new-topic")
        .onSecondCall()
        .resolves("3")
        .onThirdCall()
        .resolves("3");
      createTopicStub.rejects(
        new KafkaAdminError("Invalid response", KafkaAdminErrorCategory.UNKNOWN),
      );

      const result = await createTopicCommand(TEST_CCLOUD_KAFKA_CLUSTER);

      assert.strictEqual(result, false);
    });
  });

  describe("deleteTopicCommand", () => {
    let showInputBoxStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let mockTopicService: TopicService;
    let createTopicStub: sinon.SinonStub;
    let deleteTopicStub: sinon.SinonStub;
    let getTopicServiceStub: sinon.SinonStub;
    let topicViewProviderRefreshStub: sinon.SinonStub;
    let fetchTopicAuthorizedOperationsStub: sinon.SinonStub;
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

    const testTopic = TEST_CCLOUD_KAFKA_TOPIC;

    beforeEach(() => {
      showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
      showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage");
      showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage");
      fetchTopicAuthorizedOperationsStub = sandbox.stub(
        topicsAuthz,
        "fetchTopicAuthorizedOperations",
      );

      // Create stub methods
      createTopicStub = sandbox.stub();
      deleteTopicStub = sandbox.stub();

      // Create a mock TopicService with stubs
      mockTopicService = {
        listTopics: sandbox.stub().resolves([]),
        describeTopic: sandbox.stub().resolves({}),
        topicExists: sandbox.stub().resolves(false),
        createTopic: createTopicStub,
        deleteTopic: deleteTopicStub,
      };

      // Stub getTopicService to return our mock
      getTopicServiceStub = sandbox
        .stub(topicServiceFactory, "getTopicService")
        .returns(mockTopicService);

      // Stub the TopicViewProvider refresh
      topicViewProviderRefreshStub = sandbox.stub(TopicViewProvider.getInstance(), "refresh");

      // Stub the ResourceLoader
      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
    });

    it("should fire the topicChanged event after successful deletion", async () => {
      fetchTopicAuthorizedOperationsStub.resolves(["READ", "WRITE", "DELETE"]);
      showInputBoxStub.resolves(testTopic.name);
      stubbedLoader.getKafkaClustersForEnvironmentId.resolves([TEST_CCLOUD_KAFKA_CLUSTER]);
      deleteTopicStub.resolves();
      topicViewProviderRefreshStub.resolves();

      await deleteTopicCommand(testTopic);

      sinon.assert.calledOnce(deleteTopicStub);
      sinon.assert.calledOnce(topicViewProviderRefreshStub);
      sinon.assert.calledOnce(showInformationMessageStub);
    });

    it("should not fire the topicChanged event if the user cancels", async () => {
      fetchTopicAuthorizedOperationsStub.resolves(["READ", "WRITE", "DELETE"]);
      showInputBoxStub.resolves(undefined);

      await deleteTopicCommand(testTopic);

      sinon.assert.notCalled(deleteTopicStub);
      sinon.assert.notCalled(topicViewProviderRefreshStub);
    });

    it("should not fire the topicChanged event if the user doesn't have DELETE permission", async () => {
      fetchTopicAuthorizedOperationsStub.resolves(["READ", "WRITE"]);

      await deleteTopicCommand(testTopic);

      sinon.assert.calledOnce(showErrorMessageStub);
      sinon.assert.notCalled(showInputBoxStub);
      sinon.assert.notCalled(deleteTopicStub);
    });

    it("should return early if the provided argument is not a KafkaTopic instance", async () => {
      await deleteTopicCommand({} as any);

      sinon.assert.notCalled(fetchTopicAuthorizedOperationsStub);
      sinon.assert.notCalled(showInputBoxStub);
      sinon.assert.notCalled(deleteTopicStub);
    });

    it("should show an error notification if wrong topic name entered", async () => {
      fetchTopicAuthorizedOperationsStub.resolves(["READ", "WRITE", "DELETE"]);
      showInputBoxStub.resolves("wrong-topic-name");

      await deleteTopicCommand(testTopic);

      sinon.assert.calledOnce(showErrorMessageStub);
      sinon.assert.notCalled(deleteTopicStub);
    });

    it("should show an error notification when the deletion API call fails", async () => {
      fetchTopicAuthorizedOperationsStub.resolves(["READ", "WRITE", "DELETE"]);
      showInputBoxStub.resolves(testTopic.name);
      stubbedLoader.getKafkaClustersForEnvironmentId.resolves([TEST_CCLOUD_KAFKA_CLUSTER]);
      deleteTopicStub.rejects(
        new KafkaAdminError("Deletion failed", KafkaAdminErrorCategory.TRANSIENT),
      );

      await deleteTopicCommand(testTopic);

      sinon.assert.calledOnce(deleteTopicStub);
      // Error notification shown via showErrorNotificationWithButtons
    });

    it("should not fire the topicChanged event if the cluster is not found after deletion", async () => {
      fetchTopicAuthorizedOperationsStub.resolves(["READ", "WRITE", "DELETE"]);
      showInputBoxStub.resolves(testTopic.name);
      stubbedLoader.getKafkaClustersForEnvironmentId.resolves([]);

      await deleteTopicCommand(testTopic);

      sinon.assert.notCalled(deleteTopicStub);
      sinon.assert.notCalled(topicViewProviderRefreshStub);
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
