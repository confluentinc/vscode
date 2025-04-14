import * as assert from "assert";
import { MarkdownString, ThemeColor, ThemeIcon, TreeItemCollapsibleState } from "vscode";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_DIRECT_ENVIRONMENT,
  TEST_DIRECT_KAFKA_CLUSTER,
  TEST_DIRECT_SCHEMA_REGISTRY,
  TEST_LOCAL_ENVIRONMENT,
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import {
  CCloudEnvironment,
  DirectEnvironment,
  EnvironmentTreeItem,
  LocalEnvironment,
} from "./environment";

describe("models/environment.ts Environment", () => {
  it("should return the correct .children for a CCloudEnvironment", () => {
    const env: CCloudEnvironment = TEST_CCLOUD_ENVIRONMENT;

    // no children by default
    assert.deepStrictEqual(env.children, []);

    // add a Kafka cluster
    const envWithKafka = new CCloudEnvironment({
      ...env,
      kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
    });
    assert.deepStrictEqual(envWithKafka.children, [TEST_CCLOUD_KAFKA_CLUSTER]);

    // add SR
    const envWithKafkaSR = new CCloudEnvironment({
      ...envWithKafka,
      schemaRegistry: TEST_CCLOUD_SCHEMA_REGISTRY,
    });
    assert.deepStrictEqual(envWithKafkaSR.children, [
      TEST_CCLOUD_KAFKA_CLUSTER,
      TEST_CCLOUD_SCHEMA_REGISTRY,
    ]);

    // add Flink
    const envWithAll = new CCloudEnvironment({
      ...envWithKafkaSR,
      flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
    });
    assert.deepStrictEqual(envWithAll.children, [
      TEST_CCLOUD_KAFKA_CLUSTER,
      TEST_CCLOUD_SCHEMA_REGISTRY,
      TEST_CCLOUD_FLINK_COMPUTE_POOL,
    ]);
  });

  it("should return the correct .children for a LocalEnvironment", () => {
    const env: LocalEnvironment = TEST_LOCAL_ENVIRONMENT;

    // no children by default
    assert.deepStrictEqual(env.children, []);

    // add a child
    const envWithKafka = new LocalEnvironment({
      ...env,
      kafkaClusters: [TEST_LOCAL_KAFKA_CLUSTER],
    });
    assert.deepStrictEqual(envWithKafka.children, [TEST_LOCAL_KAFKA_CLUSTER]);

    // add SR
    const envWithKafkaSR = new LocalEnvironment({
      ...envWithKafka,
      schemaRegistry: TEST_LOCAL_SCHEMA_REGISTRY,
    });
    assert.deepStrictEqual(envWithKafkaSR.children, [
      TEST_LOCAL_KAFKA_CLUSTER,
      TEST_LOCAL_SCHEMA_REGISTRY,
    ]);

    // try to add Flink, but it should be ignored
    const envWithAll = new LocalEnvironment({
      ...envWithKafkaSR,
      flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
    } as any);
    assert.deepStrictEqual(envWithAll.children, [
      TEST_LOCAL_KAFKA_CLUSTER,
      TEST_LOCAL_SCHEMA_REGISTRY,
    ]);
  });

  it("should return the correct .children for a DirectEnvironment", () => {
    const env: DirectEnvironment = TEST_DIRECT_ENVIRONMENT;

    // no children by default
    assert.deepStrictEqual(env.children, []);

    // add a child
    const envWithKafka = new DirectEnvironment({
      ...env,
      kafkaClusters: [TEST_DIRECT_KAFKA_CLUSTER],
    });
    assert.deepStrictEqual(envWithKafka.children, [TEST_DIRECT_KAFKA_CLUSTER]);

    // add SR
    const envWithKafkaSR = new DirectEnvironment({
      ...envWithKafka,
      schemaRegistry: TEST_DIRECT_SCHEMA_REGISTRY,
    });
    assert.deepStrictEqual(envWithKafkaSR.children, [
      TEST_DIRECT_KAFKA_CLUSTER,
      TEST_DIRECT_SCHEMA_REGISTRY,
    ]);

    // try to add Flink, but it should be ignored
    const envWithAll = new DirectEnvironment({
      ...envWithKafkaSR,
      flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
    } as any);
    assert.deepStrictEqual(envWithAll.children, [
      TEST_DIRECT_KAFKA_CLUSTER,
      TEST_DIRECT_SCHEMA_REGISTRY,
    ]);
  });
});

describe("models/environment.ts EnvironmentTreeItem", () => {
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

  it("ccloud context value positively reflecting flink-compute-pool availablity", () => {
    const env = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
    });
    const treeItem = new EnvironmentTreeItem(env);
    assert.strictEqual(treeItem.contextValue, "flinkable-ccloud-environment");
  });

  it("ccloud context value negatively reflecting flink-compute-pool availablity", () => {
    const env = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      flinkComputePools: [],
    });
    const treeItem = new EnvironmentTreeItem(env);
    assert.strictEqual(treeItem.contextValue, "ccloud-environment");
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
