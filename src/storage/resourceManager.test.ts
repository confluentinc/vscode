import * as assert from "assert";
import { StorageManager } from ".";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources";
import {
  TEST_DIRECT_CONNECTION_FORM_SPEC,
  TEST_DIRECT_CONNECTION_ID,
} from "../../tests/unit/testResources/connection";
import { getTestExtensionContext, getTestStorageManager } from "../../tests/unit/testUtils";
import {
  ConnectionSpec,
  KafkaClusterConfigFromJSON,
  KafkaClusterConfigToJSON,
} from "../clients/sidecar";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import { ConnectionId } from "../models/resource";
import { Schema } from "../models/schema";
import { CCloudSchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { WorkspaceStorageKeys } from "./constants";
import {
  CCloudKafkaClustersByEnv,
  CCloudSchemaRegistryByEnv,
  CustomConnectionSpec,
  CustomConnectionSpecFromJSON,
  CustomConnectionSpecToJSON,
  DirectConnectionsById,
  getResourceManager,
  mapToString,
  ResourceManager,
  stringToMap,
} from "./resourceManager";

describe("ResourceManager (CCloud) environment methods", function () {
  let storageManager: StorageManager;
  let environments: CCloudEnvironment[];

  before(async () => {
    // extension needs to be activated before storage manager can be used
    storageManager = await getTestStorageManager();
    environments = [
      new CCloudEnvironment({ ...TEST_CCLOUD_ENVIRONMENT, id: "test-env-id-1" }),
      new CCloudEnvironment({ ...TEST_CCLOUD_ENVIRONMENT, id: "test-env-id-2" }),
    ];
  });

  beforeEach(async () => {
    // fresh slate for each test
    await storageManager.clearWorkspaceState();
  });

  afterEach(async () => {
    // clean up after each test
    await storageManager.clearWorkspaceState();
  });

  it("setCCloudEnvironments() should correctly store Environments", async () => {
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudEnvironments(environments);
    // verify the environments were stored correctly
    let storedEnvironments: CCloudEnvironment[] = await resourceManager.getCCloudEnvironments();
    assert.ok(storedEnvironments);
    assert.deepStrictEqual(storedEnvironments, environments);
  });

  it("getCCloudEnvironments() should correctly retrieve Environments", async () => {
    const resourceManager = getResourceManager();
    // set the environments in the StorageManager before retrieving them
    await resourceManager.setCCloudEnvironments(environments);
    // verify the environments were retrieved correctly
    const retrievedEnvironments: CCloudEnvironment[] =
      await resourceManager.getCCloudEnvironments();
    assert.deepStrictEqual(retrievedEnvironments, environments);
  });

  it("getCCloudEnvironment() should correctly retrieve an Environment", async () => {
    // set the environments in the StorageManager before retrieving one
    await getResourceManager().setCCloudEnvironments(environments);
    // verify the environment was retrieved correctly
    const environment: CCloudEnvironment | null = await getResourceManager().getCCloudEnvironment(
      environments[0].id,
    );
    assert.deepStrictEqual(environment, environments[0]);
  });

  it("getCCloudEnvironment() should return null if the environment is not found", async () => {
    const resourceManager = getResourceManager();
    // set the environments in the StorageManager before retrieving one
    await resourceManager.setCCloudEnvironments(environments);
    // verify the environment was not found
    const missingEnvironment: CCloudEnvironment | null =
      await resourceManager.getCCloudEnvironment("nonexistent-env-id");
    assert.strictEqual(missingEnvironment, null);
  });

  it("deleteCCloudEnvironments() should correctly delete Environments", async () => {
    // set the environments in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudEnvironments(environments);
    await resourceManager.deleteCCloudEnvironments();
    // verify the environments were deleted correctly
    const missingEnvironments = await storageManager.getWorkspaceState(
      WorkspaceStorageKeys.CCLOUD_ENVIRONMENTS,
    );
    assert.deepStrictEqual(missingEnvironments, undefined);
  });
});

describe("ResourceManager Kafka cluster methods", function () {
  let storageManager: StorageManager;
  let ccloudClusters: CCloudKafkaCluster[];
  let localClusters: LocalKafkaCluster[];

  before(async () => {
    // extension needs to be activated before storage manager can be used
    storageManager = await getTestStorageManager();
    ccloudClusters = [
      CCloudKafkaCluster.create({ ...TEST_CCLOUD_KAFKA_CLUSTER, id: "test-cluster-id-1" }),
      CCloudKafkaCluster.create({ ...TEST_CCLOUD_KAFKA_CLUSTER, id: "test-cluster-id-2" }),
    ];
    localClusters = [
      LocalKafkaCluster.create({ ...TEST_LOCAL_KAFKA_CLUSTER, id: "test-cluster-id-1" }),
    ];
  });

  beforeEach(async () => {
    // fresh slate for each test
    await storageManager.clearWorkspaceState();
  });

  afterEach(async () => {
    // clean up after each test
    await storageManager.clearWorkspaceState();
  });

  it("CCLOUD: setCCloudKafkaClusters() should correctly store Kafka clusters", async () => {
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudKafkaClusters(ccloudClusters);
    // verify the clusters were stored correctly
    let storedClustersByEnv: CCloudKafkaClustersByEnv =
      await resourceManager.getCCloudKafkaClusters();

    assert.ok(storedClustersByEnv);
    assert.ok(storedClustersByEnv instanceof Map);
    assert.ok(storedClustersByEnv.has(TEST_CCLOUD_ENVIRONMENT.id));
    assert.deepStrictEqual(storedClustersByEnv.get(TEST_CCLOUD_ENVIRONMENT.id), ccloudClusters);
  });

  it("CCLOUD: setCCloudKafkaClusters() should add new environment keys if they don't exist", async () => {
    const resourceManager = getResourceManager();
    // set the first batch of clusters from the first environment
    await resourceManager.setCCloudKafkaClusters(ccloudClusters);
    // create and set the second batch of clusters for the new environment
    const newEnvironmentId = "new-environment-id";
    const newClusters: CCloudKafkaCluster[] = [
      CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        id: "new-cluster-id-1",
        environmentId: newEnvironmentId,
      }),
      CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        id: "new-cluster-id-2",
        environmentId: newEnvironmentId,
      }),
    ];
    await resourceManager.setCCloudKafkaClusters(newClusters);
    // verify the clusters were stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedClustersByEnv: CCloudKafkaClustersByEnv =
      await resourceManager.getCCloudKafkaClusters();
    assert.ok(storedClustersByEnv);
    // make sure both environments exist and the first wasn't overwritten
    assert.deepStrictEqual(storedClustersByEnv.get(newEnvironmentId), newClusters);
    assert.deepStrictEqual(storedClustersByEnv.get(TEST_CCLOUD_ENVIRONMENT.id), ccloudClusters);
  });

  it("CCLOUD: setCCloudKafkaClusters() shouldn't duplicate clusters when setting clusters that already exist", async () => {
    const resourceManager = getResourceManager();
    // set the clusters in the StorageManager before setting them again
    await resourceManager.setCCloudKafkaClusters(ccloudClusters);
    // set the clusters again
    await resourceManager.setCCloudKafkaClusters(ccloudClusters);
    // verify the clusters were not duplicated
    let storedClustersByEnv: CCloudKafkaClustersByEnv =
      await resourceManager.getCCloudKafkaClusters();
    assert.ok(storedClustersByEnv);
    assert.ok(storedClustersByEnv instanceof Map);
    assert.ok(storedClustersByEnv.has(TEST_CCLOUD_ENVIRONMENT.id));
    assert.deepStrictEqual(storedClustersByEnv.get(TEST_CCLOUD_ENVIRONMENT.id), ccloudClusters);
  });

  it("CCLOUD: getCCloudKafkaClusters() should correctly retrieve Kafka clusters", async () => {
    const resourceManager = getResourceManager();
    // preload some clusters before retrieving them
    await resourceManager.setCCloudKafkaClusters(ccloudClusters);
    // verify the clusters were stored correctly
    const envClusters: CCloudKafkaClustersByEnv = await resourceManager.getCCloudKafkaClusters();
    const retrievedClusters = envClusters.get(TEST_CCLOUD_ENVIRONMENT.id);
    assert.deepStrictEqual(retrievedClusters, ccloudClusters);
  });

  it("CCLOUD: getCCloudKafkaClusters() should return an empty array if no clusters are found", async () => {
    // verify no clusters are found
    const envClusters: CCloudKafkaClustersByEnv =
      await getResourceManager().getCCloudKafkaClusters();
    assert.deepStrictEqual(envClusters, new Map());
  });

  it("CCLOUD: getCCloudKafkaCluster() should correctly retrieve a Kafka cluster", async () => {
    // set the clusters
    await getResourceManager().setCCloudKafkaClusters(ccloudClusters);
    // verify the cluster was retrieved correctly
    const cluster: KafkaCluster | null = await getResourceManager().getCCloudKafkaCluster(
      TEST_CCLOUD_ENVIRONMENT.id,
      ccloudClusters[0].id,
    );
    assert.deepStrictEqual(cluster, ccloudClusters[0]);
  });

  it("CCLOUD: getCCloudKafkaCluster() should return null if the parent environment ID is not found", async () => {
    // set the clusters
    await getResourceManager().setCCloudKafkaClusters(ccloudClusters);
    // verify the cluster was not found because the environment ID is incorrect
    const missingCluster: KafkaCluster | null = await getResourceManager().getCCloudKafkaCluster(
      "nonexistent-env-id",
      ccloudClusters[0].id,
    );
    assert.strictEqual(missingCluster, null);
  });

  it("CCLOUD: getCCloudKafkaCluster() should return null if the cluster is not found", async () => {
    // set the clusters
    await getResourceManager().setCCloudKafkaClusters(ccloudClusters);
    // verify the cluster was not found
    const missingCluster: KafkaCluster | null = await getResourceManager().getCCloudKafkaCluster(
      TEST_CCLOUD_ENVIRONMENT.id,
      "nonexistent-cluster-id",
    );
    assert.strictEqual(missingCluster, null);
  });

  it("CCLOUD: getCCloudKafkaClustersForEnvironment should return the correct clusters for an environment", async () => {
    const rm = getResourceManager();
    // set the kafka clusters for TEST_CCLOUD_ENVIRONMENT.
    await rm.setCCloudKafkaClusters(ccloudClusters);
    // verify the clusters were retrieved correctly.
    const clusters: CCloudKafkaCluster[] = await rm.getCCloudKafkaClustersForEnvironment(
      TEST_CCLOUD_ENVIRONMENT.id,
    );
    assert.deepStrictEqual(clusters, ccloudClusters);
  });

  it("CCLOUD: getCCloudKafkaClustersForEnvironment should return an empty array if no clusters are found", async () => {
    const rm = getResourceManager();
    // verify no clusters are found for TEST_CCLOUD_ENVIRONMENT.
    const clusters: CCloudKafkaCluster[] = await rm.getCCloudKafkaClustersForEnvironment(
      TEST_CCLOUD_ENVIRONMENT.id,
    );
    assert.deepStrictEqual(clusters, []);
  });

  it("CCLOUD: deleteCCloudKafkaClusters() should correctly delete Kafka clusters", async () => {
    // set the clusters in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudKafkaClusters(ccloudClusters);
    await resourceManager.deleteCCloudKafkaClusters();
    // verify the clusters were deleted correctly
    const missingClusters = await storageManager.getWorkspaceState(
      WorkspaceStorageKeys.CCLOUD_KAFKA_CLUSTERS,
    );
    assert.deepStrictEqual(missingClusters, undefined);
  });

  it("LOCAL: setLocalKafkaClusters() should correctly store Kafka clusters", async () => {
    const resourceManager = getResourceManager();
    await resourceManager.setLocalKafkaClusters(localClusters);
    // verify the clusters were stored correctly
    const storedClusters: LocalKafkaCluster[] = await resourceManager.getLocalKafkaClusters();
    assert.ok(storedClusters);
    assert.deepStrictEqual(storedClusters, localClusters);
  });

  it("LOCAL: getLocalKafkaClusters() should correctly retrieve Kafka clusters", async () => {
    const resourceManager = getResourceManager();
    // set the clusters in the StorageManager before retrieving them
    await resourceManager.setLocalKafkaClusters(localClusters);
    // verify the clusters were retrieved correctly
    const retrievedClusters: LocalKafkaCluster[] = await resourceManager.getLocalKafkaClusters();
    assert.deepStrictEqual(retrievedClusters, localClusters);
  });

  it("LOCAL: getLocalKafkaClusters() should return an empty array if no clusters are found", async () => {
    const resourceManager = getResourceManager();
    // verify no clusters are found
    const clusters: LocalKafkaCluster[] = await resourceManager.getLocalKafkaClusters();
    assert.deepStrictEqual(clusters, []);
  });

  it("LOCAL: getLocalKafkaCluster() should correctly retrieve a Kafka cluster", async () => {
    // set the clusters
    await getResourceManager().setLocalKafkaClusters(localClusters);
    // verify the cluster was retrieved correctly
    const cluster: LocalKafkaCluster | null = await getResourceManager().getLocalKafkaCluster(
      localClusters[0].id,
    );
    assert.deepStrictEqual(cluster, localClusters[0]);
  });

  it("LOCAL: getLocalKafkaCluster() should return null if the cluster is not found", async () => {
    // set the clusters
    await getResourceManager().setLocalKafkaClusters(localClusters);
    // verify the cluster was not found
    const missingCluster: LocalKafkaCluster | null =
      await getResourceManager().getLocalKafkaCluster("nonexistent-cluster-id");
    assert.strictEqual(missingCluster, null);
  });

  it("LOCAL: deleteLocalKafkaClusters() should correctly delete Kafka clusters", async () => {
    // set the clusters in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setLocalKafkaClusters(localClusters);
    await resourceManager.deleteLocalKafkaClusters();
    // verify the clusters were deleted correctly
    const missingClusters = await storageManager.getWorkspaceState(
      WorkspaceStorageKeys.LOCAL_KAFKA_CLUSTERS,
    );
    assert.deepStrictEqual(missingClusters, undefined);
  });
});

