import * as assert from "assert";
import { TreeItemCollapsibleState } from "vscode";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_LOCAL_ENVIRONMENT,
} from "../../tests/unit/testResources/environments";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources/kafkaCluster";
import { TEST_CCLOUD_SCHEMA_REGISTRY } from "../../tests/unit/testResources/schemaRegistry";
import { CCloudEnvironment } from "../models/environment";
import { ContainerTreeItem } from "../models/main";
import { ISearchable } from "../models/resource";
import { filterItems, itemMatchesSearch, matchesOrHasMatchingChild } from "./search";

describe("viewProviders/search filterItems", () => {
  it("should return all items when `searchStr` is empty", () => {
    const items = [TEST_LOCAL_ENVIRONMENT, TEST_CCLOUD_ENVIRONMENT];

    const filtered = filterItems(items, "");

    assert.deepStrictEqual(filtered, items);
  });

  it("should return an empty array when the `items` array is empty", () => {
    const items: ISearchable[] = [];

    const filtered = filterItems(items, "foo");

    assert.deepStrictEqual(filtered, []);
  });

  it("should return the correct environment when its name matches", () => {
    const items = [TEST_LOCAL_ENVIRONMENT, TEST_CCLOUD_ENVIRONMENT];

    const filtered = filterItems(items, TEST_LOCAL_ENVIRONMENT.name);

    assert.deepStrictEqual(filtered, [TEST_LOCAL_ENVIRONMENT]);
  });

  it("should return environment when one of its Kafka Clusters' names matches", () => {
    const env = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
    });

    const filtered = filterItems([env], TEST_CCLOUD_KAFKA_CLUSTER.name);

    assert.deepStrictEqual(filtered, [env]);
  });

  it("should return environment when its Schema Registry matches search string", () => {
    const env = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      schemaRegistry: TEST_CCLOUD_SCHEMA_REGISTRY,
    });

    const filtered = filterItems([env], TEST_CCLOUD_SCHEMA_REGISTRY.name);

    assert.deepStrictEqual(filtered, [env]);
  });

  it("should return container item when its children match", () => {
    const container = new ContainerTreeItem("Test Container", TreeItemCollapsibleState.Collapsed, [
      TEST_LOCAL_ENVIRONMENT,
      TEST_CCLOUD_ENVIRONMENT,
    ]);

    const filtered = filterItems([container], TEST_LOCAL_ENVIRONMENT.name);

    assert.deepStrictEqual(filtered, [container]);
  });

  it("should perform case-insensitive search", () => {
    const items = [TEST_LOCAL_ENVIRONMENT];

    const filtered = filterItems(items, TEST_LOCAL_ENVIRONMENT.name.toUpperCase());

    assert.deepStrictEqual(filtered, items);
  });
});

describe("viewProviders/search itemMatchesSearch", () => {
  it("should return true when the search string is empty", () => {
    assert.strictEqual(itemMatchesSearch(TEST_LOCAL_ENVIRONMENT, ""), true);
  });

  it("should return true when the item matches the search string", () => {
    assert.strictEqual(
      itemMatchesSearch(TEST_LOCAL_ENVIRONMENT, TEST_LOCAL_ENVIRONMENT.name),
      true,
    );
  });

  it("should return false when the item does not match the search string", () => {
    assert.strictEqual(itemMatchesSearch(TEST_LOCAL_ENVIRONMENT, "nomatch"), false);
  });

  it("should perform case-insensitive matching", () => {
    assert.strictEqual(
      itemMatchesSearch(TEST_LOCAL_ENVIRONMENT, TEST_LOCAL_ENVIRONMENT.name.toUpperCase()),
      true,
    );
  });
});

describe("viewProviders/search matchesOrHasMatchingChild", () => {
  it("should return true when the item directly matches", () => {
    assert.strictEqual(
      matchesOrHasMatchingChild(TEST_LOCAL_ENVIRONMENT, TEST_LOCAL_ENVIRONMENT.name),
      true,
    );
  });

  it("should return true when an item's child matches", () => {
    const env = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
    });

    assert.strictEqual(matchesOrHasMatchingChild(env, TEST_CCLOUD_KAFKA_CLUSTER.name), true);
  });

  it("should return true when a nested child matches", () => {
    // Container -> CCloudEnvironment -> KafkaCluster
    const container = new ContainerTreeItem("Container", TreeItemCollapsibleState.Collapsed, [
      new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
      }),
    ]);

    assert.strictEqual(matchesOrHasMatchingChild(container, TEST_CCLOUD_KAFKA_CLUSTER.name), true);
  });

  it("should return false when no children match", () => {
    const env = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
    });

    assert.strictEqual(matchesOrHasMatchingChild(env, "nomatch"), false);
  });

  it("should handle items without children", () => {
    const env = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      kafkaClusters: [],
    });

    assert.strictEqual(matchesOrHasMatchingChild(env, TEST_CCLOUD_KAFKA_CLUSTER.name), false);
  });
});
