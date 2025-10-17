import * as assert from "assert";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_DIRECT_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources";
import {
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "../../tests/unit/testResources/kafkaCluster";
import { CCLOUD_BASE_PATH, UTM_SOURCE_VSCODE } from "../constants";
import {
  CCloudKafkaCluster,
  createKafkaClusterTooltip,
  DirectKafkaCluster,
  LocalKafkaCluster,
} from "./kafkaCluster";
import type { EnvironmentId } from "./resource";
import { KafkaTopic } from "./topic";

describe("models/kafkaCluster", () => {
  describe("equals()", () => {
    [
      {
        label: "identical LocalKafkaClusters",
        lhs: TEST_LOCAL_KAFKA_CLUSTER,
        rhs: TEST_LOCAL_KAFKA_CLUSTER,
        expected: true,
      },
      {
        label: "different LocalKafkaClusters",
        lhs: LocalKafkaCluster.create(TEST_LOCAL_KAFKA_CLUSTER),
        rhs: LocalKafkaCluster.create({
          ...TEST_LOCAL_KAFKA_CLUSTER,
          id: "different-id",
        }),
        expected: false,
      },
      {
        label: "identical CCloudKafkaClusters",
        lhs: TEST_CCLOUD_KAFKA_CLUSTER,
        rhs: TEST_CCLOUD_KAFKA_CLUSTER,
        expected: true,
      },
      {
        label: "different CCloudKafkaClusters, different env id, same cluster id",
        lhs: TEST_CCLOUD_KAFKA_CLUSTER,
        rhs: CCloudKafkaCluster.create({
          ...TEST_CCLOUD_KAFKA_CLUSTER,
          environmentId: "different-env-id" as EnvironmentId,
        }),
        expected: false,
      },
      {
        label: "local vs direct kafka cluster with same id",
        lhs: TEST_LOCAL_KAFKA_CLUSTER,
        rhs: DirectKafkaCluster.create({
          ...TEST_DIRECT_KAFKA_CLUSTER,
          id: TEST_LOCAL_KAFKA_CLUSTER.id,
        }),
        expected: false,
      },
    ].forEach(({ label, lhs, rhs, expected }) => {
      it(`.equals() should return ${expected} for ${label}`, () => {
        assert.strictEqual(lhs.equals(rhs), expected);
      });
    });
  });

  describe("contains()", () => {
    [
      {
        label: "LocalKafkaCluster contains its own topic",
        cluster: TEST_LOCAL_KAFKA_CLUSTER,
        topic: TEST_LOCAL_KAFKA_TOPIC,
        expected: true,
      },
      {
        label: "LocalKafkaCluster does not contain topic with different clusterId",
        cluster: TEST_LOCAL_KAFKA_CLUSTER,
        topic: KafkaTopic.create({
          ...TEST_LOCAL_KAFKA_TOPIC,
          clusterId: "different-cluster-id",
        }),
        expected: false,
      },
      {
        label: "CCloudKafkaCluster does not contain topic from different environment",
        cluster: TEST_CCLOUD_KAFKA_CLUSTER,
        topic: KafkaTopic.create({
          ...TEST_CCLOUD_KAFKA_TOPIC,
          environmentId: "different-env-id" as EnvironmentId,
        }),
        expected: false,
      },
      {
        label:
          "LocalKafkaCluster does not contain Direct topic even when clusterId matches (connection type mismatch)",
        cluster: TEST_LOCAL_KAFKA_CLUSTER,
        topic: KafkaTopic.create({
          ...TEST_DIRECT_KAFKA_TOPIC,
          clusterId: TEST_LOCAL_KAFKA_CLUSTER.id,
        }),
        expected: false,
      },
      {
        label:
          "CCloudKafkaCluster does not contain Local topic even when clusterId matches (connection type mismatch)",
        cluster: TEST_CCLOUD_KAFKA_CLUSTER,
        topic: KafkaTopic.create({
          ...TEST_LOCAL_KAFKA_TOPIC,
          clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
          environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        }),
        expected: false,
      },
    ].forEach(({ label, cluster, topic, expected }) => {
      it(`.contains() should return ${expected} when ${label}`, () => {
        assert.strictEqual(cluster.contains(topic), expected);
      });
    });
  });

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

  describe("CCloudKafkaCluster", () => {
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
        assert.strictEqual(true, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.isFlinkable());
      });

      it("should be false when there are no flink pools", () => {
        assert.strictEqual(false, TEST_CCLOUD_KAFKA_CLUSTER.isFlinkable());
      });
    });

    describe("isSameEnvCloudRegion()", () => {
      it("should be true when env and region match", () => {
        assert.strictEqual(
          true,
          TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.isSameEnvCloudRegion({
            environmentId: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.environmentId,
            provider: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.provider,
            region: TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.region,
          }),
        );
      });

      // table driven tests for the false cases ...
      [
        {
          label: "environmentId does not match",
          override: { environmentId: "different-env-id" as EnvironmentId },
        },
        { label: "provider does not match", override: { provider: "different-provider" } },
        { label: "region does not match", override: { region: "different-region" } },
      ].forEach(({ label, override }) => {
        it(`should be false when ${label}`, () => {
          const params = {
            ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
            ...override,
          };
          assert.strictEqual(
            false,
            TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.isSameEnvCloudRegion(params),
          );
        });
      });
    });
  });
});
