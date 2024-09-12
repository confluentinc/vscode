import * as assert from "assert";
import { StorageManager } from ".";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_TOPIC,
  TEST_SCHEMA,
  TEST_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { getTestStorageManager } from "../../tests/unit/testUtils";
import {
  StateEnvironments,
  StateKafkaClusters,
  StateKafkaTopics,
  StateSchemaRegistry,
  StateSchemas,
} from "../constants";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import { Schema } from "../models/schema";
import { SchemaRegistryCluster } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import {
  CCloudKafkaClustersByEnv,
  CCloudSchemaBySchemaRegistryCluster,
  CCloudSchemaRegistryByEnv,
  TopicsByKafkaCluster,
  getResourceManager,
} from "./resourceManager";

describe("ResourceManager (CCloud) environment methods", function () {
  let storageManager: StorageManager;
  let environments: CCloudEnvironment[];

  before(async () => {
    // extension needs to be activated before storage manager can be used
    storageManager = await getTestStorageManager();
    environments = [
      CCloudEnvironment.create({ ...TEST_CCLOUD_ENVIRONMENT, id: "test-env-id-1" }),
      CCloudEnvironment.create({ ...TEST_CCLOUD_ENVIRONMENT, id: "test-env-id-2" }),
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
    await getResourceManager().setCCloudEnvironments(environments);
    // verify the environments were stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedEnvironments: CCloudEnvironment[] | undefined =
      await storageManager.getWorkspaceState(StateEnvironments.CCLOUD);
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
    const missingEnvironments = await storageManager.getWorkspaceState(StateEnvironments.CCLOUD);
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
    await getResourceManager().setCCloudKafkaClusters(ccloudClusters);
    // verify the clusters were stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedClustersByEnv: CCloudKafkaClustersByEnv | undefined =
      await storageManager.getWorkspaceState(StateKafkaClusters.CCLOUD);
    assert.ok(storedClustersByEnv);
    assert.ok(storedClustersByEnv instanceof Map);
    assert.ok(storedClustersByEnv.has(TEST_CCLOUD_ENVIRONMENT.id));
    assert.deepStrictEqual(storedClustersByEnv.get(TEST_CCLOUD_ENVIRONMENT.id), ccloudClusters);
  });

  it("CCLOUD: setCCloudKafkaClusters() should add new environment keys if they don't exist", async () => {
    // set the first batch of clusters from the first environment
    await getResourceManager().setCCloudKafkaClusters(ccloudClusters);
    // create and set the second batch of clusters for the new environment
    const newEnvironmentId = "new-environment-id";
    const newClusters: CCloudKafkaCluster[] = [
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_CCLOUD_KAFKA_CLUSTER, id: "new-cluster-id-1", environmentId: newEnvironmentId },
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_CCLOUD_KAFKA_CLUSTER, id: "new-cluster-id-2", environmentId: newEnvironmentId },
    ];
    await getResourceManager().setCCloudKafkaClusters(newClusters);
    // verify the clusters were stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedClustersByEnv: CCloudKafkaClustersByEnv | undefined =
      await storageManager.getWorkspaceState(StateKafkaClusters.CCLOUD);
    assert.ok(storedClustersByEnv);
    // make sure both environments exist and the first wasn't overwritten
    assert.deepStrictEqual(storedClustersByEnv.get(newEnvironmentId), newClusters);
    assert.deepStrictEqual(storedClustersByEnv.get(TEST_CCLOUD_ENVIRONMENT.id), ccloudClusters);
  });

  it("CCLOUD: setCCloudKafkaClusters() shouldn't duplicate clusters when setting clusters that already exist", async () => {
    // set the clusters in the StorageManager before setting them again
    await getResourceManager().setCCloudKafkaClusters(ccloudClusters);
    // set the clusters again
    await getResourceManager().setCCloudKafkaClusters(ccloudClusters);
    // verify the clusters were not duplicated
    let storedClustersByEnv: CCloudKafkaClustersByEnv | undefined =
      await storageManager.getWorkspaceState(StateKafkaClusters.CCLOUD);
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

  it("CCLOUD: deleteCCloudKafkaClusters() should correctly delete Kafka clusters", async () => {
    // set the clusters in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudKafkaClusters(ccloudClusters);
    await resourceManager.deleteCCloudKafkaClusters();
    // verify the clusters were deleted correctly
    const missingClusters = await storageManager.getWorkspaceState(StateKafkaClusters.CCLOUD);
    assert.deepStrictEqual(missingClusters, undefined);
  });

  it("LOCAL: setLocalKafkaClusters() should correctly store Kafka clusters", async () => {
    await getResourceManager().setLocalKafkaClusters(localClusters);
    // verify the clusters were stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedClusters: LocalKafkaCluster[] | undefined = await storageManager.getWorkspaceState(
      StateKafkaClusters.LOCAL,
    );
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
    const missingClusters = await storageManager.getWorkspaceState(StateKafkaClusters.LOCAL);
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

  it("CCLOUD: setCCloudSchemaRegistryCluster() should correctly store Schema Registry clusters", async () => {
    await getResourceManager().setCCloudSchemaRegistryCluster(TEST_SCHEMA_REGISTRY);
    // verify the cluster was stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedClusters: CCloudSchemaRegistryByEnv | undefined =
      await storageManager.getWorkspaceState(StateSchemaRegistry.CCLOUD);
    assert.ok(storedClusters);
    assert.ok(storedClusters instanceof Map);
    assert.ok(storedClusters.has(TEST_CCLOUD_ENVIRONMENT.id));
    assert.deepStrictEqual(storedClusters.get(TEST_CCLOUD_ENVIRONMENT.id), TEST_SCHEMA_REGISTRY);
  });

  it("CCLOUD: setCCloudSchemaRegistryCluster() should add new environment keys if they don't exist", async () => {
    // set the first cluster from the first environment
    await getResourceManager().setCCloudSchemaRegistryCluster(TEST_SCHEMA_REGISTRY);
    // create and set the second cluster for the new environment
    const newEnvironmentId = "new-environment-id";
    const newCluster: SchemaRegistryCluster = {
      ...TEST_SCHEMA_REGISTRY,
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      id: "new-sr-cluster-id-1",
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      environmentId: newEnvironmentId,
    };
    await getResourceManager().setCCloudSchemaRegistryCluster(newCluster);
    // verify the clusters were stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedClusters: CCloudSchemaRegistryByEnv | undefined =
      await storageManager.getWorkspaceState(StateSchemaRegistry.CCLOUD);
    assert.ok(storedClusters);
    // make sure both environments exist and the first wasn't overwritten
    assert.deepStrictEqual(storedClusters.get(newEnvironmentId), newCluster);
    assert.deepStrictEqual(storedClusters.get(TEST_CCLOUD_ENVIRONMENT.id), TEST_SCHEMA_REGISTRY);
  });

  it("CCLOUD: getCCloudSchemaRegistryClusters() should correctly retrieve Schema Registry clusters", async () => {
    const resourceManager = getResourceManager();
    // preload a cluster before retrieving it
    await resourceManager.setCCloudSchemaRegistryCluster(TEST_SCHEMA_REGISTRY);
    // verify the clusters were stored correctly
    const envClusters: CCloudSchemaRegistryByEnv =
      await resourceManager.getCCloudSchemaRegistryClusters();
    const retrievedClusters = envClusters.get(TEST_CCLOUD_ENVIRONMENT.id);
    assert.deepStrictEqual(retrievedClusters, TEST_SCHEMA_REGISTRY);
  });

  it("CCLOUD: getCCloudSchemaRegistryClusters() should return an empty map if no clusters are found", async () => {
    // verify no clusters are found
    const envClusters: CCloudSchemaRegistryByEnv =
      await getResourceManager().getCCloudSchemaRegistryClusters();
    assert.deepStrictEqual(envClusters, new Map());
  });

  it("CCLOUD: getCCloudSchemaRegistryCluster() should correctly retrieve a Schema Registry cluster", async () => {
    // set the cluster
    await getResourceManager().setCCloudSchemaRegistryCluster(TEST_SCHEMA_REGISTRY);
    // verify the cluster was retrieved correctly
    const cluster: SchemaRegistryCluster | null =
      await getResourceManager().getCCloudSchemaRegistryCluster(TEST_CCLOUD_ENVIRONMENT.id);
    assert.deepStrictEqual(cluster, TEST_SCHEMA_REGISTRY);
  });

  it("CCLOUD: getCCloudSchemaRegistryCluster() should return null if the parent environment ID is not found", async () => {
    // set the clusters
    await getResourceManager().setCCloudSchemaRegistryCluster(TEST_SCHEMA_REGISTRY);
    // verify the cluster was not found because the environment ID is incorrect
    const missingCluster: SchemaRegistryCluster | null =
      await getResourceManager().getCCloudSchemaRegistryCluster("nonexistent-env-id");
    assert.strictEqual(missingCluster, null);
  });

  it("CCLOUD: deleteCCloudSchemaRegistryClusters() should correctly delete Schema Registry clusters", async () => {
    // set the clusters in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudSchemaRegistryCluster(TEST_SCHEMA_REGISTRY);
    await resourceManager.deleteCCloudSchemaRegistryClusters();
    // verify the clusters were deleted correctly
    const missingClusters = await storageManager.getWorkspaceState(StateSchemaRegistry.CCLOUD);
    assert.deepStrictEqual(missingClusters, undefined);
  });
});

describe("ResourceManager Kafka topic methods", function () {
  let storageManager: StorageManager;
  let ccloudTopics: KafkaTopic[];
  let localTopics: KafkaTopic[];

  before(async () => {
    // extension needs to be activated before storage manager can be used
    storageManager = await getTestStorageManager();
    ccloudTopics = [
      KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, name: "test-ccloud-topic-1" }),
      KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, name: "test-ccloud-topic-2" }),
    ];
    localTopics = [KafkaTopic.create({ ...TEST_LOCAL_KAFKA_TOPIC, name: "test-local-topic-1" })];
  });

  beforeEach(async () => {
    // fresh slate for each test
    await storageManager.clearWorkspaceState();
  });

  afterEach(async () => {
    // clean up after each test
    await storageManager.clearWorkspaceState();
  });

  it("getClusterForTopic() should return the correct cloud or local cluster accordingly", async () => {
    // Set up the cloud cluster and topics, local topics.
    const manager = getResourceManager();

    await manager.setCCloudKafkaClusters([TEST_CCLOUD_KAFKA_CLUSTER]);
    await manager.setCCloudTopics(ccloudTopics);

    await manager.setLocalKafkaClusters([TEST_LOCAL_KAFKA_CLUSTER]);
    await manager.setLocalTopics(localTopics);

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

  it("CCLOUD: setCCloudTopics() should correctly store Kafka topics", async () => {
    await getResourceManager().setCCloudTopics(ccloudTopics);
    // verify the topics were stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedTopicsByCluster: Map<string, KafkaTopic[]> | undefined =
      await storageManager.getWorkspaceState(StateKafkaTopics.CCLOUD);
    assert.ok(storedTopicsByCluster);
    assert.ok(storedTopicsByCluster instanceof Map);
    assert.ok(storedTopicsByCluster.has(ccloudTopics[0].clusterId));
    assert.deepStrictEqual(storedTopicsByCluster.get(ccloudTopics[0].clusterId), ccloudTopics);
  });

  it("CCLOUD: setCCloudTopics() should add new cluster keys if they don't exist", async () => {
    // set the first batch of topics from the first cluster
    await getResourceManager().setCCloudTopics(ccloudTopics);
    // create and set the second batch of topics for the new cluster
    const newClusterId = "new-cluster-id";
    const newTopics: KafkaTopic[] = [
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_CCLOUD_KAFKA_TOPIC, name: "new-topic-1", clusterId: newClusterId },
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_CCLOUD_KAFKA_TOPIC, name: "new-topic-2", clusterId: newClusterId },
    ];
    await getResourceManager().setCCloudTopics(newTopics);
    // verify the topics were stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedTopicsByCluster: TopicsByKafkaCluster | undefined =
      await storageManager.getWorkspaceState(StateKafkaTopics.CCLOUD);
    assert.ok(storedTopicsByCluster);
    // make sure both clusters exist and the first wasn't overwritten
    assert.deepStrictEqual(storedTopicsByCluster.get(newClusterId), newTopics);
    assert.deepStrictEqual(storedTopicsByCluster.get(ccloudTopics[0].clusterId), ccloudTopics);
  });

  it("CCLOUD: setCCloudTopics() shouldn't duplicate topics when setting topics that already exist", async () => {
    // set the topics in the StorageManager before setting them again
    await getResourceManager().setCCloudTopics(ccloudTopics);
    // set the topics again
    await getResourceManager().setCCloudTopics(ccloudTopics);
    // verify the topics were not duplicated
    let storedTopicsByCluster: TopicsByKafkaCluster | undefined =
      await storageManager.getWorkspaceState(StateKafkaTopics.CCLOUD);
    assert.ok(storedTopicsByCluster);
    assert.ok(storedTopicsByCluster instanceof Map);
    assert.ok(storedTopicsByCluster.has(ccloudTopics[0].clusterId));
    assert.deepStrictEqual(storedTopicsByCluster.get(ccloudTopics[0].clusterId), ccloudTopics);
  });

  it("CCLOUD: getCCloudTopics() should correctly retrieve Kafka topics", async () => {
    const resourceManager = getResourceManager();
    // preload some topics before retrieving them
    await resourceManager.setCCloudTopics(ccloudTopics);
    // verify the topics were stored correctly
    const topicsByCluster: TopicsByKafkaCluster = await resourceManager.getCCloudTopics();
    const retrievedTopics = topicsByCluster.get(ccloudTopics[0].clusterId);
    assert.deepStrictEqual(retrievedTopics, ccloudTopics);
  });

  it("CCLOUD: getCCloudTopic() should return an empty array if no topics are found", async () => {
    // verify no topics are found
    const topicsByCluster: TopicsByKafkaCluster = await getResourceManager().getCCloudTopics();
    assert.deepStrictEqual(topicsByCluster, new Map());
  });

  it("CCLOUD: getCCloudTopic() should correctly retrieve a Kafka topic", async () => {
    // set the topics
    await getResourceManager().setCCloudTopics(ccloudTopics);
    // verify the topic was retrieved correctly
    const topic: KafkaTopic | null = await getResourceManager().getCCloudTopic(
      ccloudTopics[0].clusterId,
      ccloudTopics[0].name,
    );
    assert.deepStrictEqual(topic, ccloudTopics[0]);
  });

  it("CCLOUD: getCCloudTopic() should return null if the parent cluster ID is not found", async () => {
    // set the topics
    await getResourceManager().setCCloudTopics(ccloudTopics);
    // verify the topic was not found because the cluster ID is incorrect
    const missingTopic: KafkaTopic | null = await getResourceManager().getCCloudTopic(
      "nonexistent-cluster-id",
      ccloudTopics[0].name,
    );
    assert.strictEqual(missingTopic, null);
  });

  it("CCLOUD: getCCloudTopic() should return null if the topic is not found", async () => {
    // set the topics
    await getResourceManager().setCCloudTopics(ccloudTopics);
    // verify the topic was not found
    const missingTopic: KafkaTopic | null = await getResourceManager().getCCloudTopic(
      ccloudTopics[0].clusterId,
      "nonexistent-topic-name",
    );
    assert.strictEqual(missingTopic, null);
  });

  it("CCLOUD: deleteCCloudTopics() should correctly delete Kafka topics", async () => {
    // set the topics in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudTopics(ccloudTopics);
    await resourceManager.deleteCCloudTopics();
    // verify the topics were deleted correctly
    const missingTopics = await storageManager.getWorkspaceState(StateKafkaTopics.CCLOUD);
    assert.deepStrictEqual(missingTopics, undefined);
  });

  it("CCLOUD: deleteCCloudTopics() should delete all topics for a specific cluster", async () => {
    // set the topics in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudTopics(ccloudTopics);

    // add some more topics for a different cluster
    const newClusterId = "new-cluster-id";
    const newTopics: KafkaTopic[] = [
      KafkaTopic.create({
        ...TEST_CCLOUD_KAFKA_TOPIC,
        name: "new-topic-1",
        clusterId: newClusterId,
      }),
      KafkaTopic.create({
        ...TEST_CCLOUD_KAFKA_TOPIC,
        name: "new-topic-2",
        clusterId: newClusterId,
      }),
    ];
    await resourceManager.setCCloudTopics(newTopics);

    // delete the first batch
    await resourceManager.deleteCCloudTopics(ccloudTopics[0].clusterId);

    // verify the topics were deleted correctly
    const missingTopics = await storageManager.getWorkspaceState(StateKafkaTopics.CCLOUD);
    assert.ok(missingTopics instanceof Map);
    assert.strictEqual(missingTopics.get(ccloudTopics[0].clusterId), undefined);

    // ...but the second batch of topics should still be there
    assert.ok(missingTopics.has(newClusterId));
    assert.deepStrictEqual(missingTopics.get(newClusterId), newTopics);
  });

  it("LOCAL: setLocalTopics() should correctly store Kafka topics", async () => {
    await getResourceManager().setLocalTopics(localTopics);
    // verify the topics were stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedTopics: KafkaTopic[] | undefined = await storageManager.getWorkspaceState(
      StateKafkaTopics.LOCAL,
    );
    assert.ok(storedTopics);
    assert.ok(storedTopics instanceof Map);
    assert.ok(storedTopics.has(localTopics[0].clusterId));
    assert.deepStrictEqual(storedTopics.get(localTopics[0].clusterId), localTopics);
  });

  it("LOCAL: setLocalTopics() should add new cluster keys if they don't exist", async () => {
    // set the first batch of topics from the first cluster
    await getResourceManager().setLocalTopics(localTopics);
    // create and set the second batch of topics for the new cluster
    const newClusterId = "new-cluster-id";
    const newTopics: KafkaTopic[] = [
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_LOCAL_KAFKA_TOPIC, name: "new-topic-1", clusterId: newClusterId },
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_LOCAL_KAFKA_TOPIC, name: "new-topic-2", clusterId: newClusterId },
    ];
    await getResourceManager().setLocalTopics(newTopics);
    // verify the topics were stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedTopics: TopicsByKafkaCluster | undefined = await storageManager.getWorkspaceState(
      StateKafkaTopics.LOCAL,
    );
    assert.ok(storedTopics);
    // make sure both clusters exist and the first wasn't overwritten
    assert.deepStrictEqual(storedTopics.get(newClusterId), newTopics);
    assert.deepStrictEqual(storedTopics.get(localTopics[0].clusterId), localTopics);
  });

  it("LOCAL: setLocalTopics() shouldn't duplicate topics when setting topics that already exist", async () => {
    // set the topics in the StorageManager before setting them again
    await getResourceManager().setLocalTopics(localTopics);
    // set the topics again
    await getResourceManager().setLocalTopics(localTopics);
    // verify the topics were not duplicated
    let storedTopics: TopicsByKafkaCluster | undefined = await storageManager.getWorkspaceState(
      StateKafkaTopics.LOCAL,
    );
    assert.ok(storedTopics);
    assert.ok(storedTopics instanceof Map);
    assert.ok(storedTopics.has(localTopics[0].clusterId));
    assert.deepStrictEqual(storedTopics.get(localTopics[0].clusterId), localTopics);
  });

  it("LOCAL: getLocalTopics() should correctly retrieve Kafka topics", async () => {
    const resourceManager = getResourceManager();
    // set the topics in the StorageManager before retrieving them
    await resourceManager.setLocalTopics(localTopics);
    // verify the topics were retrieved correctly
    const retrievedTopics: TopicsByKafkaCluster = await resourceManager.getLocalTopics();
    assert.deepStrictEqual(retrievedTopics.get(localTopics[0].clusterId), localTopics);
  });

  it("LOCAL: getLocalTopics() should return an empty map if no topics are found", async () => {
    const resourceManager = getResourceManager();
    // verify no topics are found
    const topics: TopicsByKafkaCluster = await resourceManager.getLocalTopics();
    assert.deepStrictEqual(topics, new Map());
  });

  it("LOCAL: getLocalTopic() should correctly retrieve a Kafka topic", async () => {
    // set the topics
    await getResourceManager().setLocalTopics(localTopics);
    // verify the topic was retrieved correctly
    const topic: KafkaTopic | null = await getResourceManager().getLocalTopic(
      localTopics[0].clusterId,
      localTopics[0].name,
    );
    assert.deepStrictEqual(topic, localTopics[0]);
  });

  it("LOCAL: getLocalTopic() should return null if the parent cluster ID is not found", async () => {
    // set the topics
    await getResourceManager().setLocalTopics(localTopics);
    // verify the topic was not found because the cluster ID is incorrect
    const missingTopic: KafkaTopic | null = await getResourceManager().getLocalTopic(
      "nonexistent-cluster-id",
      localTopics[0].name,
    );
    assert.strictEqual(missingTopic, null);
  });

  it("LOCAL: getLocalTopic() should return null if the topic is not found", async () => {
    // set the topics
    await getResourceManager().setLocalTopics(localTopics);
    // verify the topic was not found
    const missingTopic: KafkaTopic | null = await getResourceManager().getLocalTopic(
      localTopics[0].clusterId,
      "nonexistent-topic-name",
    );
    assert.strictEqual(missingTopic, null);
  });

  it("LOCAL: deleteLocalTopics() should correctly delete Kafka topics", async () => {
    // set the topics in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setLocalTopics(localTopics);
    await resourceManager.deleteLocalTopics();
    // verify the topics were deleted correctly
    const missingTopics = await storageManager.getWorkspaceState(StateKafkaTopics.LOCAL);
    assert.deepStrictEqual(missingTopics, undefined);
  });

  it("LOCAL: deleteLocalTopics() should delete all topics for a specific cluster", async () => {
    // set the topics in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setLocalTopics(localTopics);

    // add some more topics for a different cluster
    const newClusterId = "new-cluster-id";
    const newTopics: KafkaTopic[] = [
      KafkaTopic.create({
        ...TEST_LOCAL_KAFKA_TOPIC,
        name: "new-topic-1",
        clusterId: newClusterId,
      }),
      KafkaTopic.create({
        ...TEST_LOCAL_KAFKA_TOPIC,
        name: "new-topic-2",
        clusterId: newClusterId,
      }),
    ];
    await resourceManager.setLocalTopics(newTopics);

    // delete the first batch
    await resourceManager.deleteLocalTopics(localTopics[0].clusterId);

    // verify the topics were deleted correctly
    const missingTopics = await storageManager.getWorkspaceState(StateKafkaTopics.LOCAL);
    assert.ok(missingTopics instanceof Map);
    assert.strictEqual(missingTopics.get(localTopics[0].clusterId), undefined);

    // ...but the second batch of topics should still be there
    assert.ok(missingTopics.has(newClusterId));
    assert.deepStrictEqual(missingTopics.get(newClusterId), newTopics);
  });
});

