import * as assert from "assert";
import * as sinon from "sinon";
import { TreeItemCollapsibleState } from "vscode";
import {
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
import { environmentChanged, topicSearchSet } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { SchemaTreeItem, Subject, SubjectTreeItem } from "../models/schema";
import { KafkaTopic, KafkaTopicTreeItem } from "../models/topic";
import { SEARCH_DECORATION_URI_SCHEME } from "./search";
import { TopicViewProvider } from "./topics";

describe("TopicViewProvider methods", () => {
  let provider: TopicViewProvider;

  before(async () => {
    await getTestExtensionContext();
    provider = TopicViewProvider.getInstance();
  });

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

describe("TopicViewProvider search behavior", () => {
  let provider: TopicViewProvider;
  let ccloudLoader: CCloudResourceLoader;

  let sandbox: sinon.SinonSandbox;
  let getTopicsForClusterStub: sinon.SinonStub;
  let getSubjectsStub: sinon.SinonStub;
  let getSchemaSubjectGroupStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // stub the methods called while inside loadTopicSchemas() since we can't stub it directly
    ccloudLoader = CCloudResourceLoader.getInstance();
    getTopicsForClusterStub = sandbox.stub(ccloudLoader, "getTopicsForCluster").resolves([]);
    getSubjectsStub = sandbox.stub(ccloudLoader, "getSubjects").resolves([]);
    getSchemaSubjectGroupStub = sandbox.stub(ccloudLoader, "getSchemaSubjectGroup").resolves([]);

    provider = TopicViewProvider.getInstance();
    provider.kafkaCluster = TEST_CCLOUD_KAFKA_CLUSTER;
  });

  afterEach(() => {
    TopicViewProvider["instance"] = null;
    sandbox.restore();
  });

  it("getChildren() should filter root-level topics based on search string", async () => {
    getTopicsForClusterStub.resolves([TEST_CCLOUD_KAFKA_TOPIC]);
    // Topic name matches the search string
    topicSearchSet.fire(TEST_CCLOUD_KAFKA_TOPIC.name);

    const rootElements = await provider.getChildren();

    assert.strictEqual(rootElements.length, 1);
    assert.deepStrictEqual(rootElements[0], TEST_CCLOUD_KAFKA_TOPIC);
  });

  it("getChildren() should filter schema subject containers based on search string", async () => {
    getSubjectsStub.resolves([
      TEST_CCLOUD_SCHEMA.subjectObject(),
      TEST_LOCAL_SCHEMA.subjectObject(), // has different subject name at least. Should be skipped 'cause won't match search.
    ]);
    getSchemaSubjectGroupStub.resolves([TEST_CCLOUD_SCHEMA]);
    // Schema subject matches the search string
    topicSearchSet.fire(TEST_CCLOUD_SCHEMA.subject);

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
    topicSearchSet.fire(searchStr);

    await provider.getChildren();

    assert.strictEqual(provider.searchMatches.size, 1);
    assert.strictEqual(provider.totalItemCount, 2);
    assert.strictEqual(
      provider["treeView"].message,
      `Showing ${provider.searchMatches.size} of ${provider.totalItemCount} results for "${searchStr}"`,
    );
  });

  it("getChildren() should clear tree view message when search is cleared", async () => {
    // Search cleared
    topicSearchSet.fire(null);

    await provider.getChildren();

    assert.strictEqual(provider["treeView"].message, undefined);
  });

  it("getTreeItem() should set the resourceUri of topic items whose name matches the search string", async () => {
    // Topic name matches the search string
    topicSearchSet.fire(TEST_CCLOUD_KAFKA_TOPIC.name);

    const treeItem = await provider.getTreeItem(TEST_CCLOUD_KAFKA_TOPIC);

    assert.ok(treeItem instanceof KafkaTopicTreeItem);
    assert.strictEqual(treeItem.resourceUri?.scheme, SEARCH_DECORATION_URI_SCHEME);
  });

  it("getTreeItem() should set the resourceUri of schema subject containers whose subject matches the search string", async () => {
    // Schema ID matches the search string
    topicSearchSet.fire(TEST_CCLOUD_SCHEMA.subject);

    const treeItem = await provider.getTreeItem(TEST_CCLOUD_SUBJECT_WITH_SCHEMAS);

    assert.ok(treeItem instanceof SubjectTreeItem);
    assert.ok(treeItem.resourceUri);
    assert.strictEqual(treeItem.resourceUri?.scheme, SEARCH_DECORATION_URI_SCHEME);
  });

  it("getTreeItem() should expand topic items when their schemas match search", async () => {
    const topic = KafkaTopic.create({
      ...TEST_CCLOUD_KAFKA_TOPIC,
      children: [TEST_CCLOUD_SUBJECT],
    });
    // Schema subject matches search
    topicSearchSet.fire(TEST_CCLOUD_SCHEMA.subject);

    const treeItem = await provider.getTreeItem(topic);

    assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.Expanded);
  });

  it("getTreeItem() should collapse topic items when schemas exist but don't match search", async () => {
    const topic = KafkaTopic.create({
      ...TEST_CCLOUD_KAFKA_TOPIC,
      children: [TEST_CCLOUD_SUBJECT],
    });
    // Search string doesn't match topic or schema
    topicSearchSet.fire("non-matching-search");

    const treeItem = await provider.getTreeItem(topic);

    assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.Collapsed);
  });
});

