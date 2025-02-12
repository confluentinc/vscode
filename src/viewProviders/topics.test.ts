import * as assert from "assert";
import * as sinon from "sinon";
import { TreeItemCollapsibleState } from "vscode";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { topicSearchSet } from "../emitters";
import { CCloudResourceLoader, ResourceLoader } from "../loaders";
import { ContainerTreeItem } from "../models/main";
import { Schema, SchemaTreeItem, Subject } from "../models/schema";
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

  it("getTreeItem() should pass ContainerTreeItems through directly", () => {
    const container = new ContainerTreeItem<Schema>("test", TreeItemCollapsibleState.Collapsed, [
      TEST_CCLOUD_SCHEMA,
    ]);
    const treeItem = provider.getTreeItem(container);
    assert.deepStrictEqual(treeItem, container);
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

  function populateSchemaSubjectGroups(schemas: Schema[]) {
    loaderStub.getSchemaSubjectGroup.callsFake(async (arg1: any, subjectName: string) => {
      const matchingSchemas = schemas.filter((schema) => schema.subject === subjectName);
      return matchingSchemas;
    });
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

  it("If related schemas, then they are returned in proper ContainerTreeItem<Schema> instances", async () => {
    const preloadedSchemas: Schema[] = [
      Schema.create({
        ...TEST_CCLOUD_SCHEMA,
        subject: "test-ccloud-topic-value",
        version: 1,
        id: "1",
      }),
      Schema.create({
        ...TEST_CCLOUD_SCHEMA,
        subject: "test-ccloud-topic-value",
        version: 2,
        id: "2",
      }),
      Schema.create({
        ...TEST_CCLOUD_SCHEMA,
        subject: "test-ccloud-topic-key",
        version: 1,
        id: "3",
      }),
      Schema.create({
        ...TEST_CCLOUD_SCHEMA,
        subject: "unrelated-topic-value",
        version: 1,
        id: "7",
      }),
    ];

    populateSchemas(preloadedSchemas);
    populateSchemaSubjectGroups(preloadedSchemas);

    // Should get back in the form of two separate ContainerTreeItem<Schema> instances.
    const schemaContainers = await loadTopicSchemas(TEST_CCLOUD_KAFKA_TOPIC);
    assert.strictEqual(schemaContainers.length, 2);
    for (const schemaContainer of schemaContainers) {
      assert.ok(schemaContainer instanceof ContainerTreeItem);
      assert.equal(schemaContainer.collapsibleState, TreeItemCollapsibleState.Collapsed);
      assert.ok(schemaContainer.children.length > 0);
      if (schemaContainer.label === "test-ccloud-topic-value") {
        assert.equal(schemaContainer.children.length, 2);
        assert.equal(schemaContainer.description, "AVRO (2)");
        assert.equal(schemaContainer.contextValue, "multiple-versions-schema-subject");
      } else if (schemaContainer.label === "test-ccloud-topic-key") {
        assert.equal(schemaContainer.children.length, 1);
        assert.equal(schemaContainer.description, "AVRO (1)");
        assert.equal(schemaContainer.contextValue, "schema-subject");
      }
    }
  });
});

describe("TopicViewProvider search behavior", () => {
  let provider: TopicViewProvider;
  let ccloudLoader: CCloudResourceLoader;

  let sandbox: sinon.SinonSandbox;
  let getTopicsForClusterStub: sinon.SinonStub;
  let getSchemaRegistryForEnvironmentIdStub: sinon.SinonStub;
  let getSchemasForEnvironmentIdStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // stub the methods called while inside loadTopicSchemas() since we can't stub it directly
    ccloudLoader = CCloudResourceLoader.getInstance();
    getTopicsForClusterStub = sandbox.stub(ccloudLoader, "getTopicsForCluster").resolves([]);
    getSchemaRegistryForEnvironmentIdStub = sandbox
      .stub(ccloudLoader, "getSchemaRegistryForEnvironmentId")
      .resolves(TEST_CCLOUD_SCHEMA_REGISTRY);
    getSchemasForEnvironmentIdStub = sandbox
      .stub(ccloudLoader, "getSchemasForEnvironmentId")
      .resolves([]);

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
    getSchemaRegistryForEnvironmentIdStub.resolves(TEST_CCLOUD_SCHEMA_REGISTRY);
    getSchemasForEnvironmentIdStub.resolves([TEST_CCLOUD_SCHEMA]);
    // Schema subject matches the search string
    topicSearchSet.fire(TEST_CCLOUD_SCHEMA.subject);

    const children = await provider.getChildren(TEST_CCLOUD_KAFKA_TOPIC);

    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof ContainerTreeItem);
    // skip all the subject container assertions; just check that the schema made it in
    assert.deepStrictEqual((children[0] as ContainerTreeItem<Schema>).children, [
      TEST_CCLOUD_SCHEMA,
    ]);
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

    const treeItem = await provider.getTreeItem(
      new ContainerTreeItem(TEST_CCLOUD_SCHEMA.subject, TreeItemCollapsibleState.None, []),
    );

    assert.ok(treeItem instanceof ContainerTreeItem);
    assert.ok(treeItem.resourceUri);
    assert.strictEqual(treeItem.resourceUri?.scheme, SEARCH_DECORATION_URI_SCHEME);
  });

  it("getTreeItem() should expand topic items when their schemas match search", async () => {
    const topic = KafkaTopic.create({
      ...TEST_CCLOUD_KAFKA_TOPIC,
      children: [
        new ContainerTreeItem<Schema>(
          TEST_CCLOUD_SCHEMA.subject,
          TreeItemCollapsibleState.Collapsed,
          [],
        ),
      ],
    });
    // Schema subject matches search
    topicSearchSet.fire(TEST_CCLOUD_SCHEMA.subject);

    const treeItem = await provider.getTreeItem(topic);

    assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.Expanded);
  });

  it("getTreeItem() should collapse topic items when schemas exist but don't match search", async () => {
    const topic = KafkaTopic.create({
      ...TEST_CCLOUD_KAFKA_TOPIC,
      children: [
        new ContainerTreeItem<Schema>(
          TEST_CCLOUD_SCHEMA.subject,
          TreeItemCollapsibleState.Collapsed,
          [],
        ),
      ],
    });
    // Search string doesn't match topic or schema
    topicSearchSet.fire("non-matching-search");

    const treeItem = await provider.getTreeItem(topic);

    assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.Collapsed);
  });
});
