import * as assert from "assert";
import { MarkdownString, ThemeColor, ThemeIcon, TreeItemCollapsibleState } from "vscode";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_DIRECT_ENVIRONMENT,
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_DIRECT_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { DirectEnvironment, EnvironmentTreeItem } from "./environment";

describe("EnvironmentTreeItem", () => {
  it("should be collapsed when the environment has clusters", () => {
    const env = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      kafkaClusters: [TEST_DIRECT_KAFKA_CLUSTER],
      schemaRegistry: TEST_DIRECT_SCHEMA_REGISTRY,
    });

    const treeItem = new EnvironmentTreeItem(env);

    assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.Collapsed);
  });

  it("should be not be collapsible/expandable when the environment doesn't have clusters", () => {
    // no Kafka/SR by default
    const treeItem = new EnvironmentTreeItem(TEST_DIRECT_ENVIRONMENT);

    assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.None);
  });

  it("should use a warning icon if it's a direct environment with no clusters", () => {
    const env = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      kafkaClusters: [],
      schemaRegistry: undefined,
    });

    // Override isLoading to false due to no clusters
    env.isLoading = false;

    const treeItem = new EnvironmentTreeItem(env);

    assert.deepStrictEqual(
      treeItem.iconPath,
      new ThemeIcon("warning", new ThemeColor("problemsWarningIcon.foreground")),
    );
  });

  it("should create correct tooltip for a CCloud environment", () => {
    const treeItem = new EnvironmentTreeItem(TEST_CCLOUD_ENVIRONMENT);

    const tooltip = treeItem.tooltip as MarkdownString;
    assert.ok(tooltip.value.includes("Environment"));
    assert.ok(tooltip.value.includes("Stream Governance Package"));
    assert.ok(tooltip.value.includes("confluent.cloud/environments"));
  });

  it("should create correct tooltip for a direct environment without clusters", () => {
    // no Kafka cluster or Schema Registry by default
    const treeItem = new EnvironmentTreeItem(TEST_DIRECT_ENVIRONMENT);

    const tooltip = treeItem.tooltip as MarkdownString;
    assert.ok(tooltip.value.includes("Unable to connect"));
  });

  it("should not include a warning in the tooltip for a direct environment with clusters", () => {
    const directEnv = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      kafkaClusters: [TEST_DIRECT_KAFKA_CLUSTER],
    });
    const treeItem = new EnvironmentTreeItem(directEnv);

    const tooltip = treeItem.tooltip as MarkdownString;
    assert.ok(!tooltip.value.includes("Unable to connect"));
  });

  it("should include the form connection type for a direct environment/connection", () => {
    // without a formConnectionType set
    const treeItemWithoutType = new EnvironmentTreeItem(TEST_DIRECT_ENVIRONMENT);
    assert.ok((treeItemWithoutType.tooltip as MarkdownString).value.includes("Other Connection"));

    // with a formConnectionType set
    const formConnectionType = "Apache Kafka";
    const directEnvWithType = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      formConnectionType: formConnectionType,
    });
    const treeItemWithType = new EnvironmentTreeItem(directEnvWithType);

    assert.ok(
      (treeItemWithType.tooltip as MarkdownString).value.includes(
        `${formConnectionType} Connection`,
      ),
    );
  });
});
