import * as assert from "assert";
import * as vscode from "vscode";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources";
import { getTestStorageManager } from "../../tests/unit/testUtils";
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
    Schema.create({ ...TEST_CCLOUD_SCHEMA, subject: valueSubject, version: 1 }),
    Schema.create({ ...TEST_CCLOUD_SCHEMA, subject: valueSubject, version: 2 }),
    Schema.create({ ...TEST_CCLOUD_SCHEMA, subject: "other-topic", version: 1 }),
  ];

  let storageManager: StorageManager;

  before(async () => {
    storageManager = await getTestStorageManager();
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
  it("loadTopicSchemas() should not return schemas for local Kafka topics", async () => {
    // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
    const topic = TEST_LOCAL_KAFKA_TOPIC.copy({ name: topicName });
    const schemas = await loadTopicSchemas(topic);
    assert.ok(Array.isArray(schemas));
    assert.equal(schemas.length, 0);
  });

  it.skip("loadTopicSchemas() should return schemas for CCloud Kafka topics when available", async () => {
    // preload Schema Registry + schemas (usually done when loading environments)
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudSchemaRegistries([TEST_CCLOUD_SCHEMA_REGISTRY]);
    await resourceManager.setSchemasForRegistry(TEST_CCLOUD_SCHEMA_REGISTRY.id, preloadedSchemas);
    // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
    const topic = TEST_CCLOUD_KAFKA_TOPIC.copy({ name: topicName });
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
    const topic = KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, name: topicName });
    const schemas = await loadTopicSchemas(topic);
    assert.ok(Array.isArray(schemas));
    assert.equal(schemas.length, 0);
  });
});
