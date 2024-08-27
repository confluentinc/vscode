import * as assert from "assert";
import * as vscode from "vscode";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { TEST_SCHEMA_REGISTRY } from "../../tests/unit/testResources/schemaRegistry";
import { CCloudEnvironment, CCloudEnvironmentTreeItem } from "../models/environment";
import { KafkaClusterTreeItem } from "../models/kafkaCluster";
import { ContainerTreeItem } from "../models/main";
import { SchemaRegistryClusterTreeItem } from "../models/schemaRegistry";
import { ResourceViewProvider } from "./resources";

describe("ResourceViewProvider methods", () => {
  let provider: ResourceViewProvider;

  before(() => {
    provider = new ResourceViewProvider();
  });

  it("getTreeItem() should return a CCloudEnvironmentTreeItem for a CCloudEnvironment instance", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_ENVIRONMENT);
    assert.ok(treeItem instanceof CCloudEnvironmentTreeItem);
  });

  it("getTreeItem() should return a KafkaClusterTreeItem for a LocalKafkaCluster instance", () => {
    const treeItem = provider.getTreeItem(TEST_LOCAL_KAFKA_CLUSTER);
    assert.ok(treeItem instanceof KafkaClusterTreeItem);
  });

  it("getTreeItem() should return a KafkaClusterTreeItem for a CCloudKafkaCluster instance", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_KAFKA_CLUSTER);
    assert.ok(treeItem instanceof KafkaClusterTreeItem);
  });

  it("getTreeItem() should return a SchemaRegistryClusterTreeItem for a SchemaRegistryCluster instance", () => {
    const treeItem = provider.getTreeItem(TEST_SCHEMA_REGISTRY);
    assert.ok(treeItem instanceof SchemaRegistryClusterTreeItem);
  });

  it("getTreeItem() should pass ContainerTreeItems through directly", () => {
    const container = new ContainerTreeItem<CCloudEnvironment>(
      "test",
      vscode.TreeItemCollapsibleState.Collapsed,
      [TEST_CCLOUD_ENVIRONMENT],
    );
    const treeItem = provider.getTreeItem(container);
    assert.deepStrictEqual(treeItem, container);
  });
});
