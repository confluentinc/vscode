import * as assert from "assert";
import type { ThemeIcon } from "vscode";
import { TEST_CCLOUD_CONSUMER_GROUP } from "../../../tests/unit/testResources/consumerGroup";
import { IconNames } from "../../icons";
import { KafkaClusterResourceContainer } from "./kafkaClusterResourceContainer";

const TEST_LABEL = "Test";
const TEST_CONTEXT_VALUE = "test-container";

describe("models/containers/kafkaClusterResourceContainer", () => {
  describe("KafkaClusterResourceContainer", () => {
    describe("constructor", () => {
      it("should set the label from constructor argument", () => {
        const container = new KafkaClusterResourceContainer(TEST_LABEL);

        assert.strictEqual(container.label, TEST_LABEL);
      });

      it("should set contextValue when provided", () => {
        const container = new KafkaClusterResourceContainer(TEST_LABEL, [], TEST_CONTEXT_VALUE);

        assert.strictEqual(container.contextValue, TEST_CONTEXT_VALUE);
      });

      it("should set icon when provided", () => {
        const container = new KafkaClusterResourceContainer(TEST_LABEL, [], undefined, {
          id: IconNames.CONSUMER_GROUP,
        } as ThemeIcon);

        assert.strictEqual((container.iconPath as ThemeIcon).id, IconNames.CONSUMER_GROUP);
      });

      it("should default to empty children", () => {
        const container = new KafkaClusterResourceContainer(TEST_LABEL);

        assert.deepStrictEqual(container.children, []);
      });

      it("should accept initial children", () => {
        const children = [TEST_CCLOUD_CONSUMER_GROUP];
        const container = new KafkaClusterResourceContainer(TEST_LABEL, children);

        assert.deepStrictEqual(container.children, children);
      });
    });

    describe("id derivation", () => {
      it("should derive id suffix from single-word label", () => {
        const container = new KafkaClusterResourceContainer("Topics");

        assert.strictEqual(container.id, "kafka-cluster-topics");
      });

      it("should derive id suffix from multi-word label", () => {
        const container = new KafkaClusterResourceContainer("Consumer Groups");

        assert.strictEqual(container.id, "kafka-cluster-consumer-groups");
      });
    });

    describe("loggerName", () => {
      it("should include label in loggerName", () => {
        const label = "Test Resources";
        const container = new KafkaClusterResourceContainer(label);

        assert.strictEqual(container.loggerName, `models.KafkaClusterResourceContainer(${label})`);
      });
    });
  });
});
