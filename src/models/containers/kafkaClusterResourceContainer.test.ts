import * as assert from "assert";
import type { ThemeIcon } from "vscode";
import { TEST_DIRECT_CONNECTION_ID } from "../../../tests/unit/testResources/connection";
import { TEST_CCLOUD_CONSUMER_GROUP } from "../../../tests/unit/testResources/consumerGroup";
import { ConnectionType } from "../../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../../constants";
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
          TEST_LABEL,
        );

        assert.strictEqual(container.connectionId, CCLOUD_CONNECTION_ID);
      });

      it("should set connectionType from constructor argument", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_LABEL,
        );

        assert.strictEqual(container.connectionType, ConnectionType.Ccloud);
      });

      it("should set the label from constructor argument", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_LABEL,
        );

        assert.strictEqual(container.label, TEST_LABEL);
      });

      it("should set contextValue when provided", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
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
          TEST_LABEL,
        );

        assert.deepStrictEqual(container.children, []);
      });

      it("should accept initial children", () => {
        const children = [TEST_CCLOUD_CONSUMER_GROUP];
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_LABEL,
          children,
        );

        assert.deepStrictEqual(container.children, children);
      });
    });

    describe("id derivation", () => {
      it("should derive id from connectionId and label", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          "Topics",
        );

        assert.strictEqual(container.id, `${CCLOUD_CONNECTION_ID}-Topics`);
      });

      it("should preserve multi-word labels in id", () => {
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          "Consumer Groups",
        );

        assert.strictEqual(container.id, `${CCLOUD_CONNECTION_ID}-Consumer Groups`);
      });

      it("should use different ids for different connection types", () => {
        const ccloudContainer = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          TEST_LABEL,
        );
        const directContainer = new KafkaClusterResourceContainer(
          TEST_DIRECT_CONNECTION_ID,
          ConnectionType.Direct,
          TEST_LABEL,
        );

        assert.notStrictEqual(ccloudContainer.id, directContainer.id);
      });
    });

    describe("loggerName", () => {
      it("should include label in loggerName", () => {
        const label = "Test Resources";
        const container = new KafkaClusterResourceContainer(
          CCLOUD_CONNECTION_ID,
          ConnectionType.Ccloud,
          label,
        );

        assert.strictEqual(container.loggerName, `KafkaClusterResourceContainer.${label}`);
      });
    });
  });
});
