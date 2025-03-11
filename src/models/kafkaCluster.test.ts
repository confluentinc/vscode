import * as assert from "assert";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "../../tests/unit/testResources/kafkaCluster";
import { createKafkaClusterTooltip, LocalKafkaCluster } from "./kafkaCluster";
import { UTM_SOURCE_VSCODE } from "../constants";
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
      `https://confluent.cloud/environments/${TEST_CCLOUD_KAFKA_CLUSTER.environmentId}/clusters/${TEST_CCLOUD_KAFKA_CLUSTER.id}?utm_source=${UTM_SOURCE_VSCODE}`,
      TEST_CCLOUD_KAFKA_CLUSTER.ccloudUrl,
    );
  });

  it("ccloudApiKeysUrl should return the correct URL for ccloud kafka cluster", () => {
    assert.strictEqual(
      `https://confluent.cloud/environments/${TEST_CCLOUD_KAFKA_CLUSTER.environmentId}/clusters/${TEST_CCLOUD_KAFKA_CLUSTER.id}/api-keys?utm_source=${UTM_SOURCE_VSCODE}`,
      TEST_CCLOUD_KAFKA_CLUSTER.ccloudApiKeysUrl,
    );
  });
});
