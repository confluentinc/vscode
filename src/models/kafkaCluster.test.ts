import * as assert from "assert";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_CLUSTER_WITH_POOL,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "../../tests/unit/testResources/kafkaCluster";
import { CCLOUD_BASE_PATH, UTM_SOURCE_VSCODE } from "../constants";
import { createKafkaClusterTooltip, LocalKafkaCluster } from "./kafkaCluster";
describe("createKafkaClusterTooltip()", () => {
  it("should return the correct tooltip for a Confluent Cloud Kafka cluster", () => {
    const tooltipString = createKafkaClusterTooltip(TEST_CCLOUD_KAFKA_CLUSTER).value;
    assert.ok(tooltipString.includes(`Name: \`${TEST_CCLOUD_KAFKA_CLUSTER.name}\``));
    assert.ok(tooltipString.includes("Open in Confluent Cloud"));
    assert.ok(tooltipString.includes("URI:"));
  });

  it("Should handle nameless cluster (??)", () => {
    const cluster = LocalKafkaCluster.create({
      ...TEST_LOCAL_KAFKA_CLUSTER,
      id: "local-kafka-cluster-abc123",
      name: "",
    });

    const tooltipString = createKafkaClusterTooltip(cluster).value;
    assert.ok(!tooltipString.includes("Name:"));
  });

  it("Should handle URI-less cluster (??)", () => {
    const cluster = LocalKafkaCluster.create({
      ...TEST_LOCAL_KAFKA_CLUSTER,
      uri: undefined,
    });

    const tooltipString = createKafkaClusterTooltip(cluster).value;
    assert.ok(!tooltipString.includes("URI:"));
  });
});

describe("Test CCloudKafkaCluster properties", () => {
  it("ccloudUrl should return the correct URL for ccloud kafka cluster", () => {
    assert.strictEqual(
      `https://${CCLOUD_BASE_PATH}/environments/${TEST_CCLOUD_KAFKA_CLUSTER.environmentId}/clusters/${TEST_CCLOUD_KAFKA_CLUSTER.id}?utm_source=${UTM_SOURCE_VSCODE}`,
      TEST_CCLOUD_KAFKA_CLUSTER.ccloudUrl,
    );
  });

  it("ccloudApiKeysUrl should return the correct URL for ccloud kafka cluster", () => {
    assert.strictEqual(
      `https://${CCLOUD_BASE_PATH}/environments/${TEST_CCLOUD_KAFKA_CLUSTER.environmentId}/clusters/${TEST_CCLOUD_KAFKA_CLUSTER.id}/api-keys?utm_source=${UTM_SOURCE_VSCODE}`,
      TEST_CCLOUD_KAFKA_CLUSTER.ccloudApiKeysUrl,
    );
  });

  it("searchableText should return the correct string for ccloud kafka cluster", () => {
    assert.strictEqual(
      `${TEST_CCLOUD_KAFKA_CLUSTER.name} ${TEST_CCLOUD_KAFKA_CLUSTER.id} ${TEST_CCLOUD_KAFKA_CLUSTER.provider}/${TEST_CCLOUD_KAFKA_CLUSTER.region}`,
      TEST_CCLOUD_KAFKA_CLUSTER.searchableText(),
    );
  });

  describe("isFlinkable", () => {
    it("should be true when there are flink pools", () => {
      assert.strictEqual(true, TEST_CCLOUD_KAFKA_CLUSTER_WITH_POOL.isFlinkable);
    });

    it("should be false when there are no flink pools", () => {
      assert.strictEqual(false, TEST_CCLOUD_KAFKA_CLUSTER.isFlinkable);
    });
  });
});