describe("ResourceManager (CCloud) Schema Registry methods", function () {
  let storageManager: StorageManager;

  before(async () => {
    // extension needs to be activated before storage manager can be used
    storageManager = await getTestStorageManager();
  });

  beforeEach(async () => {
    // fresh slate for each test
    await storageManager.clearWorkspaceState();
  });

  afterEach(async () => {
    // clean up after each test
    await storageManager.clearWorkspaceState();
  });

  it("CCLOUD: setCCloudSchemaRegistries() should correctly store Schema Registries", async () => {
    const secondCloudEnvironment = { ...TEST_CCLOUD_ENVIRONMENT, id: "second-cloud-env-id" };
    const secondSchemaRegistry = CCloudSchemaRegistry.create({
      ...TEST_CCLOUD_SCHEMA_REGISTRY,
      environmentId: secondCloudEnvironment.id,
      id: "second-schema-registry-id",
    });
    const testSchemaRegistries: CCloudSchemaRegistry[] = [
      TEST_CCLOUD_SCHEMA_REGISTRY,
      secondSchemaRegistry,
    ];

    const rm = getResourceManager();
    await rm.setCCloudSchemaRegistries(testSchemaRegistries);
    // verify the Schema Registry was stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedSchemaRegistries: CCloudSchemaRegistryByEnv = await rm.getCCloudSchemaRegistries();
    assert.ok(storedSchemaRegistries);
    assert.ok(storedSchemaRegistries instanceof Map);
    assert.ok(storedSchemaRegistries.has(TEST_CCLOUD_ENVIRONMENT.id));
    assert.ok(storedSchemaRegistries.has(secondCloudEnvironment.id));
    assert.deepStrictEqual(
      storedSchemaRegistries.get(TEST_CCLOUD_ENVIRONMENT.id),
      TEST_CCLOUD_SCHEMA_REGISTRY,
    );
  });

  it("CCLOUD: setCCloudSchemaRegistries() setting with empty array should overwrite existing Schema Registries", async () => {
    // set the Schema Registry in the StorageManager before setting them again
    const rm = getResourceManager();
    await rm.setCCloudSchemaRegistries([TEST_CCLOUD_SCHEMA_REGISTRY]);
    // fetching now should return the stored Schema Registry
    let storedSchemaRegistries: CCloudSchemaRegistryByEnv = await rm.getCCloudSchemaRegistries();
    assert.ok(storedSchemaRegistries.get(TEST_CCLOUD_ENVIRONMENT.id));

    // set the Schema Registries again with an empty array
    await rm.setCCloudSchemaRegistries([]);
    // verify the Schema Registries were overwritten correctly
    storedSchemaRegistries = await rm.getCCloudSchemaRegistries();
    assert.deepStrictEqual(storedSchemaRegistries, new Map());
  });

  it("CCLOUD: getCCloudSchemaRegistries() should correctly retrieve Schema Registries", async () => {
    const resourceManager = getResourceManager();
    // preload a Schema Registry before retrieving it
    await resourceManager.setCCloudSchemaRegistries([TEST_CCLOUD_SCHEMA_REGISTRY]);
    // verify the Schema Registry was stored correctly
    const envSchemaRegistries: CCloudSchemaRegistryByEnv =
      await resourceManager.getCCloudSchemaRegistries();
    const retrievedSchemaRegistries = envSchemaRegistries.get(TEST_CCLOUD_ENVIRONMENT.id);
    assert.deepStrictEqual(retrievedSchemaRegistries, TEST_CCLOUD_SCHEMA_REGISTRY);
  });

  it("CCLOUD: getCCloudSchemaRegistries() should return an empty map if no Schema Registries are found", async () => {
    // verify no Schema Registries are found
    const envSchemaRegistries: CCloudSchemaRegistryByEnv =
      await getResourceManager().getCCloudSchemaRegistries();
    assert.deepStrictEqual(envSchemaRegistries, new Map());
  });

  it("CCLOUD: getCCloudSchemaRegistry() should return null if the parent environment ID is not found", async () => {
    // set the Schema Registry
    await getResourceManager().setCCloudSchemaRegistries([TEST_CCLOUD_SCHEMA_REGISTRY]);
    // verify the Schema Registry was not found because the environment ID is incorrect
    const missingSchemaRegistry: CCloudSchemaRegistry | null =
      await getResourceManager().getCCloudSchemaRegistry("nonexistent-env-id");
    assert.strictEqual(missingSchemaRegistry, null);
  });

  it("CCLOUD: getCCloudSchemaRegistryById() should correctly retrieve a Schema Registry by its ID", async () => {
    // set the Schema Registry
    await getResourceManager().setCCloudSchemaRegistries([TEST_CCLOUD_SCHEMA_REGISTRY]);
    // verify the Schema Registry was retrieved correctly
    const schemaRegistry: CCloudSchemaRegistry | null =
      await getResourceManager().getCCloudSchemaRegistryById(TEST_CCLOUD_SCHEMA_REGISTRY.id);

    assert.deepStrictEqual(schemaRegistry, TEST_CCLOUD_SCHEMA_REGISTRY);
  });

  it("CCLOUD: getCCloudSchemaRegistryById() should return null if the Schema Registry is not found", async () => {
    // set the Schema Registry
    await getResourceManager().setCCloudSchemaRegistries([TEST_CCLOUD_SCHEMA_REGISTRY]);
    // verify the Schema Registry was not found
    const missingSchemaRegistry: CCloudSchemaRegistry | null =
      await getResourceManager().getCCloudSchemaRegistryById("nonexistent-cluster-id");
    assert.strictEqual(missingSchemaRegistry, null);
  });

  it("CCLOUD: deleteCCloudSchemaRegistries() should correctly delete Schema Registries", async () => {
    // set the Schema Registry in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudSchemaRegistries([TEST_CCLOUD_SCHEMA_REGISTRY]);
    await resourceManager.deleteCCloudSchemaRegistries();
    // verify the Schema Registry was deleted correctly
    const missingClusters = await storageManager.getWorkspaceState(
      WorkspaceStorageKeys.CCLOUD_SCHEMA_REGISTRIES,
    );
    assert.deepStrictEqual(missingClusters, undefined);
  });
});

