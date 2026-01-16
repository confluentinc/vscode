import * as assert from "assert";
import "mocha";
import * as vscode from "vscode";
import { MarkdownString } from "vscode";
import { TEST_CCLOUD_SUBJECT } from "../../tests/unit/testResources/schema";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources/topic";
import { CCLOUD_BASE_PATH, UTM_SOURCE_VSCODE } from "../constants";
import { IconNames } from "../icons";
import { KafkaTopic, KafkaTopicTreeItem } from "./topic";

describe("Test KafkaTopic properties", () => {
  it("id should return a unique identifier for the topic", () => {
    assert.strictEqual(
      `${TEST_LOCAL_KAFKA_TOPIC.clusterId}-${TEST_LOCAL_KAFKA_TOPIC.name}`,
      TEST_LOCAL_KAFKA_TOPIC.id,
    );
  });

  it("ccloudUrl should return the correct URL for ccloud-resident topics", () => {
    assert.strictEqual(
      `https://${CCLOUD_BASE_PATH}/environments/${TEST_CCLOUD_KAFKA_TOPIC.environmentId}/clusters/${TEST_CCLOUD_KAFKA_TOPIC.clusterId}/topics/${TEST_CCLOUD_KAFKA_TOPIC.name}/overview?utm_source=${UTM_SOURCE_VSCODE}`,
      TEST_CCLOUD_KAFKA_TOPIC.ccloudUrl,
    );
  });

  it("ccloudUrl should return an empty string for local topics", () => {
    assert.strictEqual("", TEST_LOCAL_KAFKA_TOPIC.ccloudUrl);
  });
});

