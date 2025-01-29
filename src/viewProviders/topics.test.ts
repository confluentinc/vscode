import * as assert from "assert";
import * as vscode from "vscode";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources";
import { getTestStorageManager } from "../../tests/unit/testUtils";
import { CCloudResourceLoader, constructResourceLoaderSingletons } from "../loaders";
import { ContainerTreeItem } from "../models/main";
import { Schema, SchemaTreeItem } from "../models/schema";
import { KafkaTopic, KafkaTopicTreeItem } from "../models/topic";
import { StorageManager } from "../storage";
import { getResourceManager } from "../storage/resourceManager";
import { TopicViewProvider, loadTopicSchemas } from "./topics";

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
    const container = new ContainerTreeItem<Schema>(
      "test",
      vscode.TreeItemCollapsibleState.Collapsed,
      [TEST_CCLOUD_SCHEMA],
    );
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