describe("TopicViewProvider environmentChanged handler", () => {
  let provider: TopicViewProvider;
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;

  before(async () => {
    await getTestExtensionContext();
    provider = TopicViewProvider.getInstance();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers(Date.now());
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Firing environmentChanged + deleted should call reset()", async () => {
    const resetFake = sandbox.fake();
    sandbox.replace(provider, "reset", resetFake);

    // Be set to a SR within the environment being deleted
    provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER;
    // fire the event
    environmentChanged.fire({ id: TEST_LOCAL_ENVIRONMENT_ID, wasDeleted: true });

    // Should have called .reset()
    assert.ok(resetFake.calledOnce);
  });

  it("Firing environmentChanged + misc change should not call reset(), should call updateTreeViewDescription + refresh", async () => {
    const resetFake = sandbox.fake();
    const updateTreeViewDescriptionFake = sandbox.fake();
    const refreshFake = sandbox.fake();

    sandbox.replace(provider, "reset", resetFake);
    sandbox.replace(provider, "updateTreeViewDescription", updateTreeViewDescriptionFake);
    sandbox.replace(provider, "refresh", refreshFake);

    // Be set to a cluster within the environment being deleted
    provider.kafkaCluster = TEST_LOCAL_KAFKA_CLUSTER;
    // fire the event
    environmentChanged.fire({ id: TEST_LOCAL_ENVIRONMENT_ID, wasDeleted: false });

    // Need to pause an iota to get the refresh to be called, is after first await in the block.
    await clock.tickAsync(100);

    assert.ok(resetFake.notCalled);
    assert.ok(updateTreeViewDescriptionFake.calledOnce);
    assert.ok(refreshFake.calledOnce);
  });

  for (const currentCluster of [TEST_LOCAL_KAFKA_CLUSTER, null]) {
    it(`Firing environmentChanged when SR set a ${currentCluster?.environmentId} environment cluster and event is for other env should do nothing`, () => {
      const resetFake = sandbox.fake();
      const updateTreeViewDescriptionFake = sandbox.fake();
      const refreshFake = sandbox.fake();

      sandbox.replace(provider, "reset", resetFake);
      sandbox.replace(provider, "updateTreeViewDescription", updateTreeViewDescriptionFake);
      sandbox.replace(provider, "refresh", refreshFake);

      // Be set to a cluster NOT within the environment being updated, or null.
      provider.kafkaCluster = currentCluster;

      // fire the event against some other environment.
      environmentChanged.fire({
        id: TEST_CCLOUD_ENVIRONMENT_ID,
        wasDeleted: false,
      });

      // Should not have called any of these
      assert.ok(resetFake.notCalled);
      assert.ok(updateTreeViewDescriptionFake.notCalled);
      assert.ok(refreshFake.notCalled);
    });
  }
});
