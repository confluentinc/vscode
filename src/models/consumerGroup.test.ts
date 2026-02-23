import * as assert from "assert";
import type { MarkdownString, ThemeIcon } from "vscode";
import { TreeItemCollapsibleState } from "vscode";
import {
  createConsumerGroup,
  createConsumerGroupMember,
  TEST_CCLOUD_CONSUMER,
  TEST_CCLOUD_CONSUMER_GROUP,
  TEST_CCLOUD_CONSUMER_GROUP_ID,
  TEST_DIRECT_CONSUMER,
  TEST_DIRECT_CONSUMER_GROUP,
  TEST_LOCAL_CONSUMER,
  TEST_LOCAL_CONSUMER_GROUP,
} from "../../tests/unit/testResources/consumerGroup";
import { TEST_CCLOUD_KAFKA_CLUSTER } from "../../tests/unit/testResources/kafkaCluster";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { IconNames } from "../icons";
import { ConsumerGroupState, ConsumerGroupTreeItem, ConsumerTreeItem } from "./consumerGroup";

describe("models/consumerGroup.ts", () => {
  describe("ConsumerGroup", () => {
    describe("id", () => {
      it("should return clusterId-consumerGroupId", () => {
        assert.strictEqual(
          TEST_CCLOUD_CONSUMER_GROUP.id,
          `${TEST_CCLOUD_CONSUMER_GROUP.clusterId}-${TEST_CCLOUD_CONSUMER_GROUP_ID}`,
        );
      });
    });

    describe("hasMembers", () => {
      it("should return true when members exist", () => {
        assert.strictEqual(TEST_CCLOUD_CONSUMER_GROUP.hasMembers, true);
      });

      it("should return false when the members array is empty", () => {
        const group = createConsumerGroup({
          connectionId: CCLOUD_CONNECTION_ID,
          connectionType: ConnectionType.Ccloud,
          environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
          members: [],
        });

        assert.strictEqual(group.hasMembers, false);
      });
    });

    describe("canResetOffsets", () => {
      const resettableStates = [ConsumerGroupState.Empty, ConsumerGroupState.Dead];
      const nonResettableStates = [
        ConsumerGroupState.Stable,
        ConsumerGroupState.PreparingRebalance,
        ConsumerGroupState.CompletingRebalance,
        ConsumerGroupState.Unknown,
      ];

      for (const state of resettableStates) {
        it(`should return true for ${state} state`, () => {
          const group = createConsumerGroup({
            connectionId: CCLOUD_CONNECTION_ID,
            connectionType: ConnectionType.Ccloud,
            environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
            clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
            state,
          });

          assert.strictEqual(group.canResetOffsets, true);
        });
      }

      for (const state of nonResettableStates) {
        it(`should return false for ${state} state`, () => {
          const group = createConsumerGroup({
            connectionId: CCLOUD_CONNECTION_ID,
            connectionType: ConnectionType.Ccloud,
            environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
            clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
            state,
          });

          assert.strictEqual(group.canResetOffsets, false);
        });
      }
    });

    describe("searchableText", () => {
      it("should return the consumerGroupId", () => {
        assert.strictEqual(
          TEST_CCLOUD_CONSUMER_GROUP.searchableText(),
          TEST_CCLOUD_CONSUMER_GROUP_ID,
        );
      });
    });

    describe("ccloudUrl", () => {
      it("should return the correct URL for CCloud groups", () => {
        const group = TEST_CCLOUD_CONSUMER_GROUP;
        const expected = `https://confluent.cloud/environments/${group.environmentId}/clusters/${group.clusterId}/clients/consumer-lag/${group.consumerGroupId}`;

        assert.strictEqual(group.ccloudUrl(), expected);
      });

      it("should return empty string for non-CCloud groups", () => {
        assert.strictEqual(TEST_DIRECT_CONSUMER_GROUP.ccloudUrl(), "");
        assert.strictEqual(TEST_LOCAL_CONSUMER_GROUP.ccloudUrl(), "");
      });
    });
  });

  describe("Consumer", () => {
    describe("id", () => {
      it("should return clusterId-consumerGroupId-consumerId", () => {
        const consumer = TEST_CCLOUD_CONSUMER;
        assert.strictEqual(
          consumer.id,
          `${consumer.clusterId}-${consumer.consumerGroupId}-${consumer.consumerId}`,
        );
      });
    });

    describe("searchableText", () => {
      it("should return consumerId and clientId", () => {
        const consumer = TEST_CCLOUD_CONSUMER;
        assert.strictEqual(
          consumer.searchableText(),
          `${consumer.consumerId} ${consumer.clientId}`,
        );
      });
    });

    describe("ccloudUrl", () => {
      it("should return the correct URL for CCloud consumers", () => {
        const consumer = TEST_CCLOUD_CONSUMER;
        const expected = `https://confluent.cloud/environments/${consumer.environmentId}/clusters/${consumer.clusterId}/clients/consumers/${consumer.clientId}`;

        assert.strictEqual(consumer.ccloudUrl(), expected);
      });

      it("should return empty string for non-CCloud consumers", () => {
        assert.strictEqual(TEST_DIRECT_CONSUMER.ccloudUrl(), "");
        assert.strictEqual(TEST_LOCAL_CONSUMER.ccloudUrl(), "");
      });
    });

    describe("instanceId", () => {
      it("should default to null when not provided", () => {
        const consumer = createConsumerGroupMember({
          connectionId: CCLOUD_CONNECTION_ID,
          connectionType: ConnectionType.Ccloud,
          environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
          consumerGroupId: "group-1",
        });

        assert.strictEqual(consumer.instanceId, null);
      });

      it("should preserve instanceId when provided", () => {
        const consumer = createConsumerGroupMember({
          connectionId: CCLOUD_CONNECTION_ID,
          connectionType: ConnectionType.Ccloud,
          environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
          consumerGroupId: "group-1",
          instanceId: "instance-42",
        });

        assert.strictEqual(consumer.instanceId, "instance-42");
      });
    });
  });

  describe("ConsumerGroupTreeItem", () => {
    it("should use consumerGroupId as label", () => {
      const treeItem = new ConsumerGroupTreeItem(TEST_CCLOUD_CONSUMER_GROUP);

      assert.strictEqual(treeItem.label, TEST_CCLOUD_CONSUMER_GROUP.consumerGroupId);
    });

    it("should set id from the resource", () => {
      const treeItem = new ConsumerGroupTreeItem(TEST_CCLOUD_CONSUMER_GROUP);

      assert.strictEqual(treeItem.id, TEST_CCLOUD_CONSUMER_GROUP.id);
    });

    it("should include connection type and state in contextValue", () => {
      const treeItem = new ConsumerGroupTreeItem(TEST_CCLOUD_CONSUMER_GROUP);

      assert.strictEqual(treeItem.contextValue, "ccloud-consumerGroup-Stable");
    });

    it("should set contextValue for local connection type", () => {
      const treeItem = new ConsumerGroupTreeItem(TEST_LOCAL_CONSUMER_GROUP);

      assert.strictEqual(treeItem.contextValue, "local-consumerGroup-Stable");
    });

    it("should set contextValue for direct connection type", () => {
      const treeItem = new ConsumerGroupTreeItem(TEST_DIRECT_CONSUMER_GROUP);

      assert.strictEqual(treeItem.contextValue, "direct-consumerGroup-Stable");
    });

    it("should always set collapsible state to Collapsed", () => {
      const treeItem = new ConsumerGroupTreeItem(TEST_CCLOUD_CONSUMER_GROUP);

      assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.Collapsed);
    });

    it("should set description to the group state", () => {
      const treeItem = new ConsumerGroupTreeItem(TEST_CCLOUD_CONSUMER_GROUP);

      assert.strictEqual(treeItem.description, ConsumerGroupState.Stable);
    });

    it("should use the consumer group icon", () => {
      const treeItem = new ConsumerGroupTreeItem(TEST_CCLOUD_CONSUMER_GROUP);
      const icon = treeItem.iconPath as ThemeIcon;

      assert.strictEqual(icon.id, IconNames.CONSUMER_GROUP);
    });

    describe("icon color", () => {
      const expectedColorByState: Record<ConsumerGroupState, string | undefined> = {
        [ConsumerGroupState.Stable]: "testing.iconPassed",
        [ConsumerGroupState.Empty]: "problemsWarningIcon.foreground",
        [ConsumerGroupState.Dead]: "problemsErrorIcon.foreground",
        [ConsumerGroupState.PreparingRebalance]: "notificationsInfoIcon.foreground",
        [ConsumerGroupState.CompletingRebalance]: "notificationsInfoIcon.foreground",
        [ConsumerGroupState.Unknown]: undefined,
      };

      for (const [state, expectedColor] of Object.entries(expectedColorByState)) {
        it(`should use color=${expectedColor} when state=${state}`, () => {
          const group = createConsumerGroup({
            connectionId: CCLOUD_CONNECTION_ID,
            connectionType: ConnectionType.Ccloud,
            environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
            clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
            state: state as ConsumerGroupState,
          });
          const item = new ConsumerGroupTreeItem(group);
          const icon = item.iconPath as ThemeIcon;

          assert.strictEqual(icon.color?.id, expectedColor);
        });
      }
    });

    describe("tooltip", () => {
      it("should include consumer group details", () => {
        const treeItem = new ConsumerGroupTreeItem(TEST_CCLOUD_CONSUMER_GROUP);
        const text = (treeItem.tooltip as MarkdownString).value;

        assert.ok(text.includes("Consumer Group"));
        assert.ok(text.includes(TEST_CCLOUD_CONSUMER_GROUP.consumerGroupId));
        assert.ok(text.includes(ConsumerGroupState.Stable));
        assert.ok(text.includes("range"));
      });

      it("should include member count when members exist", () => {
        const treeItem = new ConsumerGroupTreeItem(TEST_CCLOUD_CONSUMER_GROUP);
        const text = (treeItem.tooltip as MarkdownString).value;

        assert.ok(text.includes("Members"));
      });

      it("should show warning for Empty state", () => {
        const group = createConsumerGroup({
          connectionId: CCLOUD_CONNECTION_ID,
          connectionType: ConnectionType.Ccloud,
          environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
          state: ConsumerGroupState.Empty,
        });
        const text = (new ConsumerGroupTreeItem(group).tooltip as MarkdownString).value;

        assert.ok(text.includes("No active consumers"));
      });

      it("should show warning for Dead state", () => {
        const group = createConsumerGroup({
          connectionId: CCLOUD_CONNECTION_ID,
          connectionType: ConnectionType.Ccloud,
          environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
          state: ConsumerGroupState.Dead,
        });
        const text = (new ConsumerGroupTreeItem(group).tooltip as MarkdownString).value;

        assert.ok(text.includes("dead and will be removed"));
      });

      it("should show warning for rebalancing states", () => {
        const group = createConsumerGroup({
          connectionId: CCLOUD_CONNECTION_ID,
          connectionType: ConnectionType.Ccloud,
          environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
          state: ConsumerGroupState.PreparingRebalance,
        });
        const text = (new ConsumerGroupTreeItem(group).tooltip as MarkdownString).value;

        assert.ok(text.includes("currently rebalancing"));
      });
    });
  });

  describe("ConsumerTreeItem", () => {
    it("should include consumerId and clientId in label", () => {
      const treeItem = new ConsumerTreeItem(TEST_CCLOUD_CONSUMER);
      assert.strictEqual(
        treeItem.label,
        `${TEST_CCLOUD_CONSUMER.consumerId} (client: ${TEST_CCLOUD_CONSUMER.clientId})`,
      );
    });

    it("should use only consumerId as label when clientId is empty", () => {
      const consumer = createConsumerGroupMember({
        connectionId: CCLOUD_CONNECTION_ID,
        connectionType: ConnectionType.Ccloud,
        environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
        clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
        consumerGroupId: "group-1",
        clientId: "",
      });
      const treeItem = new ConsumerTreeItem(consumer);
      assert.strictEqual(treeItem.label, consumer.consumerId);
    });

    it("should set id from the resource", () => {
      const treeItem = new ConsumerTreeItem(TEST_CCLOUD_CONSUMER);
      assert.strictEqual(treeItem.id, TEST_CCLOUD_CONSUMER.id);
    });

    it("should include connection type in contextValue", () => {
      const treeItem = new ConsumerTreeItem(TEST_CCLOUD_CONSUMER);
      assert.strictEqual(treeItem.contextValue, "ccloud-consumerGroup-member");
    });

    it("should set collapsible state to None", () => {
      const treeItem = new ConsumerTreeItem(TEST_CCLOUD_CONSUMER);
      assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.None);
    });

    it("should use the placeholder icon", () => {
      const treeItem = new ConsumerTreeItem(TEST_CCLOUD_CONSUMER);
      const icon = treeItem.iconPath as ThemeIcon;
      assert.strictEqual(icon.id, IconNames.PLACEHOLDER);
    });

    describe("tooltip", () => {
      it("should include consumer details", () => {
        const treeItem = new ConsumerTreeItem(TEST_CCLOUD_CONSUMER);
        const text = (treeItem.tooltip as MarkdownString).value;

        assert.ok(text.includes("Consumer"));
        assert.ok(text.includes(TEST_CCLOUD_CONSUMER.consumerId));
        assert.ok(text.includes(TEST_CCLOUD_CONSUMER.clientId));
        assert.ok(text.includes(TEST_CCLOUD_CONSUMER.consumerGroupId));
      });

      it("should include instanceId when present", () => {
        const consumer = createConsumerGroupMember({
          connectionId: CCLOUD_CONNECTION_ID,
          connectionType: ConnectionType.Ccloud,
          environmentId: TEST_CCLOUD_KAFKA_CLUSTER.environmentId,
          clusterId: TEST_CCLOUD_KAFKA_CLUSTER.id,
          consumerGroupId: "group-1",
          instanceId: "instance-42",
        });
        const text = (new ConsumerTreeItem(consumer).tooltip as MarkdownString).value;

        assert.ok(text.includes("instance-42"));
      });
    });
  });
});