describe("ResourceManager Kafka topic methods", function () {
  let storageManager: StorageManager;
  let ccloudTopics: KafkaTopic[];
  let localTopics: KafkaTopic[];
  let otherCcloudCluster: CCloudKafkaCluster;
  let otherCcloudClusterTopics: KafkaTopic[];

  before(async () => {
    // extension needs to be activated before storage manager can be used
    storageManager = await getTestStorageManager();
    ccloudTopics = [
      KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, name: "test-ccloud-topic-1" }),
      KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, name: "test-ccloud-topic-2" }),
    ];
    localTopics = [KafkaTopic.create({ ...TEST_LOCAL_KAFKA_TOPIC, name: "test-local-topic-1" })];

    otherCcloudCluster = CCloudKafkaCluster.create({
      ...TEST_CCLOUD_KAFKA_CLUSTER,
      id: "other-cluster-id",
    });

    otherCcloudClusterTopics = [
      KafkaTopic.create({
        ...TEST_CCLOUD_KAFKA_TOPIC,
        name: "test-ccloud-topic-3",
        clusterId: otherCcloudCluster.id,
      }),
    ];
  });

  beforeEach(async () => {
    // fresh slate for each test
    await storageManager.clearWorkspaceState();
  });

  afterEach(async () => {
    // clean up after each test
    await storageManager.clearWorkspaceState();
  });

  it("getTopicsForCluster() should return undefined if no cached topics for this cluster", async () => {
    // Set up the cloud topics, local topics.
    const manager = getResourceManager();

    await manager.setCCloudKafkaClusters([TEST_CCLOUD_KAFKA_CLUSTER]);
    await manager.setLocalKafkaClusters([TEST_LOCAL_KAFKA_CLUSTER]);

    for (const cluster of [TEST_CCLOUD_KAFKA_CLUSTER, TEST_LOCAL_KAFKA_CLUSTER]) {
      const topics = await manager.getTopicsForCluster(cluster);
      assert.deepStrictEqual(topics, undefined);
    }
  });

  it("getTopicsForCluster() should return empty array of topics if empty array is set", async () => {
    const manager = getResourceManager();

    await manager.setCCloudKafkaClusters([TEST_CCLOUD_KAFKA_CLUSTER]);
    await manager.setLocalKafkaClusters([TEST_LOCAL_KAFKA_CLUSTER]);

    for (const cluster of [TEST_CCLOUD_KAFKA_CLUSTER, TEST_LOCAL_KAFKA_CLUSTER]) {
      await manager.setTopicsForCluster(cluster, []);
      const topics = await manager.getTopicsForCluster(cluster);
      assert.deepStrictEqual(topics, []);
    }
  });

  it("getTopicsForCluster() should return the correct cloud or local topics accordingly", async () => {
    // Set up the cloud topics, local topics.
    const manager = getResourceManager();

    await manager.setCCloudKafkaClusters([TEST_CCLOUD_KAFKA_CLUSTER, otherCcloudCluster]);
    await manager.setLocalKafkaClusters([TEST_LOCAL_KAFKA_CLUSTER]);

    // Learn first batch of topics from main cloud cluster
    await manager.setTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER, ccloudTopics);

    const ccloudTopicsForMainCluster = await manager.getTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER);
    assert.deepEqual(
      ccloudTopicsForMainCluster,
      ccloudTopics,
      "Expected cloud topics to be returned for the cloud cluster",
    );

    // Now learn another batch of topics for a different cloud cluster
    await manager.setTopicsForCluster(otherCcloudCluster, otherCcloudClusterTopics);

    const ccloudTopicsForOtherCluster = await manager.getTopicsForCluster(otherCcloudCluster);
    assert.deepEqual(
      ccloudTopicsForOtherCluster,
      otherCcloudClusterTopics,
      "Expected cloud topics to be returned for the other cloud cluster",
    );

    // and meanwhile the main cloud cluster should still have its topics
    const ccloudTopicsForMainClusterAfter =
      await manager.getTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER);
    assert.deepEqual(
      ccloudTopicsForMainClusterAfter,
      ccloudTopics,
      "Expected cloud topics to still be returned for the main cloud cluster",
    );

    //Populate non-empty array for local cluster, should get it back.
    await manager.setTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER, localTopics);

    const localTopicsForCluster = await manager.getTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER);
    assert.deepEqual(
      localTopicsForCluster,
      localTopics,
      "Expected local topics to be returned for the local cluster",
    );

    // And meanwhile the cloud clusters should still have their topics. No
    // No cross-contamination.
    const clustersAndExpectedTopics: [KafkaCluster, KafkaTopic[]][] = [
      [TEST_CCLOUD_KAFKA_CLUSTER, ccloudTopics],
      [otherCcloudCluster, otherCcloudClusterTopics],
    ];
    for (const [cluster, topics] of clustersAndExpectedTopics) {
      const topicsForCluster = await manager.getTopicsForCluster(cluster);
      assert.deepEqual(
        topicsForCluster,
        topics,
        "Expected right topics to still be returned for each cloud cluster",
      );
    }
  });

  it("getClusterForTopic() should return the correct cloud or local cluster accordingly", async () => {
    // (Is really a cluster-related test, not topic, but this suite has topic sample data)

    // Set up the cloud cluster and topics, local topics.
    const manager = getResourceManager();

    await manager.setCCloudKafkaClusters([TEST_CCLOUD_KAFKA_CLUSTER]);
    await manager.setTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER, ccloudTopics);

    await manager.setLocalKafkaClusters([TEST_LOCAL_KAFKA_CLUSTER]);
    await manager.setTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER, localTopics);

    const ccloudTopic = ccloudTopics[0];
    const ccloudCluster = await manager.getClusterForTopic(ccloudTopic);
    assert.equal(ccloudCluster != null, true, "Expected a cloud cluster to be returned");
    assert.equal(
      ccloudCluster!.id,
      ccloudTopic.clusterId,
      "Expected the cloud cluster to be the same as the cloud topic's cluster",
    );

    const localTopic = localTopics[0];
    const localCluster = await manager.getClusterForTopic(localTopic);
    assert.equal(localCluster != null, true, "Expected a local cluster to be returned");
    assert.equal(
      localCluster!.id,
      localTopic.clusterId,
      "Expected the local cluster to be the same as the local topic's cluster",
    );
  });

  it("deleteCCloudTopics() should correctly delete only ccloud Kafka topics", async () => {
    // set the topics in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER, ccloudTopics);
    await resourceManager.setTopicsForCluster(otherCcloudCluster, otherCcloudClusterTopics);
    await resourceManager.setTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER, localTopics);

    // only the cloud topics should be deleted
    await resourceManager.deleteCCloudTopics();

    // verify the ccloud topics were deleted correctly.
    for (const cluster of [TEST_CCLOUD_KAFKA_CLUSTER, otherCcloudCluster]) {
      const shouldBeUndefined = await resourceManager.getTopicsForCluster(cluster);
      assert.deepStrictEqual(shouldBeUndefined, undefined);
    }

    // verify the local topics were not deleted.
    const localTopicsAfter = await resourceManager.getTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER);
    assert.deepStrictEqual(localTopicsAfter, localTopics);
  });

  it("deleteLocalTopics() should correctly delete only local Kafka topics", async () => {
    // set the topics in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER, ccloudTopics);
    await resourceManager.setTopicsForCluster(otherCcloudCluster, otherCcloudClusterTopics);
    await resourceManager.setTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER, localTopics);

    // only the local topics should be deleted
    await resourceManager.deleteLocalTopics();

    // verify the local topics were deleted correctly.
    const localTopicsAfter = await resourceManager.getTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER);
    assert.deepStrictEqual(localTopicsAfter, undefined);

    // verify the cloud topics were not deleted.
    for (const cluster of [TEST_CCLOUD_KAFKA_CLUSTER, otherCcloudCluster]) {
      const shouldBeUndefined = await resourceManager.getTopicsForCluster(cluster);
      assert.ok(shouldBeUndefined);
    }
  });

  it("topicKeyForCluster() tests", () => {
    const manager = getResourceManager();

    assert.equal(
      manager.topicKeyForCluster(TEST_CCLOUD_KAFKA_CLUSTER),
      WorkspaceStorageKeys.CCLOUD_KAFKA_TOPICS,
      "Expected cloud cluster to map to StateKafkaTopics.CCLOUD",
    );

    assert.equal(
      manager.topicKeyForCluster(TEST_LOCAL_KAFKA_CLUSTER),
      WorkspaceStorageKeys.LOCAL_KAFKA_TOPICS,
      "Expected local cluster to map to StateKafkaTopics.LOCAL",
    );
  });
});

