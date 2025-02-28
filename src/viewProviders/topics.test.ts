import * as assert from "assert";
import * as sinon from "sinon";
import { TreeItemCollapsibleState } from "vscode";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SUBJECT,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
  TEST_LOCAL_SCHEMA,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { topicSearchSet } from "../emitters";
import { CCloudResourceLoader, ResourceLoader } from "../loaders";
import { Schema, SchemaTreeItem, Subject, SubjectTreeItem } from "../models/schema";
import { KafkaTopic, KafkaTopicTreeItem } from "../models/topic";
import { SEARCH_DECORATION_URI_SCHEME } from "./search";
import { loadTopicSchemas, TopicViewProvider } from "./topics";

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
});

describe("TopicViewProvider helper function loadTopicSchemas tests", () => {
  let sandbox: sinon.SinonSandbox;
  let loaderStub: sinon.SinonStubbedInstance<ResourceLoader>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    loaderStub = sandbox.createStubInstance(ResourceLoader);
    sandbox.stub(ResourceLoader, "getInstance").returns(loaderStub);
  });

  afterEach(() => {
    sandbox.restore();
  });

  function populateSchemas(schemas: Schema[]) {
    const seenSubjectStrings: Set<string> = new Set();
    const uniqueSubjects: Subject[] = [];
    for (const schema of schemas) {
      if (!seenSubjectStrings.has(schema.subject)) {
        uniqueSubjects.push(schema.subjectObject());
        seenSubjectStrings.add(schema.subject);
      }
    }

    console.log("uniqueSubjects", Array.from(uniqueSubjects));

    loaderStub.getSubjects.resolves(Array.from(uniqueSubjects));
  }

  it("If no related schemas, then empty array is returned", async () => {
    // None correspond to TEST_CCLOUD_KAFKA_TOPIC.
    const preloadedSchemas: Schema[] = [
      Schema.create({ ...TEST_CCLOUD_SCHEMA, subject: "foo-value", version: 1, id: "1" }),
      Schema.create({ ...TEST_CCLOUD_SCHEMA, subject: "foo-value", version: 2, id: "2" }),
      Schema.create({ ...TEST_CCLOUD_SCHEMA, subject: "other-topic", version: 1, id: "3" }),
    ];

    populateSchemas(preloadedSchemas);

    const schemas = await loadTopicSchemas(TEST_CCLOUD_KAFKA_TOPIC);
    assert.deepStrictEqual(schemas, []);
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
    getTopicsForClusterStub.resolves([TEST_CCLOUD_KAFKA_TOPIC]);
    // Topic name matches the search string
    const searchStr = TEST_CCLOUD_KAFKA_TOPIC.name;
    topicSearchSet.fire(searchStr);

    await provider.getChildren();

    assert.strictEqual(provider["treeView"].message, `Showing 1 result for "${searchStr}"`);
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
