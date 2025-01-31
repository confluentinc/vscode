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
import { filterSearchableItems } from "./filtering";

describe("filterSearchableItems", () => {
  it("should return all items when `searchStr` is empty", () => {
    const items = [TEST_LOCAL_ENVIRONMENT, TEST_CCLOUD_ENVIRONMENT];

    const filtered = filterSearchableItems(items, "");

    assert.deepStrictEqual(filtered, items);
  });

  it("should return an empty array when the `items` array is empty", () => {
    const items: ISearchable[] = [];

    const filtered = filterSearchableItems(items, "foo");

    assert.deepStrictEqual(filtered, []);
  });

  it("should return the correct environment when its name matches", () => {
    const items = [TEST_LOCAL_ENVIRONMENT, TEST_CCLOUD_ENVIRONMENT];

    const filtered = filterSearchableItems(items, TEST_LOCAL_ENVIRONMENT.name);

    assert.deepStrictEqual(filtered, [TEST_LOCAL_ENVIRONMENT]);
  });

  it("should return environment when one of its Kafka Clusters' names matches", () => {
    const env = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
    });

    const filtered = filterSearchableItems([env], TEST_CCLOUD_KAFKA_CLUSTER.name);

    assert.deepStrictEqual(filtered, [env]);
  });

  it("should return environment when its Schema Registry matches search string", () => {
    const env = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      schemaRegistry: TEST_CCLOUD_SCHEMA_REGISTRY,
    });

    const filtered = filterSearchableItems([env], TEST_CCLOUD_SCHEMA_REGISTRY.name);

    assert.deepStrictEqual(filtered, [env]);
  });

  it("should return container item when its children match", () => {
    const container = new ContainerTreeItem("Test Container", TreeItemCollapsibleState.Collapsed, [
      TEST_LOCAL_ENVIRONMENT,
      TEST_CCLOUD_ENVIRONMENT,
    ]);

    const filtered = filterSearchableItems([container], TEST_LOCAL_ENVIRONMENT.name);

    assert.deepStrictEqual(filtered, [container]);
  });

  it("should perform case-insensitive search", () => {
    const items = [TEST_LOCAL_ENVIRONMENT];

    const filtered = filterSearchableItems(items, TEST_LOCAL_ENVIRONMENT.name.toUpperCase());

    assert.deepStrictEqual(filtered, items);
  });
});
