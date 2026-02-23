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
import { ConsumerGroupContainer } from "./consumerGroupContainer";

describe("models/containers/consumerGroupContainer", () => {
  describe("ConsumerGroupContainer", () => {
    describe("constructor", () => {
      it("should set connectionId from constructor argument", () => {
        const container = new ConsumerGroupContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        );

        assert.strictEqual(container.connectionId, CCLOUD_CONNECTION_ID);
      });

      it("should set connectionType from constructor argument", () => {
        const container = new ConsumerGroupContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        );

        assert.strictEqual(container.connectionType, ConnectionType.Ccloud);
      });

      it("should set clusterId from constructor argument", () => {
        const container = new ConsumerGroupContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        );

        assert.strictEqual(container.clusterId, TEST_CCLOUD_KAFKA_CLUSTER.id);
      });

      it("should set environmentId from constructor argument", () => {
        const container = new ConsumerGroupContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        );

        assert.strictEqual(container.environmentId, TEST_CCLOUD_KAFKA_CLUSTER.environmentId);
      });

      it("should set id to connectionId-clusterId-consumer-groups", () => {
        const container = new ConsumerGroupContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        );

        assert.strictEqual(
          container.id,
          `${CCLOUD_CONNECTION_ID}-${TEST_CCLOUD_KAFKA_CLUSTER.id}-consumer-groups`,
        );
      });

      it("should use 'Consumer Groups' as the label", () => {
        const container = new ConsumerGroupContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        );

        assert.strictEqual(container.label, "Consumer Groups");
      });

      it("should use the consumer group icon", () => {
        const container = new ConsumerGroupContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        );

        assert.strictEqual((container.iconPath as ThemeIcon).id, IconNames.CONSUMER_GROUP);
      });

      it("should set contextValue to consumerGroups-container", () => {
        const container = new ConsumerGroupContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        );

        assert.strictEqual(container.contextValue, "consumerGroups-container");
      });

      it("should default to empty children", () => {
        const container = new ConsumerGroupContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        );

        assert.deepStrictEqual(container.children, []);
      });

      it("should accept initial children", () => {
        const groups = [TEST_CCLOUD_CONSUMER_GROUP];
        const container = new ConsumerGroupContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_CCLOUD_KAFKA_CLUSTER.id,
          TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          groups,
        );

        assert.deepStrictEqual(container.children, groups);
      });
    });

    describe("connection types", () => {
      it("should work with Local connection type", () => {
        const container = new ConsumerGroupContainer(
          LOCAL_CONNECTION_ID,
          ConnectionType.Local,
          TEST_LOCAL_KAFKA_CLUSTER.id,
          TEST_LOCAL_KAFKA_CLUSTER.environmentId,
        );

        assert.strictEqual(container.connectionId, LOCAL_CONNECTION_ID);
        assert.strictEqual(container.connectionType, ConnectionType.Local);
        assert.strictEqual(
          container.id,
          `${LOCAL_CONNECTION_ID}-${TEST_LOCAL_KAFKA_CLUSTER.id}-consumer-groups`,
        );
      });

      it("should work with Direct connection type", () => {
        const container = new ConsumerGroupContainer(
          TEST_DIRECT_CONNECTION_ID,
          ConnectionType.Direct,
          TEST_DIRECT_KAFKA_CLUSTER.id,
          TEST_DIRECT_KAFKA_CLUSTER.environmentId,
        );

        assert.strictEqual(container.connectionId, TEST_DIRECT_CONNECTION_ID);
        assert.strictEqual(container.connectionType, ConnectionType.Direct);
      });
    });
  });
});