describe("ResourceManager schema tests", function () {
  let storageManager: StorageManager;
  let ccloudSchemas: Schema[];

  before(async () => {
    // extension needs to be activated before storage manager can be used
    storageManager = await getTestStorageManager();
    ccloudSchemas = [
      Schema.create({
        ...TEST_CCLOUD_SCHEMA,
        id: "100001",
        subject: "test-ccloud-topic-xyz-value",
        version: 1,
      }),
      Schema.create({
        ...TEST_CCLOUD_SCHEMA,
        id: "100055",
        subject: "test-ccloud-topic-xyz-value",
        version: 2,
      }),
      Schema.create({
        ...TEST_CCLOUD_SCHEMA,
        id: "100056",
        subject: "test-ccloud-topic-abc-value",
        version: 1,
      }),
    ];
  });

  beforeEach(async () => {
    // fresh slate for each test
    await storageManager.clearWorkspaceState();
  });

  afterEach(async () => {
    // clean up after each test
    await storageManager.clearWorkspaceState();
  });

  it("CCLOUD: setSchemasForRegistry() should correctly store schemas", async () => {
    const rm = getResourceManager();
    await rm.setSchemasForRegistry(TEST_CCLOUD_SCHEMA_REGISTRY.id, ccloudSchemas);

    // fetch back from resource manager
    const storedSchemas = await rm.getSchemasForRegistry(TEST_CCLOUD_SCHEMA_REGISTRY.id);
    assert.ok(storedSchemas);
    assert.deepStrictEqual(storedSchemas, ccloudSchemas);
  });

  it("CCLOUD: setSchemasForRegistry() should complain if not all schemas share expected registry id", async () => {
    const rm = getResourceManager();
    await assert.rejects(async () => {
      await rm.setSchemasForRegistry("wrong-registry-id", ccloudSchemas);
    }, /Schema registry ID mismatch in schemas/);
  });

  it("CCLOUD: setSchemasForRegistry() can store empty array of schemas", async () => {
    const rm = getResourceManager();
    await rm.setSchemasForRegistry(TEST_CCLOUD_SCHEMA_REGISTRY.id, []);
    const storedSchemas = await rm.getSchemasForRegistry(TEST_CCLOUD_SCHEMA_REGISTRY.id);
    assert.deepStrictEqual(storedSchemas, []);
  });
});

