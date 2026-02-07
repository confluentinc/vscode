import * as assert from "assert";
import * as sinon from "sinon";
import { window } from "vscode";
import type { StubbedEventEmitters } from "../../tests/stubs/emitters";
import { eventEmitterStubs } from "../../tests/stubs/emitters";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_ENVIRONMENT_ID,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SUBJECT,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMA,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
  TEST_LOCAL_ENVIRONMENT_ID,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import type { EventChangeType, SubjectChangeEvent } from "../emitters";
import type { CCloudResourceLoader } from "../loaders";
import { TopicFetchError } from "../loaders/utils/loaderUtils";
import { SchemaTreeItem, Subject, SubjectTreeItem } from "../models/schema";
import { KafkaTopic, KafkaTopicTreeItem } from "../models/topic";
import { TopicViewProvider } from "./topics";

const testTopicWithSchema = new KafkaTopic({
  ...TEST_CCLOUD_KAFKA_TOPIC,
  children: [TEST_CCLOUD_SUBJECT_WITH_SCHEMA],
});

describe("viewProviders/topics.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("TopicViewProvider", () => {
    let provider: TopicViewProvider;
    let stubbedLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

    beforeEach(() => {
      provider = new TopicViewProvider();
      provider["initialize"]();

      stubbedLoader = getStubbedCCloudResourceLoader(sandbox);
      stubbedLoader.getTopicsForCluster.resolves([]);
    });

    afterEach(() => {
      provider.dispose();
    });

    describe("refresh()", () => {
      let onDidChangeTreeDataFireStub: sinon.SinonStub;

      beforeEach(() => {
        onDidChangeTreeDataFireStub = sandbox.stub(provider["_onDidChangeTreeData"], "fire");
      });

      it("no-arg refresh() when focused on a cluster should call onDidChangeTreeData.fire()", async () => {
        provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
        await provider.refresh();
        sinon.assert.calledOnce(onDidChangeTreeDataFireStub);
      });

      it("no-arg refresh() when no cluster is set should call onDidChangeTreeData.fire() once to clear (disconnect scenario)", async () => {
        provider.kafkaCluster = null;
        await provider.refresh();
        sinon.assert.calledOnce(onDidChangeTreeDataFireStub);
      });

      it("refresh(true) should pass forceDeepRefresh=true to loader", async () => {
        provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
        await provider.refresh(true);
        sinon.assert.calledWith(stubbedLoader.getTopicsForCluster, TEST_CCLOUD_KAFKA_CLUSTER, true);
      });

      it("refresh(false) should pass forceDeepRefresh=false to loader", async () => {
        provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
        await provider.refresh(false);
        sinon.assert.calledWith(
          stubbedLoader.getTopicsForCluster,
          TEST_CCLOUD_KAFKA_CLUSTER,
          false,
        );
      });

      it("onlyIfMatching a kafka cluster when no cluster is set should do nothing", async () => {
        provider.kafkaCluster = null;
        await provider.refresh(false, TEST_LOCAL_KAFKA_CLUSTER);
        sinon.assert.notCalled(onDidChangeTreeDataFireStub);
      });

      it("onlyIfMatching a kafka cluster when the cluster doesn't match should do nothing", async () => {
        provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER;
        await provider.refresh(false, TEST_CCLOUD_KAFKA_CLUSTER);
        sinon.assert.notCalled(onDidChangeTreeDataFireStub);
      });

      it("onlyIfMatching a kafka cluster when the cluster matches should call onDidChangeTreeData.fire()", async () => {
        provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
        await provider.refresh(false, TEST_CCLOUD_KAFKA_CLUSTER);
        sinon.assert.calledOnce(onDidChangeTreeDataFireStub);
      });

      it("onlyIfMatching a contained Kafka topic when the cluster doesn't match should do nothing", async () => {
        provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER;
        await provider.refresh(false, TEST_CCLOUD_KAFKA_TOPIC);
        sinon.assert.notCalled(onDidChangeTreeDataFireStub);
      });

      it("onlyIfMatching a contained Kafka topic when the cluster matches should call onDidChangeTreeData.fire()", async () => {
        provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
        await provider.refresh(false, TEST_CCLOUD_KAFKA_TOPIC);
        sinon.assert.calledOnce(onDidChangeTreeDataFireStub);
      });
    });

    describe("refreshTopics()", () => {
      beforeEach(() => {
        provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
      });

      it("should populate topicsInTreeView from loader results", async () => {
        stubbedLoader.getTopicsForCluster.resolves([TEST_CCLOUD_KAFKA_TOPIC]);

        await provider.refreshTopics(TEST_CCLOUD_KAFKA_CLUSTER, false);

        assert.strictEqual(provider["topicsInTreeView"].size, 1);
        assert.deepStrictEqual(
          provider["topicsInTreeView"].get(TEST_CCLOUD_KAFKA_TOPIC.name),
          TEST_CCLOUD_KAFKA_TOPIC,
        );
      });

      it("should populate subjectsInTreeView and subjectToTopicMap when topics have associated Subjects", async () => {
        stubbedLoader.getTopicsForCluster.resolves([testTopicWithSchema]);

        await provider.refreshTopics(TEST_CCLOUD_KAFKA_CLUSTER, false);

        assert.strictEqual(provider["subjectsInTreeView"].size, 1);
        assert.strictEqual(provider["subjectToTopicMap"].size, 1);
        assert.deepStrictEqual(
          provider["subjectToTopicMap"].get(TEST_CCLOUD_SUBJECT_WITH_SCHEMA.name),
          testTopicWithSchema,
        );
      });

      it("should call showErrorMessage when loader raises a TopicFetchError", async () => {
        const showErrorMessageStub = sandbox.stub(window, "showErrorMessage");
        stubbedLoader.getTopicsForCluster.rejects(new TopicFetchError("Test error"));

        await provider.refreshTopics(TEST_CCLOUD_KAFKA_CLUSTER, false);

        assert.strictEqual(provider["topicsInTreeView"].size, 0);
        sinon.assert.calledOnce(showErrorMessageStub);
      });
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

    describe("getChildren()", () => {
      beforeEach(() => {
        // set focused cluster but no cached topics by default
        provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
      });

      it("should return an empty array when no cluster is focused", () => {
        provider.kafkaCluster = null;

        const children = provider.getChildren();

        assert.strictEqual(children.length, 0);
      });

      it("should return topics from topicsInTreeView at the root level", () => {
        provider["topicsInTreeView"].set(TEST_CCLOUD_KAFKA_TOPIC.name, TEST_CCLOUD_KAFKA_TOPIC);

        const children = provider.getChildren();

        assert.strictEqual(children.length, 1);
        assert.deepStrictEqual(children[0], TEST_CCLOUD_KAFKA_TOPIC);
      });

      it("should return subjects from topic.children when expanding a topic", () => {
        provider["topicsInTreeView"].set(testTopicWithSchema.name, testTopicWithSchema);
        provider["subjectsInTreeView"].set(
          testTopicWithSchema.children[0].name,
          testTopicWithSchema.children[0],
        );

        const topicChildren = provider.getChildren(testTopicWithSchema);

        assert.strictEqual(topicChildren.length, 1);
        assert.ok(topicChildren[0] instanceof Subject);
      });

      it("should return an empty array when expanding a topic not in the cache", () => {
        // not preloaded in topicsInTreeView
        const children = provider.getChildren(TEST_CCLOUD_KAFKA_TOPIC);

        assert.strictEqual(children.length, 0);
      });

      it("should return schemas from subject.schemas when expanding a subject", () => {
        provider["subjectsInTreeView"].set(
          TEST_CCLOUD_SUBJECT_WITH_SCHEMA.name,
          TEST_CCLOUD_SUBJECT_WITH_SCHEMA,
        );

        const subjectChildren = provider.getChildren(TEST_CCLOUD_SUBJECT_WITH_SCHEMA);

        assert.strictEqual(subjectChildren.length, 1);
        assert.deepStrictEqual(subjectChildren, TEST_CCLOUD_SUBJECT_WITH_SCHEMA.schemas);
      });

      it("should return an empty array when expanding a subject not in the cache", () => {
        // subject is not in subjectsInTreeView
        const children = provider.getChildren(TEST_CCLOUD_SUBJECT);

        assert.strictEqual(children.length, 0);
      });
    });

    describe("getParent()", () => {
      it("should return undefined for a KafkaTopic (root-level item)", () => {
        const parent = provider.getParent(TEST_CCLOUD_KAFKA_TOPIC);

        assert.strictEqual(parent, undefined);
      });

      it("should return the parent topic for a Subject", () => {
        provider["subjectToTopicMap"].set(
          testTopicWithSchema.children[0].name,
          testTopicWithSchema,
        );

        const parent = provider.getParent(testTopicWithSchema.children[0]);

        assert.deepStrictEqual(parent, testTopicWithSchema);
      });

      it("should return undefined for a Subject not in the cache", () => {
        const parent = provider.getParent(TEST_CCLOUD_SUBJECT);

        assert.strictEqual(parent, undefined);
      });

      it("should return the parent subject for a Schema", () => {
        provider["subjectsInTreeView"].set(
          TEST_CCLOUD_SUBJECT_WITH_SCHEMA.name,
          TEST_CCLOUD_SUBJECT_WITH_SCHEMA,
        );

        const parent = provider.getParent(TEST_CCLOUD_SCHEMA);

        assert.deepStrictEqual(parent, TEST_CCLOUD_SUBJECT_WITH_SCHEMA);
      });

      it("should return undefined for a Schema whose subject is not in the cache", () => {
        const parent = provider.getParent(TEST_CCLOUD_SCHEMA);

        assert.strictEqual(parent, undefined);
      });
    });

    describe("updateSubjectSchemas()", () => {
      let onDidChangeTreeDataFireStub: sinon.SinonStub;

      beforeEach(() => {
        provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
        onDidChangeTreeDataFireStub = sandbox.stub(provider["_onDidChangeTreeData"], "fire");
      });

      it("should fetch schemas and update subject when kafkaCluster is set", async () => {
        const subjectWithoutSchemas = new Subject(
          TEST_CCLOUD_SUBJECT.name,
          TEST_CCLOUD_SUBJECT.connectionId,
          TEST_CCLOUD_SUBJECT.environmentId,
          TEST_CCLOUD_SUBJECT.schemaRegistryId,
          null,
        );
        stubbedLoader.getSchemasForSubject.resolves([TEST_CCLOUD_SCHEMA]);

        await provider["updateSubjectSchemas"](subjectWithoutSchemas);

        assert.deepStrictEqual(subjectWithoutSchemas.schemas, [TEST_CCLOUD_SCHEMA]);
        sinon.assert.calledOnceWithExactly(onDidChangeTreeDataFireStub, subjectWithoutSchemas);
      });

      it("should return early when no kafkaCluster is set", async () => {
        provider.kafkaCluster = null;

        await provider["updateSubjectSchemas"](TEST_CCLOUD_SUBJECT);

        sinon.assert.notCalled(stubbedLoader.getSchemasForSubject);
        sinon.assert.notCalled(onDidChangeTreeDataFireStub);
      });
    });

    describe("reveal()", () => {
      let treeViewRevealStub: sinon.SinonStub;

      beforeEach(() => {
        treeViewRevealStub = sandbox.stub(provider["treeView"], "reveal").resolves();
      });

      it("should reveal a KafkaTopic from the cache", async () => {
        provider["topicsInTreeView"].set(TEST_CCLOUD_KAFKA_TOPIC.name, TEST_CCLOUD_KAFKA_TOPIC);

        await provider.reveal(TEST_CCLOUD_KAFKA_TOPIC, { select: true });

        sinon.assert.calledOnceWithExactly(treeViewRevealStub, TEST_CCLOUD_KAFKA_TOPIC, {
          select: true,
        });
      });

      it("should reveal a Subject from the cache", async () => {
        provider["subjectsInTreeView"].set(
          TEST_CCLOUD_SUBJECT_WITH_SCHEMA.name,
          TEST_CCLOUD_SUBJECT_WITH_SCHEMA,
        );

        await provider.reveal(TEST_CCLOUD_SUBJECT_WITH_SCHEMA, { focus: true });

        sinon.assert.calledOnceWithExactly(treeViewRevealStub, TEST_CCLOUD_SUBJECT_WITH_SCHEMA, {
          focus: true,
        });
      });

      it("should reveal a Schema by finding it within its parent subject", async () => {
        provider["subjectsInTreeView"].set(
          TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.name,
          TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
        );

        await provider.reveal(TEST_CCLOUD_SCHEMA);

        sinon.assert.calledOnce(treeViewRevealStub);
        const revealedItem = treeViewRevealStub.firstCall.args[0];
        assert.strictEqual(revealedItem.id, TEST_CCLOUD_SCHEMA.id);
      });

      it("should not reveal when item is not in the cache", async () => {
        await provider.reveal(TEST_CCLOUD_KAFKA_TOPIC);

        sinon.assert.notCalled(treeViewRevealStub);
      });

      it("should not reveal a Schema when parent subject is not in the cache", async () => {
        await provider.reveal(TEST_CCLOUD_SCHEMA);

        sinon.assert.notCalled(treeViewRevealStub);
      });
    });

    describe("event handlers", () => {
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

      describe("localKafkaConnectedHandler", () => {
        for (const nowConnected of [true, false]) {
          it(`should call reset() when initially connected to local Kafka and connected event: ${nowConnected}`, async () => {
            provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER; // Ensure we are in a local context
            await provider.localKafkaConnectedHandler(nowConnected);
            sinon.assert.calledOnce(resetStub);
            sinon.assert.notCalled(updateTreeViewDescriptionStub);
            sinon.assert.notCalled(refreshStub);
          });

          it(`should not call any methods when looking at a non-local cluster and connected event: ${nowConnected}`, async () => {
            provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER; // Ensure we are in a non-local context
            await provider.localKafkaConnectedHandler(nowConnected);
            sinon.assert.notCalled(resetStub);
            sinon.assert.notCalled(updateTreeViewDescriptionStub);
            sinon.assert.notCalled(refreshStub);
          });

          it(`should not call any methods when no cluster is set and connected event: ${nowConnected}`, async () => {
            provider.kafkaCluster = null; // No cluster set
            await provider.localKafkaConnectedHandler(nowConnected);
            sinon.assert.notCalled(resetStub);
            sinon.assert.notCalled(updateTreeViewDescriptionStub);
            sinon.assert.notCalled(refreshStub);
          });
        }
      });

      describe("subjectChangedHandler", () => {
        it("ignores when not focused on any Kafka cluster", async () => {
          provider.kafkaCluster = null;
          await provider.subjectChangeHandler({
            subject: TEST_CCLOUD_SUBJECT,
            change: "added",
          } as SubjectChangeEvent);
          sinon.assert.notCalled(refreshStub);
        });

        it("ignores when event is for a different environment", async () => {
          provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER;
          await provider.subjectChangeHandler({
            subject: TEST_CCLOUD_SUBJECT,
            change: "added",
          } as SubjectChangeEvent);
          sinon.assert.notCalled(refreshStub);
        });

        for (const change of ["added", "deleted"] as EventChangeType[]) {
          it(`calls reset() when a subject is ${change} in the current environment`, async () => {
            provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
            await provider.subjectChangeHandler({
              subject: TEST_CCLOUD_SUBJECT,
              change,
            } as SubjectChangeEvent);
            sinon.assert.calledOnce(refreshStub);
            // Must be a deep refresh to do the right thing and re-correlate topics and subjects.
            sinon.assert.calledWith(refreshStub, true);
          });
        }
      });

      describe("topicChangedHandler", () => {
        it("should do nothing when no cluster is focused", async () => {
          provider.kafkaCluster = null;

          await provider.topicChangedHandler({
            change: "added",
            cluster: TEST_CCLOUD_KAFKA_CLUSTER,
          });

          sinon.assert.notCalled(refreshStub);
        });

        for (const change of ["added", "deleted"] as EventChangeType[]) {
          it(`should do nothing when handling an event for a different cluster than the one focused (topic ${change})`, async () => {
            provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER;

            await provider.topicChangedHandler({
              change,
              cluster: TEST_CCLOUD_KAFKA_CLUSTER,
            });

            sinon.assert.notCalled(refreshStub);
          });

          it(`should call .refresh(true) when a topic is ${change} in the focused cluster`, async () => {
            provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;

            await provider.topicChangedHandler({
              change,
              cluster: TEST_CCLOUD_KAFKA_CLUSTER,
            });

            sinon.assert.calledOnce(refreshStub);
            sinon.assert.calledWith(refreshStub, true);
          });
        }
      });
    });

    describe("setCustomEventListeners()", () => {
      let emitterStubs: StubbedEventEmitters;

      beforeEach(() => {
        // Stub all event emitters in the emitters module
        emitterStubs = eventEmitterStubs(sandbox);
      });

      // Define test cases as corresponding pairs of
      // [event emitter name, view provider handler method name]
      const handlerEmitterPairs: Array<[keyof typeof emitterStubs, keyof TopicViewProvider]> = [
        ["environmentChanged", "environmentChangedHandler"],
        ["localKafkaConnected", "localKafkaConnectedHandler"],
        ["schemaSubjectChanged", "subjectChangeHandler"],
        ["schemaVersionsChanged", "subjectChangeHandler"],
        ["topicChanged", "topicChangedHandler"],
      ];

      it("should return the expected number of listeners", () => {
        const listeners = provider["setCustomEventListeners"]();
        assert.strictEqual(listeners.length, handlerEmitterPairs.length);
      });

      handlerEmitterPairs.forEach(([emitterName, handlerMethodName]) => {
        it(`should register ${handlerMethodName} with ${emitterName} emitter`, () => {
          // Create stub for the handler method
          const handlerStub = sandbox.stub(provider, handlerMethodName);

          // Re-invoke setCustomEventListeners() to capture emitter .event() stub calls
          provider["setCustomEventListeners"]();

          const emitterStub = emitterStubs[emitterName]!;
          // Verify the emitter's event method was called
          sinon.assert.calledOnce(emitterStub.event);

          // Capture the handler function that was registered
          const registeredHandler = emitterStub.event.firstCall.args[0];

          // Call the registered handler
          registeredHandler(undefined);

          // Verify the expected method stub was called,
          // proving that the expected handler was registered
          // to the expected emitter.
          sinon.assert.calledOnce(handlerStub);
        });
      });
    });
  });
});
