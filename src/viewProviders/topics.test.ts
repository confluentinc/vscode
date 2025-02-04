import * as assert from "assert";
import * as sinon from "sinon";
import { TreeItemCollapsibleState } from "vscode";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources";
import { getTestExtensionContext, getTestStorageManager } from "../../tests/unit/testUtils";
import { topicSearchSet } from "../emitters";
import { CCloudResourceLoader, constructResourceLoaderSingletons } from "../loaders";
import { ContainerTreeItem } from "../models/main";
import { Schema, SchemaTreeItem } from "../models/schema";
import { KafkaTopic, KafkaTopicTreeItem } from "../models/topic";
import { StorageManager } from "../storage";
import { getResourceManager } from "../storage/resourceManager";
import { SEARCH_DECORATION_URI_SCHEME } from "./search";
import { loadTopicSchemas, TopicViewProvider } from "./topics";

describe("TopicViewProvider methods", () => {
  let provider: TopicViewProvider;

  before(() => {
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

describe("TopicViewProvider helper functions", () => {
  const topicName = "test-topic";
  const valueSubject = `${topicName}-value`;
  const preloadedSchemas: Schema[] = [
    Schema.create({ ...TEST_CCLOUD_SCHEMA, subject: valueSubject, version: 1, id: "1" }),
    Schema.create({ ...TEST_CCLOUD_SCHEMA, subject: valueSubject, version: 2, id: "2" }),
    Schema.create({ ...TEST_CCLOUD_SCHEMA, subject: "other-topic", version: 1, id: "3" }),
  ];

  let storageManager: StorageManager;
  const ccloudResourceLoader = CCloudResourceLoader.getInstance();

  before(async () => {
    storageManager = await getTestStorageManager();
    constructResourceLoaderSingletons();
  });

  beforeEach(async () => {
    // fresh slate for each test
    await storageManager.clearWorkspaceState();
  });

  afterEach(async () => {
    // clean up after each test
    await storageManager.clearWorkspaceState();
  });

  // TODO: update this once local schemas are supported
  it("loadTopicSchemas() should not return schemas for topics w/o any known related schemas", async () => {
    // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`

    // TODO: This actually tries to talk out through to docker / local schema registry now.
    // We should stub out the interaction methods, probably for a specific local schema registry.
    // test suite. Right now, this would fail if you have docker running, local schema registry
    // running, and with the right subject ('test-topic-value') in the local schema registry.

    const topic = TEST_LOCAL_KAFKA_TOPIC.copy({ name: topicName });
    const schemas = await loadTopicSchemas(topic);
    assert.ok(Array.isArray(schemas));
    assert.equal(schemas.length, 0);
  });

  it("loadTopicSchemas() should return schemas for CCloud Kafka topics when available", async () => {
    // preload Schema Registry + schemas (usually done when loading environments)
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudSchemaRegistries([TEST_CCLOUD_SCHEMA_REGISTRY]);
    await resourceManager.setSchemasForRegistry(TEST_CCLOUD_SCHEMA_REGISTRY.id, preloadedSchemas);
    // set the loader-level cache state to true as if we had already loaded the schemas
    ccloudResourceLoader["schemaRegistryCacheStates"].set(TEST_CCLOUD_SCHEMA_REGISTRY.id, true);
    // and the coarse resources
    ccloudResourceLoader["coarseLoadingComplete"] = true;

    // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
    const topic = TEST_CCLOUD_KAFKA_TOPIC.copy({ name: topicName });
    // Should return a nonempty ContainerTreeItem describing the schema group.
    const schemas = await loadTopicSchemas(topic);

    assert.ok(Array.isArray(schemas));
    // more specific testing is in `src/models/schema.test.ts` for the `generateSchemaSubjectGroups()`
    // function, but for here we just care about getting one schema subject container item back
    assert.equal(schemas.length, 1);
    assert.equal(schemas[0].label, valueSubject);
  });

  it("loadTopicSchemas() should not return schemas for CCloud Kafka topics if none are available in extension state", async () => {
    await getResourceManager().setSchemasForRegistry(
      TEST_CCLOUD_SCHEMA_REGISTRY.id,
      preloadedSchemas,
    );
    // set the loader-level cache state to true as if we had already loaded the schemas
    ccloudResourceLoader["schemaRegistryCacheStates"].set(TEST_CCLOUD_SCHEMA_REGISTRY.id, true);

    const topic = KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, name: topicName });

    const schemas = await loadTopicSchemas(topic);
    assert.ok(Array.isArray(schemas));
    assert.equal(schemas.length, 0);
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