describe("ResourceManager direct connection methods", function () {
  let rm: ResourceManager;

  before(async () => {
    // extension needs to be activated before storage manager(s) can be used
    await getTestExtensionContext();
  });

  beforeEach(async () => {
    rm = getResourceManager();
  });

  afterEach(async () => {
    // clean up after each test
    await rm.deleteDirectConnections();
  });

  it("addDirectConnection() should correctly store a direct connection spec", async () => {
    // preload one connection
    const spec = TEST_DIRECT_CONNECTION_FORM_SPEC;
    await rm.addDirectConnection(spec);

    // make sure it exists
    const storedSpecs: DirectConnectionsById = await rm.getDirectConnections();
    assert.ok(storedSpecs);
    assert.deepStrictEqual(storedSpecs, new Map([[TEST_DIRECT_CONNECTION_ID, spec]]));
    assert.deepStrictEqual(storedSpecs.get(TEST_DIRECT_CONNECTION_ID), spec);

    // and that it also exists when fetched directly
    const storedSpec: CustomConnectionSpec | null =
      await rm.getDirectConnection(TEST_DIRECT_CONNECTION_ID);
    assert.ok(storedSpec);
    assert.deepStrictEqual(storedSpec, spec);
  });

  it("getDirectConnections() should return an empty map if no direct connections are found", async () => {
    // no preloading

    const storedSpecs: DirectConnectionsById = await rm.getDirectConnections();
    assert.deepStrictEqual(storedSpecs, new Map());
  });

  it("getDirectConnection() should return null if the connection is not found", async () => {
    // no preloading

    const storedSpec: ConnectionSpec | null = await rm.getDirectConnection(
      "nonexistent-id" as ConnectionId,
    );
    assert.strictEqual(storedSpec, null);
  });

  it("deleteDirectConnection() should correctly delete a direct connection and not touch existing connections", async () => {
    // preload two connections
    const connId1: ConnectionId = TEST_DIRECT_CONNECTION_ID;
    const connId2: ConnectionId = "other-id" as ConnectionId;
    const specs: CustomConnectionSpec[] = [
      TEST_DIRECT_CONNECTION_FORM_SPEC,
      { ...TEST_DIRECT_CONNECTION_FORM_SPEC, id: connId2 },
    ];
    await Promise.all(specs.map((spec) => rm.addDirectConnection(spec)));

    // make sure they exist
    let storedSpecs: DirectConnectionsById = await rm.getDirectConnections();
    assert.ok(storedSpecs);
    assert.equal(storedSpecs.size, specs.length);
    assert.deepStrictEqual(storedSpecs.get(connId1), specs[0]);
    assert.deepStrictEqual(storedSpecs.get(connId2), specs[1]);

    // delete one
    await rm.deleteDirectConnection(connId1);

    // make sure it's gone but the other remains
    storedSpecs = await rm.getDirectConnections();
    assert.deepStrictEqual(storedSpecs.get(connId1), undefined);
    assert.deepStrictEqual(storedSpecs.get(connId2), specs[1]);
  });

  it("deleteDirectConnections() should delete all direct connections", async () => {
    // preload multiple connections
    const specs: CustomConnectionSpec[] = [
      TEST_DIRECT_CONNECTION_FORM_SPEC,
      { ...TEST_DIRECT_CONNECTION_FORM_SPEC, id: "other-id" as ConnectionId },
      { ...TEST_DIRECT_CONNECTION_FORM_SPEC, id: "another-id" as ConnectionId },
    ];
    await Promise.all(specs.map((spec) => rm.addDirectConnection(spec)));

    // make sure they exist
    let storedSpecs: DirectConnectionsById = await rm.getDirectConnections();
    assert.ok(storedSpecs);
    assert.equal(storedSpecs.size, specs.length);

    // delete all connections
    await rm.deleteDirectConnections();

    // make sure they're gone
    storedSpecs = await rm.getDirectConnections();
    assert.deepStrictEqual(storedSpecs, new Map());
  });
});

