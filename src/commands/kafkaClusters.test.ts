import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import type { StubbedEventEmitters } from "../../tests/stubs/emitters";
import { eventEmitterStubs } from "../../tests/stubs/emitters";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import { getSidecarStub } from "../../tests/stubs/sidecar";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import {
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_CLUSTER,
} from "../../tests/unit/testResources/kafkaCluster";
import { createResponseError, ResponseErrorSource } from "../../tests/unit/testUtils";
import * as topicAuthz from "../authz/topics";
import { TopicV3Api } from "../clients/kafkaRest";
import { ClusterSelectSyncOption, SYNC_ON_KAFKA_SELECT } from "../extensionSettings/constants";
import type { CCloudResourceLoader } from "../loaders";
import type { CCloudFlinkDbKafkaCluster } from "../models/kafkaCluster";
import { CCloudKafkaCluster } from "../models/kafkaCluster";
import type { KafkaTopic } from "../models/topic";
import * as kafkaClusterQuickpicks from "../quickpicks/kafkaClusters";
import type { SidecarHandle } from "../sidecar";
import { TopicViewProvider } from "../viewProviders/topics";
import {
  copyBootstrapServers,
  createTopicCommand,
  deleteTopicCommand,
  selectFlinkDatabaseViewKafkaClusterCommand,
  selectTopicsViewKafkaClusterCommand,
} from "./kafkaClusters";
import * as schemaRegistryCommands from "./schemaRegistry";
import * as topicUtils from "./utils/topics";

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
    let topicChangedFireStub: sinon.SinonStub;
    let showInputBoxStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let stubbedSidecar: sinon.SinonStubbedInstance<SidecarHandle>;
    let topicV3ApiStub: sinon.SinonStubbedInstance<TopicV3Api>;
    let topicViewProviderStub: sinon.SinonStubbedInstance<TopicViewProvider>;
    let waitForTopicToExistStub: sinon.SinonStub;

    beforeEach(() => {
      topicChangedFireStub = emitterStubs.topicChanged!.fire;

      topicViewProviderStub = sandbox.createStubInstance(TopicViewProvider);
      sandbox.stub(TopicViewProvider, "getInstance").returns(topicViewProviderStub);

      showInputBoxStub = sandbox
        .stub(vscode.window, "showInputBox")
        .onFirstCall()
        .resolves("new-topic") // topic name
        .onSecondCall()
        .resolves("1") // partitions
        .onThirdCall()
        .resolves("3"); // replication factor (CCloud default)
      showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage");

      // https://github.com/confluentinc/vscode/issues/2722
      sandbox.stub(vscode.window, "withProgress").callsFake((_, callback) => {
        const mockProgress = { report: sandbox.stub() } as vscode.Progress<unknown>;
        const mockToken = {} as vscode.CancellationToken;
        return Promise.resolve(callback(mockProgress, mockToken));
      });

      stubbedSidecar = getSidecarStub(sandbox);
      topicV3ApiStub = sandbox.createStubInstance(TopicV3Api);
      stubbedSidecar.getTopicV3Api.returns(topicV3ApiStub);

      waitForTopicToExistStub = sandbox.stub(topicUtils, "waitForTopicToExist");
    });

    it("should return false if no cluster is available", async () => {
      topicViewProviderStub.kafkaCluster = null;
      sandbox.stub(kafkaClusterQuickpicks, "kafkaClusterQuickPick").resolves(undefined);

      const result = await createTopicCommand();

      assert.strictEqual(result, false);
      sinon.assert.notCalled(topicChangedFireStub);
    });

    it("should return false if user cancels out the topic name input box", async () => {
      // required to use undefined instead of the default first/second/third call resolves set in beforeEach
      showInputBoxStub.reset();
      showInputBoxStub.resolves(undefined);

      const result = await createTopicCommand(TEST_CCLOUD_KAFKA_CLUSTER);

      assert.strictEqual(result, false);
      sinon.assert.notCalled(topicChangedFireStub);
    });

    it("should fire the topicChanged event with change='added' after a topic is successfully created", async () => {
      const result = await createTopicCommand(TEST_CCLOUD_KAFKA_CLUSTER);

      assert.strictEqual(result, true);
      sinon.assert.calledOnce(waitForTopicToExistStub);
      sinon.assert.calledOnce(topicChangedFireStub);
      sinon.assert.calledWithMatch(topicChangedFireStub, {
        change: "added",
        cluster: TEST_CCLOUD_KAFKA_CLUSTER,
      });
    });

    it("should use the cluster from TopicViewProvider if no cluster is provided", async () => {
      topicViewProviderStub.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;

      const result = await createTopicCommand();

      assert.strictEqual(result, true);
      sinon.assert.calledOnce(waitForTopicToExistStub);
      sinon.assert.calledOnce(topicChangedFireStub);
      sinon.assert.calledWithMatch(topicChangedFireStub, {
        change: "added",
        cluster: TEST_CCLOUD_KAFKA_CLUSTER,
      });
    });

    it("should return false and show an error notification when an unexpected error occurs", async () => {
      topicV3ApiStub.createKafkaTopic.rejects(new Error("Network error"));

      const result = await createTopicCommand(TEST_CCLOUD_KAFKA_CLUSTER);

      assert.strictEqual(result, false);
      sinon.assert.notCalled(topicChangedFireStub);
      sinon.assert.calledOnce(showErrorMessageStub);
      sinon.assert.calledWithMatch(
        showErrorMessageStub,
        sinon.match(/Error creating topic.*Network error/),
      );
    });

    it("should return false and show a permission error notification when a 40301 error code occurs", async () => {
      const responseError = createResponseError(
        403,
        "Forbidden",
        JSON.stringify({ error_code: 40301, message: "Authorization failed." }),
        ResponseErrorSource.KafkaRest,
      );
      topicV3ApiStub.createKafkaTopic.rejects(responseError);

      const result = await createTopicCommand(TEST_CCLOUD_KAFKA_CLUSTER);

      assert.strictEqual(result, false);
      sinon.assert.notCalled(topicChangedFireStub);
      sinon.assert.calledOnce(showErrorMessageStub);
      sinon.assert.calledWithMatch(
        showErrorMessageStub,
        sinon.match(/do not have permission to create topics/),
      );
    });

    it("should return false and show a generic error notification when a non-40301 error code occurs", async () => {
      const responseError = createResponseError(
        409,
        "Conflict",
        JSON.stringify({ error_code: 40901, message: "Topic already exists" }),
        ResponseErrorSource.KafkaRest,
      );
      topicV3ApiStub.createKafkaTopic.rejects(responseError);

      const result = await createTopicCommand(TEST_CCLOUD_KAFKA_CLUSTER);

      assert.strictEqual(result, false);
      sinon.assert.notCalled(topicChangedFireStub);
      sinon.assert.calledOnce(showErrorMessageStub);
      sinon.assert.calledWithMatch(
        showErrorMessageStub,
        sinon.match(/Error creating topic.*40901/),
      );
    });

    it("should return false when ResponseError response.json() fails to parse", async () => {
      const responseError = createResponseError(
        500,
        "Server Error",
        "not valid json",
        ResponseErrorSource.KafkaRest,
      );
      topicV3ApiStub.createKafkaTopic.rejects(responseError);

      const result = await createTopicCommand(TEST_CCLOUD_KAFKA_CLUSTER);

      assert.strictEqual(result, false);
      sinon.assert.notCalled(topicChangedFireStub);
    });
  });

  describe("deleteTopicCommand", () => {
    let topicChangedFireStub: sinon.SinonStub;
    let showInputBoxStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let stubbedSidecar: sinon.SinonStubbedInstance<SidecarHandle>;
    let topicV3ApiStub: sinon.SinonStubbedInstance<TopicV3Api>;
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
    let fetchTopicAuthorizedOperationsStub: sinon.SinonStub;
    let waitForTopicToBeDeletedStub: sinon.SinonStub;

    beforeEach(() => {
      topicChangedFireStub = emitterStubs.topicChanged!.fire;

      showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
      showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage");
      // https://github.com/confluentinc/vscode/issues/2722
      sandbox.stub(vscode.window, "withProgress").callsFake((_, callback) => {
        const mockProgress = { report: sandbox.stub() } as vscode.Progress<unknown>;
        const mockToken = {} as vscode.CancellationToken;
        return Promise.resolve(callback(mockProgress, mockToken));
      });

      stubbedSidecar = getSidecarStub(sandbox);
      topicV3ApiStub = sandbox.createStubInstance(TopicV3Api);
      stubbedSidecar.getTopicV3Api.returns(topicV3ApiStub);

      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);

      // user has delete permission by default; individual tests can override as needed
      fetchTopicAuthorizedOperationsStub = sandbox
        .stub(topicAuthz, "fetchTopicAuthorizedOperations")
        .resolves(["DELETE"]);

      waitForTopicToBeDeletedStub = sandbox.stub(topicUtils, "waitForTopicToBeDeleted");
    });

    it("should fire the topicChanged event with change='deleted' after successful deletion", async () => {
      showInputBoxStub.resolves(TEST_CCLOUD_KAFKA_TOPIC.name);
      stubbedLoader.getKafkaClustersForEnvironmentId.resolves([TEST_CCLOUD_KAFKA_CLUSTER]);

      await deleteTopicCommand(TEST_CCLOUD_KAFKA_TOPIC);

      sinon.assert.calledOnce(waitForTopicToBeDeletedStub);
      sinon.assert.calledOnce(topicChangedFireStub);
      sinon.assert.calledWithMatch(topicChangedFireStub, {
        change: "deleted",
        cluster: sinon.match({ id: TEST_CCLOUD_KAFKA_CLUSTER.id }),
      });
    });

    it("should not fire the topicChanged event if the user cancels the deletion confirmation input box", async () => {
      showInputBoxStub.resolves(undefined);

      await deleteTopicCommand(TEST_CCLOUD_KAFKA_TOPIC);

      sinon.assert.notCalled(topicChangedFireStub);
    });

    it("should not fire the topicChanged event if the user doesn't have DELETE permission", async () => {
      fetchTopicAuthorizedOperationsStub.resolves(["READ", "WRITE"]);

      await deleteTopicCommand(TEST_CCLOUD_KAFKA_TOPIC);

      sinon.assert.notCalled(showInputBoxStub);
      sinon.assert.notCalled(topicChangedFireStub);
    });

    it("should return early if the provided argument is not a KafkaTopic instance", async () => {
      await deleteTopicCommand({} as KafkaTopic);

      sinon.assert.notCalled(fetchTopicAuthorizedOperationsStub);
      sinon.assert.notCalled(showInputBoxStub);
      sinon.assert.notCalled(topicChangedFireStub);
    });

    it("should show an error notification and not delete the topic if the user enters the wrong topic name", async () => {
      showInputBoxStub.resolves("wrong-topic-name");

      await deleteTopicCommand(TEST_CCLOUD_KAFKA_TOPIC);

      sinon.assert.notCalled(topicV3ApiStub.deleteKafkaTopic);
      sinon.assert.notCalled(topicChangedFireStub);
      sinon.assert.calledOnce(showErrorMessageStub);
      sinon.assert.calledWithMatch(showErrorMessageStub, sinon.match(/does not match/));
    });

    it("should show an error notification when the deletion API call fails", async () => {
      showInputBoxStub.resolves(TEST_CCLOUD_KAFKA_TOPIC.name);
      topicV3ApiStub.deleteKafkaTopic.rejects(new Error("API error"));

      await deleteTopicCommand(TEST_CCLOUD_KAFKA_TOPIC);

      sinon.assert.notCalled(topicChangedFireStub);
      sinon.assert.calledOnce(showErrorMessageStub);
      sinon.assert.calledWithMatch(
        showErrorMessageStub,
        sinon.match(/Failed to delete topic.*API error/),
      );
    });

    // rare edge case since we shouldn't lose track of a cluster if we just used it to delete a topic
    it("should not fire the topicChanged event if the cluster is not found after deletion", async () => {
      showInputBoxStub.resolves(TEST_CCLOUD_KAFKA_TOPIC.name);
      stubbedLoader.getKafkaClustersForEnvironmentId.resolves([]);

      await deleteTopicCommand(TEST_CCLOUD_KAFKA_TOPIC);

      sinon.assert.calledOnce(waitForTopicToBeDeletedStub);
      sinon.assert.notCalled(topicChangedFireStub);
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
