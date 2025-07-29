import * as assert from "assert";
import * as sinon from "sinon";
import { SinonStubbedInstance } from "sinon";
import { TreeItemCollapsibleState, window } from "vscode";
import { eventEmitterStubs, StubbedEventEmitters } from "../../tests/stubs/emitters";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_ENVIRONMENT_ID,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SUBJECT,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
  TEST_LOCAL_ENVIRONMENT_ID,
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_SCHEMA,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import * as contextValues from "../context/values";
import { EventChangeType, SubjectChangeEvent } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { TopicFetchError } from "../loaders/loaderUtils";
import { CCloudEnvironment } from "../models/environment";
import { EnvironmentId } from "../models/resource";
import { SchemaTreeItem, Subject, SubjectTreeItem } from "../models/schema";
import { KafkaTopic, KafkaTopicTreeItem } from "../models/topic";
import * as telemetryEvents from "../telemetry/events";
import { SEARCH_DECORATION_URI_SCHEME } from "./search";
import { TopicViewProvider } from "./topics";

describe("TopicViewProvider", () => {
  let provider: TopicViewProvider;
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    // test a detached instance.
    // @ts-expect-error constructor is private for the main codebase
    // to force using getInstance() to get the singleton.
    provider = new TopicViewProvider();
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    provider.dispose();
    sandbox.restore();
  });

  describe("getTreeItem()", () => {
    it("getTreeItem() should return a SchemaTreeItem for a Schema instance", () => {
      const treeItem = provider.getTreeItem(TEST_CCLOUD_SCHEMA);
      assert.ok(treeItem instanceof SchemaTreeItem);
    });

    it("getTreeItem() should return a KafkaTopicTreeItem for a KafkaTopic instance", () => {
      const treeItem = provider.getTreeItem(TEST_CCLOUD_KAFKA_TOPIC);
      assert.ok(treeItem instanceof KafkaTopicTreeItem);
    });

    it("getTreeItem() should return a SubjectTreeItem when given a Subject", () => {
      const treeItem = provider.getTreeItem(TEST_CCLOUD_SUBJECT_WITH_SCHEMAS);
      assert.ok(treeItem instanceof SubjectTreeItem);
    });
  });

  describe("isFocusedOnCCloud()", () => {
    it("isFocusedOnCCloud() should return true when the cluster is a CCloud one", () => {
      provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
      assert.strictEqual(provider.isFocusedOnCCloud(), true);
    });

    it("isFocusedOnCCloud() should return false when the cluster is not a CCloud one", () => {
      provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER;
      assert.strictEqual(provider.isFocusedOnCCloud(), false);
    });

    it("isFocusedOnCCloud() should return false when the cluster is null", () => {
      provider.kafkaCluster = null;
      assert.strictEqual(provider.isFocusedOnCCloud(), false);
    });
  });

  describe("updateTreeViewDescription()", () => {
    const initialDescription = "Initial description";

    let ccloudLoader: SinonStubbedInstance<CCloudResourceLoader>;

    function getDescription(): string | undefined {
      return provider["treeView"].description;
    }

    beforeEach(() => {
      provider["treeView"].description = initialDescription;
      ccloudLoader = getStubbedCCloudResourceLoader(sandbox);
    });

    it("does nothing when no cluster is set", async () => {
      provider.kafkaCluster = null;
      await provider.updateTreeViewDescription();
      assert.strictEqual(getDescription(), initialDescription);
    });

    it("sets to mix of cluster name and environment name when cluster is set", async () => {
      provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER; // in TEST_CCLOUD_ENVIRONMENT.

      // Wire up ccloudLoader.getEnvironments to return two environments, one of which is the parent environment.
      const parentEnvironment = {
        ...TEST_CCLOUD_ENVIRONMENT,
        name: "Test Env Name",
      } as CCloudEnvironment;

      const testEnvironments = [
        {
          ...TEST_CCLOUD_ENVIRONMENT,
          id: "some other env" as EnvironmentId,
          name: "Test Environment",
        },
        parentEnvironment,
      ] as CCloudEnvironment[];

      ccloudLoader.getEnvironments.resolves(testEnvironments);

      await provider.updateTreeViewDescription();

      assert.strictEqual(
        getDescription(),
        `${parentEnvironment.name} | ${TEST_CCLOUD_KAFKA_CLUSTER.name}`,
      );
    });

    it("sets to cluster name when no parent environment is found", async () => {
      provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER; // in TEST_CCLOUD_ENVIRONMENT.

      // Wire up ccloudLoader.getEnvironments to return an empty array, hitting warning case.
      ccloudLoader.getEnvironments.resolves([]);

      await provider.updateTreeViewDescription();

      assert.strictEqual(getDescription(), TEST_CCLOUD_KAFKA_CLUSTER.name);
    });
  });

  describe("TopicViewProvider search behavior", () => {
    let ccloudLoader: CCloudResourceLoader;
    let getTopicsForClusterStub: sinon.SinonStub;
    let getSubjectsStub: sinon.SinonStub;
    let getSchemasForSubjectStub: sinon.SinonStub;

    beforeEach(async () => {
      // stub the methods called while inside loadTopicSchemas() since we can't stub it directly
      ccloudLoader = CCloudResourceLoader.getInstance();
      getTopicsForClusterStub = sandbox.stub(ccloudLoader, "getTopicsForCluster").resolves([]);
      getSubjectsStub = sandbox.stub(ccloudLoader, "getSubjects").resolves([]);
      getSchemasForSubjectStub = sandbox.stub(ccloudLoader, "getSchemasForSubject").resolves([]);

      provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
    });

    it("getChildren() should filter root-level topics based on search string", async () => {
      getTopicsForClusterStub.resolves([TEST_CCLOUD_KAFKA_TOPIC]);
      // Topic name matches the search string
      provider.topicSearchSetHandler(TEST_CCLOUD_KAFKA_TOPIC.name);

      const rootElements = await provider.getChildren();

      assert.strictEqual(rootElements.length, 1);
      assert.deepStrictEqual(rootElements[0], TEST_CCLOUD_KAFKA_TOPIC);
    });

    it("getChildren() should showErrorMessage if loader.getTopicsForCluster() raises TopicFetchError", async () => {
      const showErrorMessageStub = sandbox.stub(window, "showErrorMessage");
      getTopicsForClusterStub.rejects(new TopicFetchError("Test error"));

      const shouldBeEmpty = await provider.getChildren();
      sinon.assert.calledOnce(showErrorMessageStub);
      assert.strictEqual(shouldBeEmpty.length, 0);
    });

    it("getChildren() should filter schema subject containers based on search string", async () => {
      getSubjectsStub.resolves([
        TEST_CCLOUD_SCHEMA.subjectObject(),
        TEST_LOCAL_SCHEMA.subjectObject(), // has different subject name at least. Should be skipped 'cause won't match search.
      ]);
      getSchemasForSubjectStub.resolves([TEST_CCLOUD_SCHEMA]);
      // Schema subject matches the search string
      provider.topicSearchSetHandler(TEST_CCLOUD_SCHEMA.subject);

      const children = await provider.getChildren(TEST_CCLOUD_KAFKA_TOPIC);

      // Will be a Subject carrying one single Schema, TEST_CCLOUD_SCHEMA.
      assert.strictEqual(children.length, 1);
      assert.ok(children[0] instanceof Subject);
      assert.equal(children[0].name, TEST_CCLOUD_SCHEMA.subject);
      assert.equal(children[0].schemas!.length, 1);
    });

    it("getChildren() should show correct count in tree view message when items match search", async () => {
      getTopicsForClusterStub.resolves([
        TEST_CCLOUD_KAFKA_TOPIC,
        KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, name: "other-topic" }),
      ]);
      // Topic name matches the search string of one topic
      const searchStr = TEST_CCLOUD_KAFKA_TOPIC.name;
      provider.topicSearchSetHandler(searchStr);

      await provider.getChildren();

      assert.strictEqual(provider.searchMatches.size, 1);
      assert.strictEqual(provider.totalItemCount, 2);
      assert.strictEqual(
        provider["treeView"].message,
        `Showing ${provider.searchMatches.size} of ${provider.totalItemCount} for "${searchStr}"`,
      );
    });

    it("getChildren() should clear tree view message when search is cleared", async () => {
      // Search cleared
      provider.topicSearchSetHandler(null);

      await provider.getChildren();

      assert.strictEqual(provider["treeView"].message, undefined);
    });

    it("getTreeItem() should set the resourceUri of topic items whose name matches the search string", () => {
      // Topic name matches the search string
      provider.topicSearchSetHandler(TEST_CCLOUD_KAFKA_TOPIC.name);

      const treeItem = provider.getTreeItem(TEST_CCLOUD_KAFKA_TOPIC);

      assert.ok(treeItem instanceof KafkaTopicTreeItem);
      assert.strictEqual(treeItem.resourceUri?.scheme, SEARCH_DECORATION_URI_SCHEME);
    });

    it("getTreeItem() should set the resourceUri of schema subject containers whose subject matches the search string", () => {
      // Schema ID matches the search string
      provider.topicSearchSetHandler(TEST_CCLOUD_SCHEMA.subject);

      const treeItem = provider.getTreeItem(TEST_CCLOUD_SUBJECT_WITH_SCHEMAS);

      assert.ok(treeItem instanceof SubjectTreeItem);
      assert.ok(treeItem.resourceUri);
      assert.strictEqual(treeItem.resourceUri?.scheme, SEARCH_DECORATION_URI_SCHEME);
    });

    it("getTreeItem() should expand topic items when their schemas match search", () => {
      const topic = KafkaTopic.create({
        ...TEST_CCLOUD_KAFKA_TOPIC,
        children: [TEST_CCLOUD_SUBJECT],
      });
      // Schema subject matches search
      provider.topicSearchSetHandler(TEST_CCLOUD_SCHEMA.subject);

      const treeItem = provider.getTreeItem(topic);

      assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.Expanded);
    });

    it("getTreeItem() should collapse topic items when schemas exist but don't match search", () => {
      const topic = KafkaTopic.create({
        ...TEST_CCLOUD_KAFKA_TOPIC,
        children: [TEST_CCLOUD_SUBJECT],
      });
      // Search string doesn't match topic or schema
      provider.topicSearchSetHandler("non-matching-search");

      const treeItem = provider.getTreeItem(topic);

      assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.Collapsed);
    });
  });

  describe("TopicViewProvider event handlers", () => {
    let resetStub: sinon.SinonStub;
    let refreshStub: sinon.SinonStub;
    let updateTreeViewDescriptionStub: sinon.SinonStub;

    beforeEach(() => {
      resetStub = sandbox.stub(provider, "reset");
      refreshStub = sandbox.stub(provider, "refresh");
      updateTreeViewDescriptionStub = sandbox.stub(provider, "updateTreeViewDescription");
    });

    describe("environmentChangedHandler", () => {
      beforeEach(() => {
        // default to viewing kafka cluster in local environment
        provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER;
      });

      it("should call reset() when environment is deleted", async () => {
        await provider.environmentChangedHandler({
          id: TEST_LOCAL_ENVIRONMENT_ID,
          wasDeleted: true,
        });
        sinon.assert.calledOnce(resetStub);
        sinon.assert.notCalled(updateTreeViewDescriptionStub);
        sinon.assert.notCalled(refreshStub);
      });

      it("should call updateTreeViewDescription() and refresh() when environment is changed but not deleted", async () => {
        await provider.environmentChangedHandler({
          id: TEST_LOCAL_ENVIRONMENT_ID,
          wasDeleted: false,
        });
        sinon.assert.notCalled(resetStub);
        sinon.assert.calledOnce(updateTreeViewDescriptionStub);
        sinon.assert.calledOnce(refreshStub);
      });

      it("should not call any methods when the event is for a different environment", async () => {
        await provider.environmentChangedHandler({
          id: TEST_CCLOUD_ENVIRONMENT_ID,
          wasDeleted: false,
        });
        sinon.assert.notCalled(resetStub);
        sinon.assert.notCalled(updateTreeViewDescriptionStub);
        sinon.assert.notCalled(refreshStub);
      });

      it("should not call any methods when no cluster is set", async () => {
        provider.kafkaCluster = null;
        await provider.environmentChangedHandler({
          id: TEST_LOCAL_ENVIRONMENT_ID,
          wasDeleted: false,
        });
        sinon.assert.notCalled(resetStub);
        sinon.assert.notCalled(updateTreeViewDescriptionStub);
        sinon.assert.notCalled(refreshStub);
      });
    });

    describe("ccloudConnectedHandler", () => {
      for (const nowConnected of [true, false]) {
        it(`should call reset() when initially connected to CCloud and connected event: ${nowConnected}`, () => {
          provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER; // Ensure we are in a CCloud context
          provider.ccloudConnectedHandler(nowConnected);
          sinon.assert.calledOnce(resetStub);
          sinon.assert.notCalled(updateTreeViewDescriptionStub);
          sinon.assert.notCalled(refreshStub);
        });

        it(`should not call any methods when looking at a non-CCloud cluster and connected event: ${nowConnected}`, () => {
          provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER; // Ensure we are in a non-CCloud context
          provider.ccloudConnectedHandler(nowConnected);
          sinon.assert.notCalled(resetStub);
          sinon.assert.notCalled(updateTreeViewDescriptionStub);
          sinon.assert.notCalled(refreshStub);
        });

        it(`should not call any methods when no cluster is set and connected event: ${nowConnected}`, () => {
          provider.kafkaCluster = null; // No cluster set
          provider.ccloudConnectedHandler(nowConnected);
          sinon.assert.notCalled(resetStub);
          sinon.assert.notCalled(updateTreeViewDescriptionStub);
          sinon.assert.notCalled(refreshStub);
        });
      }
    });

    describe("localKafkaConnectedHandler", () => {
      for (const nowConnected of [true, false]) {
        it(`should call reset() when initially connected to local Kafka and connected event: ${nowConnected}`, () => {
          provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER; // Ensure we are in a local context
          provider.localKafkaConnectedHandler(nowConnected);
          sinon.assert.calledOnce(resetStub);
          sinon.assert.notCalled(updateTreeViewDescriptionStub);
          sinon.assert.notCalled(refreshStub);
        });

        it(`should not call any methods when looking at a non-local cluster and connected event: ${nowConnected}`, () => {
          provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER; // Ensure we are in a non-local context
          provider.localKafkaConnectedHandler(nowConnected);
          sinon.assert.notCalled(resetStub);
          sinon.assert.notCalled(updateTreeViewDescriptionStub);
          sinon.assert.notCalled(refreshStub);
        });

        it(`should not call any methods when no cluster is set and connected event: ${nowConnected}`, () => {
          provider.kafkaCluster = null; // No cluster set
          provider.localKafkaConnectedHandler(nowConnected);
          sinon.assert.notCalled(resetStub);
          sinon.assert.notCalled(updateTreeViewDescriptionStub);
          sinon.assert.notCalled(refreshStub);
        });
      }
    });

    describe("currentKafkaClusterChangedHandler", () => {
      let setSearchStub: sinon.SinonStub;
      let setContextValueStub: sinon.SinonStub;
      beforeEach(() => {
        setSearchStub = sandbox.stub(provider, "setSearch");
        setContextValueStub = sandbox.stub(contextValues, "setContextValue");
      });

      it("should do nothing when current cluster is null and called with null", async () => {
        await provider.currentKafkaClusterChangedHandler(null);
        sinon.assert.notCalled(resetStub);
        sinon.assert.notCalled(updateTreeViewDescriptionStub);
        sinon.assert.notCalled(refreshStub);
        sinon.assert.notCalled(setSearchStub);
      });

      it("should do nothing when called with the same cluster", async () => {
        provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER;
        await provider.currentKafkaClusterChangedHandler(TEST_LOCAL_KAFKA_CLUSTER);
        sinon.assert.notCalled(resetStub);
        sinon.assert.notCalled(updateTreeViewDescriptionStub);
        sinon.assert.notCalled(refreshStub);
        sinon.assert.notCalled(setSearchStub);
      });

      it("should only call reset() when edging from having cluster set to no cluster", async () => {
        provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER;
        await provider.currentKafkaClusterChangedHandler(null);
        sinon.assert.calledOnce(resetStub);
        sinon.assert.notCalled(updateTreeViewDescriptionStub);
        sinon.assert.notCalled(refreshStub);
        sinon.assert.notCalled(setSearchStub);
      });

      it("should handle switching clusters correctly", async () => {
        provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER;
        await provider.currentKafkaClusterChangedHandler(TEST_CCLOUD_KAFKA_CLUSTER);
        assert.deepEqual(provider.kafkaCluster, TEST_CCLOUD_KAFKA_CLUSTER);

        sinon.assert.calledOnce(setContextValueStub);
        sinon.assert.calledWith(
          setContextValueStub,
          contextValues.ContextValues.kafkaClusterSelected,
          true,
        );
        sinon.assert.calledOnce(setSearchStub);
        sinon.assert.calledOnce(updateTreeViewDescriptionStub);
        sinon.assert.calledOnce(refreshStub);
      });
    });

    describe("topicSearchSetHandler", () => {
      let setSearchStub: sinon.SinonStub;
      let logUsageStub: sinon.SinonStub;

      beforeEach(() => {
        setSearchStub = sandbox.stub(provider, "setSearch");
        logUsageStub = sandbox.stub(telemetryEvents, "logUsage");
      });

      it("should call setSearch() with the search string", () => {
        const searchString = "test-search";
        provider.topicSearchSetHandler(searchString);
        sinon.assert.calledOnce(setSearchStub);
        sinon.assert.calledWith(setSearchStub, searchString);
        sinon.assert.calledOnce(logUsageStub);
        sinon.assert.calledOnce(refreshStub);
        assert.strictEqual(provider.searchStringSetCount, 1);
      });

      it("should call setSearch() with null when search string is null, but not increment searchStringSetCount", () => {
        provider.topicSearchSetHandler(null);
        sinon.assert.calledOnce(setSearchStub);
        sinon.assert.calledWith(setSearchStub, null);
        sinon.assert.calledOnce(logUsageStub);
        sinon.assert.calledOnce(refreshStub);
        assert.strictEqual(provider.searchStringSetCount, 0);
      });
    });

    describe("subjectChangedHandler", () => {
      it("ignores when not focused on any Kafka cluster", () => {
        provider.kafkaCluster = null;
        provider.subjectChangeHandler({
          subject: TEST_CCLOUD_SUBJECT,
          change: "added",
        } as SubjectChangeEvent);
        sinon.assert.notCalled(refreshStub);
      });

      it("ignores when event is for a different environment", () => {
        provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER;
        provider.subjectChangeHandler({
          subject: TEST_CCLOUD_SUBJECT,
          change: "added",
        } as SubjectChangeEvent);
        sinon.assert.notCalled(refreshStub);
      });

      for (const change of ["added", "deleted"] as EventChangeType[]) {
        it(`calls reset() when a subject is ${change} in the current environment`, () => {
          provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
          provider.subjectChangeHandler({
            subject: TEST_CCLOUD_SUBJECT,
            change,
          } as SubjectChangeEvent);
          sinon.assert.calledOnce(refreshStub);
        });
      }
    });
  });

  describe("setEventListeners() wires the proper handler methods to the proper event emitters", () => {
    let emitterStubs: StubbedEventEmitters;

    beforeEach(() => {
      // Stub all event emitters in the emitters module
      emitterStubs = eventEmitterStubs(sandbox);
    });

    // Define test cases as corresponding pairs of
    // [event emitter name, view provider handler method name]
    const handlerEmitterPairs: Array<[keyof typeof emitterStubs, keyof TopicViewProvider]> = [
      ["environmentChanged", "environmentChangedHandler"],
      ["ccloudConnected", "ccloudConnectedHandler"],
      ["localKafkaConnected", "localKafkaConnectedHandler"],
      ["currentKafkaClusterChanged", "currentKafkaClusterChangedHandler"],
      ["topicSearchSet", "topicSearchSetHandler"],
      ["schemaSubjectChanged", "subjectChangeHandler"],
      ["schemaVersionsChanged", "subjectChangeHandler"],
    ];

    it("setEventListeners should return the expected number of listeners", () => {
      const listeners = provider.setEventListeners();
      assert.strictEqual(listeners.length, handlerEmitterPairs.length);
    });

    handlerEmitterPairs.forEach(([emitterName, handlerMethodName]) => {
      it(`should register ${handlerMethodName} with ${emitterName} emitter`, () => {
        // Create stub for the handler method
        const handlerStub = sandbox.stub(provider, handlerMethodName);

        // Re-invoke setEventListeners() to capture emitter .event() stub calls
        provider.setEventListeners();

        const emitterStub = emitterStubs[emitterName]!;
        // Verify the emitter's event method was called
        sinon.assert.calledOnce(emitterStub.event);

        // Capture the handler function that was registered
        const registeredHandler = emitterStub.event.firstCall.args[0];

        // Call the registered handler
        registeredHandler();

        // Verify the expected method stub was called,
        // proving that the expected handler was registered
        // to the expected emitter.
        sinon.assert.calledOnce(handlerStub);
      });
    });
  });
});