describe("ResourceManager general utility methods", function () {
  let storageManager: StorageManager;

  let ccloudTopics: KafkaTopic[];
  let localTopics: KafkaTopic[];

  let ccloudSchemas: Schema[];

  before(async () => {
    // extension needs to be activated before storage manager can be used
    storageManager = await getTestStorageManager();

    ccloudTopics = [
      KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, name: "test-ccloud-topic-1" }),
      KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, name: "test-ccloud-topic-2" }),
    ];
    localTopics = [KafkaTopic.create({ ...TEST_LOCAL_KAFKA_TOPIC, name: "test-local-topic-1" })];

    ccloudSchemas = [
      Schema.create({
        ...TEST_CCLOUD_SCHEMA,
        id: "100001",
        subject: "test-ccloud-topic-xyz-value",
        version: 1,
      }),
      Schema.create({
        ...TEST_CCLOUD_SCHEMA,
        id: "100055",
        subject: "test-ccloud-topic-xyz-value",
        version: 2,
      }),
      Schema.create({
        ...TEST_CCLOUD_SCHEMA,
        id: "100056",
        subject: "test-ccloud-topic-abc-value",
        version: 1,
      }),
    ];
  });

  beforeEach(async () => {
    // fresh slate for each test
    await storageManager.clearWorkspaceState();
  });

  afterEach(async () => {
    // clean up after each test
    await storageManager.clearWorkspaceState();
  });

  it("CCLOUD: deleteCCloudResources() should correctly delete all CCloud resources", async () => {
    // set the CCloud resources before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudKafkaClusters([TEST_CCLOUD_KAFKA_CLUSTER]);
    await resourceManager.setCCloudSchemaRegistries([TEST_CCLOUD_SCHEMA_REGISTRY]);
    await resourceManager.setTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER, ccloudTopics);
    await resourceManager.setSchemasForRegistry(TEST_CCLOUD_SCHEMA_REGISTRY.id, ccloudSchemas);
    // also set some local resources to make sure they aren't deleted
    await resourceManager.setLocalKafkaClusters([TEST_LOCAL_KAFKA_CLUSTER]);
    await resourceManager.setTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER, localTopics);

    await resourceManager.deleteCCloudResources();

    // verify the resources were deleted correctly
    const missingClusters = await resourceManager.getCCloudKafkaClusters();
    assert.deepStrictEqual(missingClusters, new Map());
    const missingSchemaRegistries = await resourceManager.getCCloudSchemaRegistries();
    assert.deepStrictEqual(missingSchemaRegistries, new Map());
    const missingTopics = await resourceManager.getTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER);
    assert.deepStrictEqual(missingTopics, undefined);
    const missingSchemas = await resourceManager.getSchemasForRegistry(
      TEST_CCLOUD_SCHEMA_REGISTRY.id,
    );
    assert.deepStrictEqual(missingSchemas, undefined);

    // local resources should still be there
    const existinglocalClusters: LocalKafkaCluster[] =
      await resourceManager.getLocalKafkaClusters();
    assert.ok(existinglocalClusters);
    assert.equal(existinglocalClusters.length, 1);

    const existingLocalTopics = await resourceManager.getTopicsForCluster(TEST_LOCAL_KAFKA_CLUSTER);
    assert.ok(existingLocalTopics);
    assert.equal(existingLocalTopics.length, 1);
  });
});

