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
import { LOCAL_ENVIRONMENT_NAME } from "../constants";
import {
  CCloudEnvironment,
  DirectEnvironment,
  EnvironmentTreeItem,
  LocalEnvironment,
} from "./environment";
import { CCloudFlinkComputePool } from "./flinkComputePool";
import { CCloudKafkaCluster, DirectKafkaCluster, LocalKafkaCluster } from "./kafkaCluster";
import { EnvironmentId } from "./resource";
import { CCloudSchemaRegistry, DirectSchemaRegistry, LocalSchemaRegistry } from "./schemaRegistry";

describe("models/environment.ts DirectEnvironment", () => {
  it("constructs from plain object as from JSON representation properly", () => {
    const env = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      kafkaClusters: [TEST_DIRECT_KAFKA_CLUSTER],
      schemaRegistry: TEST_DIRECT_SCHEMA_REGISTRY,
    });

    assert.strictEqual(env.id, TEST_DIRECT_ENVIRONMENT.id);
    assert.ok(env.kafkaClusters[0] instanceof DirectKafkaCluster);
    assert.ok(env.schemaRegistry instanceof DirectSchemaRegistry);

    // Now go to / from JSON to end up with just plain objects all the way down.
    const rawFromStorage = JSON.parse(JSON.stringify(env));
    // Now reconstruct the DirectEnvironment from the plain object.
    const asReconstitutedFromStorage = new DirectEnvironment(rawFromStorage);

    // Should have properly promoted the plain object kafka cluster and schema registry
    // to their respective classes.
    assert.ok(asReconstitutedFromStorage.kafkaClusters[0] instanceof DirectKafkaCluster);
    assert.ok(asReconstitutedFromStorage.schemaRegistry instanceof DirectSchemaRegistry);
    assert.deepStrictEqual(asReconstitutedFromStorage, env);
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

describe("models/environment.ts LocalEnvironment", () => {
  it("constructs from plain object as from JSON representation properly", () => {
    const env = new LocalEnvironment({
      id: TEST_LOCAL_ENVIRONMENT.id,
      kafkaClusters: [TEST_LOCAL_KAFKA_CLUSTER],
      schemaRegistry: TEST_LOCAL_SCHEMA_REGISTRY,
    });

    assert.strictEqual(env.id, TEST_LOCAL_ENVIRONMENT.id);
    assert.ok(env.kafkaClusters[0] instanceof LocalKafkaCluster);
    assert.ok(env.schemaRegistry instanceof LocalSchemaRegistry);

    // Now go to / from JSON to end up with just plain objects all the way down.
    const rawFromStorage = JSON.parse(JSON.stringify(env));
    // Now reconstruct the LocalEnvironment from the plain object.
    const asReconstitutedFromStorage = new LocalEnvironment(rawFromStorage);

    // Should have properly promoted the plain object kafka cluster and schema registry
    // to their respective classes.
    assert.ok(asReconstitutedFromStorage.kafkaClusters[0] instanceof LocalKafkaCluster);
    assert.ok(asReconstitutedFromStorage.schemaRegistry instanceof LocalSchemaRegistry);
    assert.deepStrictEqual(asReconstitutedFromStorage, env);
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
});

describe("models/environment.ts CCloudEnvironment", () => {
  it("constructs from plain object as from JSON representation properly", () => {
    const env = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      kafkaClusters: [TEST_CCLOUD_KAFKA_CLUSTER],
      schemaRegistry: TEST_CCLOUD_SCHEMA_REGISTRY,
      flinkComputePools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
    });

    assert.strictEqual(env.id, TEST_CCLOUD_ENVIRONMENT.id);
    assert.ok(env.kafkaClusters[0] instanceof CCloudKafkaCluster);
    assert.ok(env.schemaRegistry instanceof CCloudSchemaRegistry);
    assert.ok(env.flinkComputePools[0] instanceof CCloudFlinkComputePool);

    // Now go to / from JSON to end up with just plain objects all the way down.
    const rawFromStorage = JSON.parse(JSON.stringify(env));
    // Now reconstruct the CCloudEnvironment from the plain object.
    const asReconstitutedFromStorage = new CCloudEnvironment(rawFromStorage);
    // Should have properly promoted the plain object kafka cluster and schema registry
    // to their respective classes.
    assert.ok(asReconstitutedFromStorage.kafkaClusters[0] instanceof CCloudKafkaCluster);
    assert.ok(asReconstitutedFromStorage.schemaRegistry instanceof CCloudSchemaRegistry);
    assert.ok(asReconstitutedFromStorage.flinkComputePools[0] instanceof CCloudFlinkComputePool);
    assert.deepStrictEqual(asReconstitutedFromStorage, env);
  });

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

describe("models/environment.ts update() implementations", () => {
  it("LocalEnvironment.update()", () => {
    const env = new LocalEnvironment(TEST_LOCAL_ENVIRONMENT);
    env.kafkaClusters = [];
    env.schemaRegistry = undefined;
    env.isLoading = true;

    const updateWith = new LocalEnvironment(TEST_LOCAL_ENVIRONMENT);

    updateWith.kafkaClusters = [TEST_LOCAL_KAFKA_CLUSTER];
    updateWith.schemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;
    updateWith.isLoading = false;

    env.update(updateWith);

    assert.deepStrictEqual(env.kafkaClusters, updateWith.kafkaClusters);
    assert.deepStrictEqual(env.schemaRegistry, updateWith.schemaRegistry);
    assert.strictEqual(env.isLoading, updateWith.isLoading);
    assert.strictEqual(env.name, LOCAL_ENVIRONMENT_NAME);
  });

  it("CCloudEnvironment.update()", () => {
    const env = new CCloudEnvironment(TEST_CCLOUD_ENVIRONMENT);
    env.name = "Original Name";
    env.streamGovernancePackage = "Original package";
    env.kafkaClusters = [];
    env.schemaRegistry = undefined;
    env.flinkComputePools = [];
    env.isLoading = true;

    const updateWith = new CCloudEnvironment(TEST_CCLOUD_ENVIRONMENT);

    updateWith.name = "Updated Name";
    updateWith.streamGovernancePackage = "Updated package";
    updateWith.kafkaClusters = [TEST_CCLOUD_KAFKA_CLUSTER];
    updateWith.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;
    updateWith.flinkComputePools = [TEST_CCLOUD_FLINK_COMPUTE_POOL];
    updateWith.isLoading = false;

    env.update(updateWith);

    assert.strictEqual(env.name, updateWith.name);
    assert.strictEqual(env.streamGovernancePackage, updateWith.streamGovernancePackage);
    assert.deepStrictEqual(env.kafkaClusters, updateWith.kafkaClusters);
    assert.deepStrictEqual(env.schemaRegistry, updateWith.schemaRegistry);
    assert.deepStrictEqual(env.flinkComputePools, updateWith.flinkComputePools);
    assert.strictEqual(env.isLoading, updateWith.isLoading);
  });

  it("DirectEnvironment.update()", () => {
    const env = new DirectEnvironment(TEST_DIRECT_ENVIRONMENT);
    env.name = "Original Name";
    env.kafkaClusters = [];
    env.schemaRegistry = undefined;
    env.kafkaConfigured = false;
    env.schemaRegistryConfigured = false;
    env.formConnectionType = "Other";
    env.kafkaConnectionFailed = "Original Kafka error";
    env.schemaRegistryConnectionFailed = "Original SR error";
    env.isLoading = true;

    const updateWith = new DirectEnvironment(TEST_DIRECT_ENVIRONMENT);

    updateWith.name = "Updated Name";
    updateWith.kafkaClusters = [TEST_DIRECT_KAFKA_CLUSTER];
    updateWith.schemaRegistry = TEST_DIRECT_SCHEMA_REGISTRY;
    updateWith.kafkaConfigured = true;
    updateWith.schemaRegistryConfigured = true;
    updateWith.formConnectionType = "Apache Kafka";
    updateWith.kafkaConnectionFailed = undefined;
    updateWith.schemaRegistryConnectionFailed = undefined;
    updateWith.isLoading = false;

    env.update(updateWith);

    assert.strictEqual(env.name, updateWith.name);
    assert.deepStrictEqual(env.kafkaClusters, updateWith.kafkaClusters);
    assert.deepStrictEqual(env.schemaRegistry, updateWith.schemaRegistry);
    assert.strictEqual(env.kafkaConfigured, updateWith.kafkaConfigured);
    assert.strictEqual(env.schemaRegistryConfigured, updateWith.schemaRegistryConfigured);
    assert.strictEqual(env.formConnectionType, updateWith.formConnectionType);
    assert.strictEqual(env.kafkaConnectionFailed, updateWith.kafkaConnectionFailed);
    assert.strictEqual(
      env.schemaRegistryConnectionFailed,
      updateWith.schemaRegistryConnectionFailed,
    );
    assert.strictEqual(env.isLoading, updateWith.isLoading);
  });

  it("Disallows updating given reference with different id", () => {
    const env = new DirectEnvironment(TEST_DIRECT_ENVIRONMENT);

    const updateWith = new DirectEnvironment({
      ...TEST_DIRECT_ENVIRONMENT,
      id: "different-id" as EnvironmentId,
    });

    assert.throws(() => {
      env.update(updateWith);
    }, /Cannot update Environment with different ID/);
  });
});
