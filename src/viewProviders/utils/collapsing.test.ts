import * as assert from "assert";
import { TreeItemCollapsibleState } from "vscode";
import { TEST_CCLOUD_SCHEMA } from "../../../tests/unit/testResources";
import { TEST_CCLOUD_ENVIRONMENT } from "../../../tests/unit/testResources/environments";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../../tests/unit/testResources/kafkaCluster";
import { CCloudEnvironment, EnvironmentTreeItem } from "../../models/environment";
import { SchemaTreeItem } from "../../models/schema";
import { updateCollapsibleStateFromSearch } from "./collapsing";

describe("viewProviders/utils/collapsing.ts", () => {
  describe("updateCollapsibleStateFromSearch()", () => {
    it("should expand a tree item when its children match the search string", () => {
      const env = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
      });
      const treeItem = new EnvironmentTreeItem(env);
      const origId = treeItem.id;

      const result = updateCollapsibleStateFromSearch(
        env,
        treeItem,
        TEST_CCLOUD_KAFKA_CLUSTER.name,
      );

      assert.strictEqual(result.collapsibleState, TreeItemCollapsibleState.Expanded);
      assert.strictEqual(result.id, origId + "-search");
    });

    it("should collapse a tree item when its children exist but don't match the search string", () => {
      const env = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
      });
      const treeItem = new EnvironmentTreeItem(env);
      // manually expand even though CCloud envs are usually collapsed by default
      treeItem.collapsibleState = TreeItemCollapsibleState.Expanded;
      const origId = treeItem.id;

      const result = updateCollapsibleStateFromSearch(env, treeItem, "non-matching");

      assert.strictEqual(result.collapsibleState, TreeItemCollapsibleState.Collapsed);
      assert.strictEqual(result.id, origId + "-search");
    });

    it("should preserve 'None' collapsible state for leaf items", () => {
      const testResource = TEST_CCLOUD_SCHEMA;
      const testTreeItem = new SchemaTreeItem(testResource);
      // SchemaTreeItem starts out as a leaf item with collapsible state None by default
      const origId = testTreeItem.id;

      const result = updateCollapsibleStateFromSearch(testResource, testTreeItem, "search");

      assert.strictEqual(result.collapsibleState, TreeItemCollapsibleState.None);
      // state didn't change, so `id` shouldn't either
      assert.strictEqual(result.id, origId);
    });

    it("should preserve 'Collapsed' collapsible state when children don't match and state is already Collapsed", () => {
      const env = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
      });
      const treeItem = new EnvironmentTreeItem(env);
      // EnvironmentTreeItem starts out Collapsed by default
      const origId = treeItem.id;

      const result = updateCollapsibleStateFromSearch(env, treeItem, "non-matching");

      assert.strictEqual(result.collapsibleState, TreeItemCollapsibleState.Collapsed);
      // state didn't change, so `id` shouldn't either
      assert.strictEqual(result.id, origId);
    });

    it("should preserve state when children match but state is already correct", () => {
      const env = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
      });
      const treeItem = new EnvironmentTreeItem(env);
      // manually expand even though CCloud envs are usually collapsed by default
      treeItem.collapsibleState = TreeItemCollapsibleState.Expanded;
      const origId = treeItem.id;

      const result = updateCollapsibleStateFromSearch(
        env,
        treeItem,
        TEST_CCLOUD_KAFKA_CLUSTER.name,
      );

      assert.strictEqual(result.collapsibleState, TreeItemCollapsibleState.Expanded);
      assert.strictEqual(result.id, origId);
    });

    it("should handle empty search string", () => {
      const treeItem = new EnvironmentTreeItem(TEST_CCLOUD_ENVIRONMENT);
      const origId = treeItem.id;
      const origCollapsibleState = treeItem.collapsibleState;

      const result = updateCollapsibleStateFromSearch(TEST_CCLOUD_ENVIRONMENT, treeItem, "");

      assert.strictEqual(result.collapsibleState, origCollapsibleState);
      assert.strictEqual(result.id, origId);
    });
  });
});
