import * as assert from "assert";
import type { ThemeIcon } from "vscode";
import { TEST_DIRECT_CONNECTION_ID } from "../../../tests/unit/testResources/connection";
import { TEST_CCLOUD_CONSUMER_GROUP } from "../../../tests/unit/testResources/consumerGroup";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "../../../tests/unit/testResources/kafkaCluster";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../../constants";
import { IconNames } from "../../icons";
import { KafkaClusterResourceContainer } from "./kafkaClusterResourceContainer";

const TEST_LABEL = "Test";
const TEST_CONTEXT_VALUE = "test-container";

describe("models/containers/kafkaClusterResourceContainer", () => {
  describe("KafkaClusterResourceContainer", () => {
    describe("constructor", () => {
      it("should set connectionId from constructor argument", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          TEST_LABEL,
        );

        assert.strictEqual(container.connectionId, CCLOUD_CONNECTION_ID);
      });

      it("should set connectionType from constructor argument", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          TEST_LABEL,
        );

        assert.strictEqual(container.connectionType, ConnectionType.Ccloud);
      });

      it("should set clusterId from constructor argument", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          TEST_LABEL,
        );

        assert.strictEqual(container.clusterId, TEST_CCLOUD_KAFKA_CLUSTER.id);
      });

      it("should set environmentId from constructor argument", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          TEST_LABEL,
        );

        assert.strictEqual(container.environmentId, TEST_CCLOUD_KAFKA_CLUSTER.environmentId);
      });

      it("should set the label from constructor argument", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          TEST_LABEL,
        );

        assert.strictEqual(container.label, TEST_LABEL);
      });

      it("should set contextValue when provided", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          TEST_LABEL,
          [],
          TEST_CONTEXT_VALUE,
        );

        assert.strictEqual(container.contextValue, TEST_CONTEXT_VALUE);
      });

      it("should set icon when provided", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          TEST_LABEL,
          [],
          undefined,
          { id: IconNames.CONSUMER_GROUP } as ThemeIcon,
        );

        assert.strictEqual((container.iconPath as ThemeIcon).id, IconNames.CONSUMER_GROUP);
      });

      it("should default to empty children", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          TEST_LABEL,
        );

        assert.deepStrictEqual(container.children, []);
      });

      it("should accept initial children", () => {
        const children = [TEST_CCLOUD_CONSUMER_GROUP];
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          TEST_LABEL,
          children,
        );

        assert.deepStrictEqual(container.children, children);
      });
    });

    describe("id derivation", () => {
      it("should derive id suffix from single-word label", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          "Topics",
        );

        assert.strictEqual(
          container.id,
          `${CCLOUD_CONNECTION_ID}-${TEST_CCLOUD_KAFKA_CLUSTER.id}-topics`,
        );
      });

      it("should derive id suffix from multi-word label", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          "Consumer Groups",
        );

        assert.strictEqual(
          container.id,
          `${CCLOUD_CONNECTION_ID}-${TEST_CCLOUD_KAFKA_CLUSTER.id}-consumer-groups`,
        );
      });
    });

    describe("loggerName", () => {
      it("should include label in loggerName", () => {
        const label = "Test Resources";
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          label,
        );

        assert.strictEqual(container.loggerName, `models.KafkaClusterResourceContainer(${label})`);
      });
    });

    describe("connection types", () => {
      it("should work with Local connection type", () => {
        const container = new KafkaClusterResourceContainer(
          LOCAL_CONNECTION_ID,
          ConnectionType.Local,
          TEST_LOCAL_KAFKA_CLUSTER.id,
          TEST_LOCAL_KAFKA_CLUSTER.environmentId,
          TEST_LABEL,
        );

        assert.strictEqual(container.connectionId, LOCAL_CONNECTION_ID);
        assert.strictEqual(container.connectionType, ConnectionType.Local);
        assert.strictEqual(
          container.id,
          `${LOCAL_CONNECTION_ID}-${TEST_LOCAL_KAFKA_CLUSTER.id}-test`,
        );
      });

      it("should work with Direct connection type", () => {
        const container = new KafkaClusterResourceContainer(
          TEST_DIRECT_CONNECTION_ID,
          ConnectionType.Direct,
          TEST_DIRECT_KAFKA_CLUSTER.id,
          TEST_DIRECT_KAFKA_CLUSTER.environmentId,
          TEST_LABEL,
        );

        assert.strictEqual(container.connectionId, TEST_DIRECT_CONNECTION_ID);
        assert.strictEqual(container.connectionType, ConnectionType.Direct);
      });
    });
  });
});
