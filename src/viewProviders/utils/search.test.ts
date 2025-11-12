import * as assert from "assert";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_LOCAL_ENVIRONMENT,
} from "../../../tests/unit/testResources/environments";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../../tests/unit/testResources/kafkaCluster";
import {
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMA,
} from "../../../tests/unit/testResources/schema";
import { TEST_CCLOUD_SCHEMA_REGISTRY } from "../../../tests/unit/testResources/schemaRegistry";
import { TEST_CCLOUD_KAFKA_TOPIC } from "../../../tests/unit/testResources/topic";
import { CCloudEnvironment } from "../../models/environment";
import { CCloudKafkaCluster } from "../../models/kafkaCluster";
import type { ISearchable } from "../../models/resource";
import { KafkaTopic } from "../../models/topic";
import {
  countMatchingElements,
  filterItems,
  itemMatchesSearch,
  matchesOrHasMatchingChild,
  traverseMatches,
} from "./search";

describe("viewProviders/utils/search.ts", () => {
  describe("filterItems()", () => {
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

    it("should return topic when its subject children match", () => {
      const topic = KafkaTopic.create({
        ...TEST_CCLOUD_KAFKA_TOPIC,
        hasSchema: true,
        children: [TEST_CCLOUD_SUBJECT_WITH_SCHEMA],
      });

      const filtered = filterItems([topic], TEST_CCLOUD_SUBJECT_WITH_SCHEMA.name);

      assert.deepStrictEqual(filtered, [topic]);
    });

    it("should perform case-insensitive search", () => {
      const items = [TEST_LOCAL_ENVIRONMENT];

      const filtered = filterItems(items, TEST_LOCAL_ENVIRONMENT.name.toUpperCase());

      assert.deepStrictEqual(filtered, items);
    });
  });

  describe("itemMatchesSearch()", () => {
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

  describe("matchesOrHasMatchingChild()", () => {
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
      // KafkaTopic -> Subject -> Schema
      const topic = KafkaTopic.create({
        ...TEST_CCLOUD_KAFKA_TOPIC,
        hasSchema: true,
        children: [TEST_CCLOUD_SUBJECT_WITH_SCHEMA],
      });

      assert.strictEqual(
        matchesOrHasMatchingChild(topic, TEST_CCLOUD_SUBJECT_WITH_SCHEMA.name),
        true,
      );
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

  describe("traverseMatches()", () => {
    it("should call callback for direct matches", () => {
      const searchStr = TEST_LOCAL_ENVIRONMENT.name;
      const matches: ISearchable[] = [];
      const callback = (item: ISearchable) => matches.push(item);

      traverseMatches(TEST_LOCAL_ENVIRONMENT, searchStr, callback);

      assert.deepStrictEqual(matches, [TEST_LOCAL_ENVIRONMENT]);
    });

    it("should call callback for child matches", () => {
      const env = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
      });
      const searchStr = TEST_CCLOUD_KAFKA_CLUSTER.name;
      const matches: ISearchable[] = [];
      const callback = (item: ISearchable) => matches.push(item);

      traverseMatches(env, searchStr, callback);

      assert.strictEqual(matches.length, 1);
      assert.deepStrictEqual(matches[0], TEST_CCLOUD_KAFKA_CLUSTER);
    });

    it("should traverse deeply nested matches", () => {
      // KafkaTopic -> Subject -> Schema
      const topic = KafkaTopic.create({
        ...TEST_CCLOUD_KAFKA_TOPIC,
        hasSchema: true,
        children: [TEST_CCLOUD_SUBJECT_WITH_SCHEMA],
      });
      const searchStr = TEST_CCLOUD_SCHEMA.subject;
      const matches: ISearchable[] = [];
      const callback = (item: ISearchable) => matches.push(item);

      traverseMatches(topic, searchStr, callback);

      assert.strictEqual(matches.length, 1);
      assert.deepStrictEqual(matches[0], TEST_CCLOUD_SUBJECT_WITH_SCHEMA);
    });

    it("should handle empty search string", () => {
      const matches: ISearchable[] = [];
      const searchStr = "";
      const callback = (item: ISearchable) => matches.push(item);

      traverseMatches(TEST_LOCAL_ENVIRONMENT, searchStr, callback);

      assert.deepStrictEqual(matches, [TEST_LOCAL_ENVIRONMENT]);
    });

    it("should handle items without children", () => {
      const env = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        kafkaClusters: [],
      });
      const matches: ISearchable[] = [];
      const searchStr = TEST_CCLOUD_KAFKA_CLUSTER.name;
      const callback = (item: ISearchable) => matches.push(item);

      traverseMatches(env, searchStr, callback);

      assert.strictEqual(matches.length, 0);
    });
  });

  describe("countMatchingElements()", () => {
    it("should count direct matches", () => {
      const count = countMatchingElements(TEST_LOCAL_ENVIRONMENT, TEST_LOCAL_ENVIRONMENT.name);

      assert.strictEqual(count, 1);
    });

    it("should count child matches", () => {
      const env = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
      });

      const count = countMatchingElements(env, TEST_CCLOUD_KAFKA_CLUSTER.name);

      assert.strictEqual(count, 1);
    });

    it("should count multiple matches", () => {
      const env = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        kafkaClusters: [
          TEST_CCLOUD_KAFKA_CLUSTER,
          CCloudKafkaCluster.create({ ...TEST_CCLOUD_KAFKA_CLUSTER, id: "second-cluster" }),
        ],
      });

      const count = countMatchingElements(env, TEST_CCLOUD_KAFKA_CLUSTER.name);

      assert.strictEqual(count, 2);
    });

    it("should return 0 for empty search string", () => {
      const count = countMatchingElements(TEST_LOCAL_ENVIRONMENT, "");

      assert.strictEqual(count, 0);
    });

    it("should return 0 for items without children", () => {
      const env = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        kafkaClusters: [],
      });

      const count = countMatchingElements(env, TEST_CCLOUD_KAFKA_CLUSTER.name);

      assert.strictEqual(count, 0);
    });
  });
});
