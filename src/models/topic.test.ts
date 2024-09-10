import * as assert from "assert";
import "mocha";
import * as vscode from "vscode";
import { MarkdownString } from "vscode";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources/topic";
import { IconNames } from "../constants";
import { KafkaTopic, KafkaTopicTreeItem } from "./topic";

describe("Test KafkaTopic methods", () => {
  it("Local topics should smell local", () => {
    assert.strictEqual(true, TEST_LOCAL_KAFKA_TOPIC.isLocalTopic());
  });

  it("CCLoud topics should not smell local", () => {
    assert.strictEqual(false, TEST_CCLOUD_KAFKA_TOPIC.isLocalTopic());
  });
});

describe("Test KafkaTopic properties", () => {
  it("uniqueId should return a unique identifier for the topic", () => {
    assert.strictEqual(
      `${TEST_LOCAL_KAFKA_TOPIC.clusterId}-${TEST_LOCAL_KAFKA_TOPIC.name}`,
      TEST_LOCAL_KAFKA_TOPIC.uniqueId,
    );
  });

  it("ccloudUrl should return the correct URL for ccloud-resident topics", () => {
    assert.strictEqual(
      `https://confluent.cloud/environments/${TEST_CCLOUD_KAFKA_TOPIC.environmentId}/clusters/${TEST_CCLOUD_KAFKA_TOPIC.clusterId}/topics/${TEST_CCLOUD_KAFKA_TOPIC.name}/overview`,
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
    // 'READ' -> 'Read' ...
    const operationTitleCase = operation.toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    // "-authzRead"
    const expectedContextSubstring = `-authz${operationTitleCase}`;
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
    const noReadTopic = KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, operations: ["WRITE"] });
    const noReadTopicTreeItem = new KafkaTopicTreeItem(noReadTopic);

    assert.strictEqual(hasAuthorizationTooltipWarning(noReadTopicTreeItem, "READ"), true);
    assert.strictEqual(hasOperationContextFlag(noReadTopicTreeItem, "READ"), false);
  });

  it("No delete operation implications", () => {
    const NO_DELETE_TOPIC = KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, operations: ["READ"] });
    const noDeleteTopicTreeItem = new KafkaTopicTreeItem(NO_DELETE_TOPIC);

    assert.strictEqual(hasAuthorizationTooltipWarning(noDeleteTopicTreeItem, "DELETE"), true);
    assert.strictEqual(hasOperationContextFlag(noDeleteTopicTreeItem, "DELETE"), false);
  });

  it("No permissions at all implications", () => {
    const NO_OPERATIONS_TOPIC = KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, operations: [] });
    const noPermissionsTopicTreeItem = new KafkaTopicTreeItem(NO_OPERATIONS_TOPIC);

    assert.strictEqual(hasAuthorizationTooltipWarning(noPermissionsTopicTreeItem, "READ"), true);
    assert.strictEqual(hasAuthorizationTooltipWarning(noPermissionsTopicTreeItem, "DELETE"), true);
    assert.strictEqual(hasOperationContextFlag(noPermissionsTopicTreeItem, "READ"), false);
    assert.strictEqual(hasOperationContextFlag(noPermissionsTopicTreeItem, "DELETE"), false);
  });

  it("has schema implications", () => {
    const schemaTopicTreeItem = new KafkaTopicTreeItem(TEST_CCLOUD_KAFKA_TOPIC);
    const icon = schemaTopicTreeItem.iconPath;
    assert.strictEqual(icon instanceof vscode.ThemeIcon, true);
    assert.strictEqual((icon as vscode.ThemeIcon).id, IconNames.TOPIC);
    assert.strictEqual(schemaTopicTreeItem.contextValue!.includes("-with-schema"), true);
  });

  it("no schema implications", () => {
    const noSchemaTopicTreeItem = new KafkaTopicTreeItem(TEST_LOCAL_KAFKA_TOPIC);
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
});