describe("CustomConnectionSpec object conversion", () => {
  it("CustomConnectionSpecFromJSON should correctly convert objects to typed CustomConnectionSpecs", () => {
    const plainObj = {
      id: TEST_DIRECT_CONNECTION_ID,
      name: "Test Connection",
      type: "DIRECT",
      formConnectionType: "Apache Kafka",
      kafka_cluster: {
        bootstrap_servers: "localhost:9092",
      },
    };

    const spec = CustomConnectionSpecFromJSON(plainObj);

    assert.ok(spec);
    assert.strictEqual(spec.id, TEST_DIRECT_CONNECTION_ID);
    // TODO: figure out how to test for branded string types?
    assert.strictEqual(spec.name, "Test Connection");
    assert.strictEqual(spec.type, "DIRECT");
    assert.strictEqual(spec.formConnectionType, "Apache Kafka");
    // ensure all KafkaClusterConfig fields are present
    assert.deepStrictEqual(
      spec.kafka_cluster,
      KafkaClusterConfigFromJSON({
        bootstrap_servers: "localhost:9092",
      }),
    );
  });

  it("CustomConnectionSpecFromJSON should handle null input", () => {
    const spec = CustomConnectionSpecFromJSON(null);

    assert.strictEqual(spec, null);
  });

  it("CustomConnectionSpecToJSON should correctly convert a typed CustomConnectionSpec to a plain object", () => {
    // don't use existing test data since it will include all fields
    const spec: object = {
      id: TEST_DIRECT_CONNECTION_ID,
      name: "Test Connection",
      type: "DIRECT",
      formConnectionType: "Apache Kafka",
      kafka_cluster: {
        bootstrap_servers: "localhost:9092",
      },
    };

    const plainObj = CustomConnectionSpecToJSON(spec as CustomConnectionSpec);
    assert.ok(plainObj);
    assert.strictEqual(plainObj.id, TEST_DIRECT_CONNECTION_ID);
    assert.strictEqual(plainObj.name, "Test Connection");
    assert.strictEqual(plainObj.type, "DIRECT");
    assert.strictEqual(plainObj.formConnectionType, "Apache Kafka");
    assert.deepStrictEqual(
      plainObj.kafka_cluster,
      KafkaClusterConfigToJSON({
        bootstrap_servers: "localhost:9092",
      }),
    );
  });

  it("CustomConnectionSpec conversion should be reversible", () => {
    // use the existing test spec which has all fields
    const specObj = CustomConnectionSpecToJSON(TEST_DIRECT_CONNECTION_FORM_SPEC);
    const typedSpec = CustomConnectionSpecFromJSON(specObj);

    assert.deepStrictEqual(typedSpec, TEST_DIRECT_CONNECTION_FORM_SPEC);
  });
});

describe("ResourceManager utility functions", function () {
  it("mapToString() should correctly convert a Map to a string", () => {
    const testMap = new Map([
      ["key1", "value1"],
      ["key2", "value2"],
    ]);

    const result = mapToString(testMap);

    assert.strictEqual(result, `{"key1":"value1","key2":"value2"}`);
  });

  it("stringToMap() should correctly convert a string to a Map", () => {
    const testString = `{"key1":"value1","key2":"value2"}`;

    const result = stringToMap(testString);

    assert.ok(result);
    assert.ok(result instanceof Map);
    assert.strictEqual(result.size, 2);
    assert.strictEqual(result.get("key1"), "value1");
    assert.strictEqual(result.get("key2"), "value2");
  });
});
