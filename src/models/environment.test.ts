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

  it("should create correct tooltip for a CCloud environment", () => {
    const treeItem = new EnvironmentTreeItem(TEST_CCLOUD_ENVIRONMENT);

    const tooltip = treeItem.tooltip as MarkdownString;
    assert.ok(tooltip.value.includes("Environment"));
    assert.ok(tooltip.value.includes("Stream Governance Package"));
    assert.ok(tooltip.value.includes("confluent.cloud/environments"));
  });

  for (const [missingKafka, missingSR] of [
    [true, false],
    [false, true],
    [true, true],
    [false, false],
  ]) {
    const missingInfo = JSON.stringify({ missingKafka, missingSR });
    const haveOrNot = missingKafka || missingSR ? "have" : "not have";
    it(`should ${haveOrNot} an error icon for a direct environment ${missingInfo}`, () => {
      const env = new DirectEnvironment({
        ...TEST_DIRECT_ENVIRONMENT,
        kafkaClusters: [],
        kafkaConfigured: missingKafka,
        schemaRegistry: undefined,
        schemaRegistryConfigured: missingSR,
      });

      // Override isLoading to false due to no clusters
      env.isLoading = false;

      const treeItem = new EnvironmentTreeItem(env);

      if (missingKafka || missingSR) {
        assert.deepStrictEqual(
          treeItem.iconPath,
          new ThemeIcon("warning", new ThemeColor("problemsErrorIcon.foreground")),
        );
      } else {
        assert.deepStrictEqual(treeItem.iconPath, new ThemeIcon(env.iconName));
      }
    });

    it(`should ${haveOrNot} a tooltip warning for a direct environment ${missingInfo}`, () => {
      // no Kafka cluster or Schema Registry by default
      const resource = new DirectEnvironment({
        ...TEST_DIRECT_ENVIRONMENT,
        kafkaClusters: [],
        kafkaConfigured: missingKafka,
        schemaRegistry: undefined,
        schemaRegistryConfigured: missingSR,
      });
      resource.kafkaConnectionFailed = missingKafka ? "kafka config is bad" : undefined;
      resource.schemaRegistryConnectionFailed = missingSR ? "SR config is bad" : undefined;

      const treeItem = new EnvironmentTreeItem(resource);

      const tooltip = treeItem.tooltip as MarkdownString;
      assert.equal(tooltip.value.includes("Unable to connect"), missingKafka || missingSR);
    });
  }

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