describe("KafkaTopicTreeItem constructor", () => {
  /** Extract a string value from the tooltip field, which may be undefined or
   * a MarkdownString */
  function tooltipText(topicTreeItem: KafkaTopicTreeItem): string {
    if (!topicTreeItem.tooltip) {
      return "";
    }

    return topicTreeItem.tooltip instanceof MarkdownString
      ? topicTreeItem.tooltip.value
      : topicTreeItem.tooltip;
  }

  /** Does the tooltip string include an authorization warning? */
  function hasAuthorizationTooltipWarning(
    topicTreeItem: KafkaTopicTreeItem,
    substring: string,
  ): boolean {
    const tt = tooltipText(topicTreeItem);

    return tt.includes("Missing authorization") && tt.includes(substring);
  }

  function hasOperationContextFlag(topicTreeItem: KafkaTopicTreeItem, operation: string): boolean {
    const contextValue = topicTreeItem.contextValue ?? "";
    // "-authzREAD"
    const expectedContextSubstring = `-authz${operation}`;
    return contextValue.includes(expectedContextSubstring);
  }

  it("All permitted operations", () => {
    const readWriteTopicTreeItem = new KafkaTopicTreeItem(TEST_CCLOUD_KAFKA_TOPIC);

    assert.strictEqual(
      hasAuthorizationTooltipWarning(readWriteTopicTreeItem, "READ"),
      false,
      "should not have read operation warning",
    );

    assert.strictEqual(
      hasAuthorizationTooltipWarning(readWriteTopicTreeItem, "DELETE"),
      false,
      "should not have delete operation warning",
    );

    assert.strictEqual(
      hasOperationContextFlag(readWriteTopicTreeItem, "READ"),
      true,
      "should have read operation context flag",
    );
    assert.strictEqual(
      hasOperationContextFlag(readWriteTopicTreeItem, "DELETE"),
      true,
      "should have delete operation context flag",
    );
  });

  it("No read operation implications", () => {
    const noReadTopic = new KafkaTopic({ ...TEST_CCLOUD_KAFKA_TOPIC, operations: ["WRITE"] });
    const noReadTopicTreeItem = new KafkaTopicTreeItem(noReadTopic);

    assert.strictEqual(hasAuthorizationTooltipWarning(noReadTopicTreeItem, "READ"), true);
    assert.strictEqual(hasOperationContextFlag(noReadTopicTreeItem, "READ"), false);
  });

  it("No delete operation implications", () => {
    const NO_DELETE_TOPIC = new KafkaTopic({ ...TEST_CCLOUD_KAFKA_TOPIC, operations: ["READ"] });
    const noDeleteTopicTreeItem = new KafkaTopicTreeItem(NO_DELETE_TOPIC);

    assert.strictEqual(hasAuthorizationTooltipWarning(noDeleteTopicTreeItem, "DELETE"), true);
    assert.strictEqual(hasOperationContextFlag(noDeleteTopicTreeItem, "DELETE"), false);
  });

  it("No permissions at all implications", () => {
    const NO_OPERATIONS_TOPIC = new KafkaTopic({ ...TEST_CCLOUD_KAFKA_TOPIC, operations: [] });
    const noPermissionsTopicTreeItem = new KafkaTopicTreeItem(NO_OPERATIONS_TOPIC);

    assert.strictEqual(hasAuthorizationTooltipWarning(noPermissionsTopicTreeItem, "READ"), true);
    assert.strictEqual(hasAuthorizationTooltipWarning(noPermissionsTopicTreeItem, "DELETE"), true);
    assert.strictEqual(hasOperationContextFlag(noPermissionsTopicTreeItem, "READ"), false);
    assert.strictEqual(hasOperationContextFlag(noPermissionsTopicTreeItem, "DELETE"), false);
  });

  it("has schema implications", () => {
    const schemaTopicTreeItem = new KafkaTopicTreeItem(
      new KafkaTopic({ ...TEST_CCLOUD_KAFKA_TOPIC, children: [TEST_CCLOUD_SUBJECT] }),
    );
    const icon = schemaTopicTreeItem.iconPath;
    assert.strictEqual(icon instanceof vscode.ThemeIcon, true);
    assert.strictEqual((icon as vscode.ThemeIcon).id, IconNames.TOPIC);
    assert.strictEqual(schemaTopicTreeItem.contextValue!.includes("-with-schema"), true);
    assert.strictEqual(
      schemaTopicTreeItem.collapsibleState,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
  });

  it("no schema implications", () => {
    const noSchemaTopicTreeItem = new KafkaTopicTreeItem(
      new KafkaTopic({ ...TEST_CCLOUD_KAFKA_TOPIC, children: [] }),
    );
    const icon = noSchemaTopicTreeItem.iconPath;
    assert.strictEqual(icon instanceof vscode.ThemeIcon, true);
    assert.strictEqual((icon as vscode.ThemeIcon).id, IconNames.TOPIC_WITHOUT_SCHEMA);
    assert.strictEqual((icon as vscode.ThemeIcon).color!.id, "problemsWarningIcon.foreground");
    assert.strictEqual(noSchemaTopicTreeItem.contextValue!.includes("-with-schema"), false);
    assert.strictEqual(
      noSchemaTopicTreeItem.collapsibleState,
      vscode.TreeItemCollapsibleState.None,
    );
  });

  it("should append context value with -flinkable if the cluster has matchking flink pool in the same provider/region", () => {
    const flinkableTopicTreeItem = new KafkaTopicTreeItem(
      new KafkaTopic({ ...TEST_CCLOUD_KAFKA_TOPIC, isFlinkable: true }),
    );
    assert.strictEqual(flinkableTopicTreeItem.contextValue!.includes("-flinkable"), true);
  });

  it("should not append context value with -flinkable if the cluster has matchking flink pool in the same provider/region", () => {
    const nonFlinkableTopicTreeItem = new KafkaTopicTreeItem(
      new KafkaTopic({ ...TEST_CCLOUD_KAFKA_TOPIC, isFlinkable: false }),
    );
    assert.strictEqual(nonFlinkableTopicTreeItem.contextValue!.includes("-flinkable"), false);
  });

  it("set context value for topic with muliple attributes such as schema and flinkable correctly", () => {
    const topicWithBothTreeItem = new KafkaTopicTreeItem(
      new KafkaTopic({
        ...TEST_CCLOUD_KAFKA_TOPIC,
        children: [TEST_CCLOUD_SUBJECT],
        isFlinkable: true,
      }),
    );
    assert.strictEqual(topicWithBothTreeItem.contextValue!.includes("-with-schema"), true);
    assert.strictEqual(topicWithBothTreeItem.contextValue!.includes("-flinkable"), true);
  });
});