describe("ResourceManager schema tests", function () {
  let storageManager: StorageManager;
  let ccloudSchemas: Schema[];

  before(async () => {
    // extension needs to be activated before storage manager can be used
    storageManager = await getTestStorageManager();
    ccloudSchemas = [
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_SCHEMA, id: "100001", subject: "test-ccloud-topic-xyz-value", version: 1 },
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_SCHEMA, id: "100055", subject: "test-ccloud-topic-xyz-value", version: 2 },
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_SCHEMA, id: "100055", subject: "test-ccloud-topic-abc-value", version: 1 },
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

  it("CCLOUD: setCCloudSchemas() should correctly store schemas", async () => {
    await getResourceManager().setCCloudSchemas(ccloudSchemas);
    // verify the schemas were stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedSchemasByCluster: CCloudSchemaBySchemaRegistryCluster | undefined =
      await storageManager.getWorkspaceState(StateSchemas.CCLOUD);
    assert.ok(storedSchemasByCluster);
    assert.ok(storedSchemasByCluster instanceof Map);
    assert.ok(storedSchemasByCluster.has(ccloudSchemas[0].schemaRegistryId));
    assert.deepStrictEqual(
      storedSchemasByCluster.get(ccloudSchemas[0].schemaRegistryId),
      ccloudSchemas,
    );
  });

  it("CCLOUD: setCCloudSchemas() should add new Schema Registry cluster keys if they don't exist", async () => {
    // set the first batch of schemas from the first cluster
    await getResourceManager().setCCloudSchemas(ccloudSchemas);
    // create and set the second batch of schemas for the new cluster
    const newSchemaRegistryId = "new-schema-registry-id";
    const newSchemas: Schema[] = [
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_SCHEMA, subject: "new-schema-1", schemaRegistryId: newSchemaRegistryId },
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_SCHEMA, subject: "new-schema-2", schemaRegistryId: newSchemaRegistryId },
    ];
    await getResourceManager().setCCloudSchemas(newSchemas);
  });

  it("CCLOUD: setCCloudSchemas() shouldn't duplicate schemas if the same schema ID+version already exists", async () => {
    // set the first batch of schemas from the first cluster
    await getResourceManager().setCCloudSchemas(ccloudSchemas);
    // create and set the second batch of schemas for the same cluster
    const duplicateSchemas: Schema[] = [...ccloudSchemas];
    await getResourceManager().setCCloudSchemas(duplicateSchemas);
    // verify the schemas were stored correctly by checking through the StorageManager instead of the ResourceManager
    let storedSchemasByCluster: CCloudSchemaBySchemaRegistryCluster | undefined =
      await storageManager.getWorkspaceState(StateSchemas.CCLOUD);
    assert.ok(storedSchemasByCluster);
    assert.ok(storedSchemasByCluster instanceof Map);
    assert.ok(storedSchemasByCluster.has(ccloudSchemas[0].schemaRegistryId));
    assert.deepStrictEqual(
      storedSchemasByCluster.get(ccloudSchemas[0].schemaRegistryId),
      ccloudSchemas,
    );
  });

  it("CCLOUD: getCCloudSchemas() should correctly retrieve schemas", async () => {
    const resourceManager = getResourceManager();
    // preload some schemas before retrieving them
    await resourceManager.setCCloudSchemas(ccloudSchemas);
    // verify the schemas were stored correctly
    const schemasByCluster: CCloudSchemaBySchemaRegistryCluster =
      await resourceManager.getCCloudSchemas();
    const retrievedSchemas = schemasByCluster.get(ccloudSchemas[0].schemaRegistryId);
    // casting to JSON strings so we don't have to `.equals()` compare each array element
    assert.equal(JSON.stringify(retrievedSchemas), JSON.stringify(ccloudSchemas));
  });

  it("CCLOUD: getCCloudSchemas() should return an empty map if no schemas are found", async () => {
    // verify no schemas are found
    const schemasByCluster: CCloudSchemaBySchemaRegistryCluster =
      await getResourceManager().getCCloudSchemas();
    assert.deepStrictEqual(schemasByCluster, new Map());
  });

  it("CCLOUD: getCCloudSchemas() should return Schema (dataclass) instances instead of plain objects", async () => {
    const resourceManager = getResourceManager();
    // preload some schemas before retrieving them
    await resourceManager.setCCloudSchemas(ccloudSchemas);
    // verify the schemas were stored correctly
    const schemasByCluster: CCloudSchemaBySchemaRegistryCluster =
      await resourceManager.getCCloudSchemas();
    const retrievedSchemas = schemasByCluster.get(ccloudSchemas[0].schemaRegistryId);
    assert.ok(retrievedSchemas);
    const sampleSchema: Schema = retrievedSchemas[0];
    // if this fails, we didn't properly convert the object to the dataclass Schema instance
    assert.ok(typeof sampleSchema.fileName() === "string");
  });

  it("CCLOUD: getCCloudSchemasById() should correctly retrieve schemas by their ID", async () => {
    // set the schemas
    await getResourceManager().setCCloudSchemas(ccloudSchemas);
    // verify the schema was retrieved correctly
    const schemas: Schema[] = await getResourceManager().getCCloudSchemasById(
      ccloudSchemas[0].schemaRegistryId,
      ccloudSchemas[1].id,
    );
    assert.ok(schemas);
    console.error("getCCloudSchemasById schemas:", JSON.stringify(schemas));
    // two schemas matching this schema ID, with two different subjects and versions
    assert.ok(schemas.length === 2);
    assert.ok(schemas[0]?.equals(ccloudSchemas[2])); // "test-ccloud-topic-abc-value" v1
    assert.ok(schemas[1]?.equals(ccloudSchemas[1])); // "test-ccloud-topic-xyz-value" v2
  });

  it("CCLOUD: getCCloudSchemasById() should return an empty array if the parent Schema Registry ID is not found", async () => {
    // set the schemas
    await getResourceManager().setCCloudSchemas(ccloudSchemas);
    // verify the schema was not found because the cluster ID is incorrect
    const missingSchemas: Schema[] = await getResourceManager().getCCloudSchemasById(
      "nonexistent-cluster-id",
      ccloudSchemas[0].id,
    );
    assert.deepStrictEqual(missingSchemas, []);
  });

  it("CCLOUD: getCCloudSchemasById() should return an empty array if the schema ID is not found", async () => {
    // set the schemas
    await getResourceManager().setCCloudSchemas(ccloudSchemas);
    // verify the schema was not found
    const missingSchemas: Schema[] = await getResourceManager().getCCloudSchemasById(
      ccloudSchemas[0].schemaRegistryId,
      "99999999",
    );
    assert.deepStrictEqual(missingSchemas, []);
  });

  it("CCLOUD: getCCloudSchemasBySubject() should correctly retrieve schemas by their subject", async () => {
    // set the schemas
    await getResourceManager().setCCloudSchemas(ccloudSchemas);
    // verify the schema was retrieved correctly
    const schemas: Schema[] = await getResourceManager().getCCloudSchemasBySubject(
      ccloudSchemas[0].schemaRegistryId,
      ccloudSchemas[0].subject,
    );
    assert.ok(schemas);
    // two versions for this schema subject
    assert.ok(schemas.length === 2);
    assert.ok(schemas[0]?.equals(ccloudSchemas[1])); // "test-ccloud-topic-xyz-value" v2
    assert.ok(schemas[1]?.equals(ccloudSchemas[0])); // "test-ccloud-topic-xyz-value" v1
  });

  it("CCLOUD: getCCloudSchemasBySubject() should return an empty array if the parent Schema Registry ID is not found", async () => {
    // set the schemas
    await getResourceManager().setCCloudSchemas(ccloudSchemas);
    // verify the schema was not found because the cluster ID is incorrect
    const missingSchemas: Schema[] = await getResourceManager().getCCloudSchemasBySubject(
      "nonexistent-cluster-id",
      ccloudSchemas[0].subject,
    );
    assert.deepStrictEqual(missingSchemas, []);
  });

  it("CCLOUD: getCCloudSchemasBySubject() should return an empty array if the schema subject is not found", async () => {
    // set the schemas
    await getResourceManager().setCCloudSchemas(ccloudSchemas);
    // verify the schema was not found
    const missingSchemas: Schema[] = await getResourceManager().getCCloudSchemasBySubject(
      ccloudSchemas[0].schemaRegistryId,
      "nonexistent-subject-value",
    );
    assert.deepStrictEqual(missingSchemas, []);
  });

  it("CCLOUD: deleteCCloudSchemas() should correctly delete schemas", async () => {
    // set the schemas in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudSchemas(ccloudSchemas);
    await resourceManager.deleteCCloudSchemas();
    // verify the schemas were deleted correctly
    const missingSchemas = await storageManager.getWorkspaceState(StateSchemas.CCLOUD);
    assert.deepStrictEqual(missingSchemas, undefined);
  });

  it("CCLOUD: deleteCCloudSchemas() should delete all schemas for a specific Schema Registry cluster", async () => {
    // set the schemas in the StorageManager before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setCCloudSchemas(ccloudSchemas);

    // add some more schemas for a different cluster
    const newSchemaRegistryId = "new-schema-registry-id";
    const newSchemas: Schema[] = [
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_SCHEMA, subject: "new-schema-1", schemaRegistryId: newSchemaRegistryId },
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_SCHEMA, subject: "new-schema-2", schemaRegistryId: newSchemaRegistryId },
    ];
    await resourceManager.setCCloudSchemas(newSchemas);

    // delete the first batch
    await resourceManager.deleteCCloudSchemas(ccloudSchemas[0].schemaRegistryId);

    // verify the schemas were deleted correctly
    const missingSchemas = await storageManager.getWorkspaceState(StateSchemas.CCLOUD);
    assert.ok(missingSchemas instanceof Map);
    assert.strictEqual(missingSchemas.get(ccloudSchemas[0].schemaRegistryId), undefined);
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
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_SCHEMA, id: "100001", subject: "test-ccloud-topic-xyz-value", version: 1 },
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_SCHEMA, id: "100055", subject: "test-ccloud-topic-xyz-value", version: 2 },
      // @ts-expect-error: update dataclass so we don't have to add `T as Require<T>`
      { ...TEST_SCHEMA, id: "100055", subject: "test-ccloud-topic-abc-value", version: 1 },
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
    await resourceManager.setCCloudSchemaRegistryCluster(TEST_SCHEMA_REGISTRY);
    await resourceManager.setCCloudTopics(ccloudTopics);
    await resourceManager.setCCloudSchemas(ccloudSchemas);
    // also set some local resources to make sure they aren't deleted
    await resourceManager.setLocalKafkaClusters([TEST_LOCAL_KAFKA_CLUSTER]);
    await resourceManager.setLocalTopics(localTopics);

    await resourceManager.deleteCCloudResources();

    // verify the resources were deleted correctly
    const missingClusters = await resourceManager.getCCloudKafkaClusters();
    assert.deepStrictEqual(missingClusters, new Map());
    const missingSchemaRegistries = await resourceManager.getCCloudSchemaRegistryClusters();
    assert.deepStrictEqual(missingSchemaRegistries, new Map());
    const missingTopics = await resourceManager.getCCloudTopics();
    assert.deepStrictEqual(missingTopics, new Map());
    const missingSchemas = await resourceManager.getCCloudSchemas();
    assert.deepStrictEqual(missingSchemas, new Map());

    // local resources should still be there
    const existinglocalClusters: LocalKafkaCluster[] =
      await resourceManager.getLocalKafkaClusters();
    assert.ok(existinglocalClusters);
    assert.equal(existinglocalClusters.length, 1);

    const existingLocalTopics = await resourceManager.getLocalTopics();
    assert.ok(existingLocalTopics);
    assert.equal(existingLocalTopics.size, 1);
  });
});
