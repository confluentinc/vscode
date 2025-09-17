import * as assert from "assert";
import { randomUUID } from "crypto";
import { Uri } from "vscode";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_ENVIRONMENT_ID,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_CCLOUD_SUBJECT,
  TEST_DIRECT_ENVIRONMENT,
  TEST_DIRECT_SCHEMA_REGISTRY,
  TEST_LOCAL_KAFKA_CLUSTER,
  TEST_LOCAL_KAFKA_TOPIC,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import {
  TEST_DIRECT_CONNECTION_FORM_SPEC,
  TEST_DIRECT_CONNECTION_ID,
} from "../../tests/unit/testResources/connection";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL_ID } from "../../tests/unit/testResources/flinkComputePool";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ArtifactV1FlinkArtifactMetadata } from "../clients/flinkArtifacts";
import {
  ConnectionSpec,
  ConnectionType,
  KafkaClusterConfigFromJSON,
  KafkaClusterConfigToJSON,
} from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../constants";
import { CCloudEnvironment } from "../models/environment";
import { FlinkArtifact } from "../models/flinkArtifact";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { ConnectionId, EnvironmentId, IEnvProviderRegion } from "../models/resource";
import { Subject } from "../models/schema";
import {
  CCloudSchemaRegistry,
  LocalSchemaRegistry,
  SchemaRegistry,
} from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { UriMetadataKeys } from "./constants";
import {
  CustomConnectionSpec,
  CustomConnectionSpecFromJSON,
  CustomConnectionSpecToJSON,
  DirectConnectionsById,
  GeneratedKeyResourceType,
  GeneratedWorkspaceKey,
  getResourceManager,
  mapToString,
  ResourceManager,
  stringToMap,
} from "./resourceManager";
import { UriMetadata, UriMetadataMap } from "./types";
import { clearWorkspaceState, getWorkspaceState } from "./utils";

describe("ResourceManager getEnvironments() / setEnvironments() / getEnvironmentKey()", function () {
  let rm: ResourceManager;

  before(async () => {
    // extension needs to be activated before any storage management can be done
    await getTestExtensionContext();
    rm = getResourceManager();
  });

  afterEach(async () => {
    // clean up after each test
    await clearWorkspaceState();
  });

  it("setEnvironments() should throw an error if given mixed connection IDs", async () => {
    const mixedEnvironments = [TEST_CCLOUD_ENVIRONMENT, TEST_DIRECT_ENVIRONMENT];

    await assert.rejects(
      rm.setEnvironments(CCLOUD_CONNECTION_ID, mixedEnvironments),
      (err) => {
        return err instanceof Error && err.message.includes("Connection ID mismatch");
      },
      "Expected error when setting mixed connection IDs",
    );
  });

  it("getEnvironments() should return an empty array if no environments are found", async () => {
    // no preloading, the workspace store should return undefined.
    const storedEnvironments: CCloudEnvironment[] = await rm.getEnvironments(CCLOUD_CONNECTION_ID);
    // ... which then gets promoted to an empty array.
    assert.deepStrictEqual(storedEnvironments, []);
  });

  it("setEnvironments() / getEnvironments() should correctly store CCloud environments", async () => {
    // set the environment in extension storage before retrieving it
    await rm.setEnvironments(CCLOUD_CONNECTION_ID, [TEST_CCLOUD_ENVIRONMENT]);
    // verify the environment was stored correctly
    const storedEnvironments: CCloudEnvironment[] = await rm.getEnvironments(CCLOUD_CONNECTION_ID);
    assert.ok(storedEnvironments);
    assert.deepStrictEqual(storedEnvironments, [TEST_CCLOUD_ENVIRONMENT]);
    assert.ok(
      storedEnvironments[0] instanceof CCloudEnvironment,
      "Expected stored environment to be CCloudEnvironment",
    );
  });

  it("setEnvironments() should overwrite existing environments", async () => {
    // set the environment in extension storage before retrieving it
    await rm.setEnvironments(CCLOUD_CONNECTION_ID, [TEST_CCLOUD_ENVIRONMENT]);
    // verify the environment was stored correctly
    let storedEnvironments: CCloudEnvironment[] = await rm.getEnvironments(CCLOUD_CONNECTION_ID);
    assert.ok(storedEnvironments);
    assert.deepStrictEqual(storedEnvironments, [TEST_CCLOUD_ENVIRONMENT]);

    // now overwrite with a new environment
    const newEnvironment = new CCloudEnvironment({
      ...TEST_CCLOUD_ENVIRONMENT,
      id: `new-env-id-${randomUUID()}` as EnvironmentId,
      name: `New Environment ${randomUUID()}`,
    });
    await rm.setEnvironments(CCLOUD_CONNECTION_ID, [newEnvironment]);
    // verify the environment was overwritten correctly
    storedEnvironments = await rm.getEnvironments(CCLOUD_CONNECTION_ID);
    assert.ok(storedEnvironments);
    assert.deepStrictEqual(storedEnvironments, [newEnvironment]);
  });
});

describe("ResourceManager kafka cluster methods", function () {
  // Both in the same environment.
  const mainEnvironmentId = TEST_CCLOUD_KAFKA_CLUSTER.environmentId;
  const ccloudClusters = [
    CCloudKafkaCluster.create({ ...TEST_CCLOUD_KAFKA_CLUSTER, id: "test-cluster-id-1" }),
    CCloudKafkaCluster.create({ ...TEST_CCLOUD_KAFKA_CLUSTER, id: "test-cluster-id-2" }),
  ];

  const otherEnvironmentId = "other-env-id" as EnvironmentId;
  const otherEnvironmentCCloudClusters = [
    CCloudKafkaCluster.create({
      ...TEST_CCLOUD_KAFKA_CLUSTER,
      id: "other-cluster-id-1",
      environmentId: otherEnvironmentId,
    }),
    CCloudKafkaCluster.create({
      ...TEST_CCLOUD_KAFKA_CLUSTER,
      id: "other-cluster-id-2",
      environmentId: otherEnvironmentId,
    }),
  ];
  let rm: ResourceManager;

  before(async () => {
    // extension needs to be activated before any storage management can be done
    await getTestExtensionContext();
    rm = getResourceManager();
  });

  afterEach(async () => {
    // clean up after each test
    await clearWorkspaceState();
  });

  it("setKafkaClusters() / getKafkaClusters() should correctly store CCloud Kafka clusters", async () => {
    // set the clusters in extension storage before retrieving them
    await rm.setKafkaClusters(CCLOUD_CONNECTION_ID, ccloudClusters);
    // verify the clusters were stored correctly
    const storedClusters: CCloudKafkaCluster[] = await rm.getKafkaClusters(CCLOUD_CONNECTION_ID);
    assert.ok(storedClusters);
    assert.deepStrictEqual(storedClusters, ccloudClusters);
    for (const cluster of storedClusters) {
      assert.ok(
        cluster instanceof CCloudKafkaCluster,
        "Expected stored cluster to be CCloudKafkaCluster",
      );
    }
  });

  it("setKafkaClusters() should overwrite existing clusters", async () => {
    // set the clusters in extension storage before retrieving them
    await rm.setKafkaClusters(CCLOUD_CONNECTION_ID, ccloudClusters);
    // verify the clusters were stored correctly
    let storedClusters: CCloudKafkaCluster[] = await rm.getKafkaClusters(CCLOUD_CONNECTION_ID);
    assert.ok(storedClusters);
    assert.deepStrictEqual(storedClusters, ccloudClusters);

    // now overwrite with new clusters
    const newCCloudClusters = [
      CCloudKafkaCluster.create({ ...TEST_CCLOUD_KAFKA_CLUSTER, id: "new-cluster-id-1" }),
      CCloudKafkaCluster.create({ ...TEST_CCLOUD_KAFKA_CLUSTER, id: "new-cluster-id-2" }),
    ];
    await rm.setKafkaClusters(CCLOUD_CONNECTION_ID, newCCloudClusters);

    // verify the clusters were overwritten correctly
    storedClusters = await rm.getKafkaClusters(CCLOUD_CONNECTION_ID);
    assert.ok(storedClusters);
    assert.deepStrictEqual(storedClusters, newCCloudClusters);
  });

  it("setKafkaClusters() with empty array should clear existing clusters", async () => {
    // set the clusters in extension storage before retrieving them
    await rm.setKafkaClusters(CCLOUD_CONNECTION_ID, ccloudClusters);
    // verify the clusters were stored correctly
    let storedClusters: CCloudKafkaCluster[] = await rm.getKafkaClusters(CCLOUD_CONNECTION_ID);
    assert.ok(storedClusters);
    assert.deepStrictEqual(storedClusters, ccloudClusters);

    // now clear the clusters
    await rm.setKafkaClusters(CCLOUD_CONNECTION_ID, []);
    storedClusters = await rm.getKafkaClusters(CCLOUD_CONNECTION_ID);
    assert.deepStrictEqual(storedClusters, []);
  });

  it("setKafkaClusters() with mixed connection IDs should raise an error", async () => {
    const mixedClusters = [...ccloudClusters, TEST_LOCAL_KAFKA_CLUSTER];

    await assert.rejects(
      rm.setKafkaClusters(CCLOUD_CONNECTION_ID, mixedClusters),
      (err) => {
        return err instanceof Error && err.message.includes("Connection ID mismatch");
      },
      "Expected error when setting mixed connection IDs",
    );
  });

  it("getKafkaClusters() should return an empty array if no clusters are found", async () => {
    // no preloading, the workspace store should return undefined.
    const storedClusters: CCloudKafkaCluster[] = await rm.getKafkaClusters(CCLOUD_CONNECTION_ID);
    assert.deepStrictEqual(storedClusters, []);
  });

  it("getKafkaClustersForEnvironmentId() should return clusters for a specific environment ID", async () => {
    const allClusters = [...ccloudClusters, ...otherEnvironmentCCloudClusters];
    // set the clusters in extension storage before retrieving them
    await rm.setKafkaClusters(CCLOUD_CONNECTION_ID, allClusters);

    // fetch clusters for the main environment
    const clustersForMainEnv: CCloudKafkaCluster[] = await rm.getKafkaClustersForEnvironmentId(
      CCLOUD_CONNECTION_ID,
      mainEnvironmentId,
    );

    assert.deepStrictEqual(
      clustersForMainEnv,
      ccloudClusters,
      "Expected clusters for main environment",
    );

    // fetch clusters for the other environment
    const clustersForOtherEnv: CCloudKafkaCluster[] = await rm.getKafkaClustersForEnvironmentId(
      CCLOUD_CONNECTION_ID,
      otherEnvironmentId,
    );
    assert.deepStrictEqual(
      clustersForOtherEnv,
      otherEnvironmentCCloudClusters,
      "Expected clusters for other environment",
    );
  });
});

describe("ResourceManager setTopicsForCluster() / getTopicsForCluster() / topicKeyForCluster()", function () {
  before(async () => {
    // extension needs to be activated before any storage management can be done
    await getTestExtensionContext();
  });

  beforeEach(async () => {
    // fresh slate for each test
    await clearWorkspaceState();
  });

  afterEach(async () => {
    // clean up after each test
    await clearWorkspaceState();
  });

  it("setTopicsForCluster() should throw an error if given mixed connection IDs", async () => {
    // from mixed kafka clusters (and even connections!)
    const mixedTopics = [TEST_CCLOUD_KAFKA_TOPIC, TEST_LOCAL_KAFKA_TOPIC];

    await assert.rejects(
      getResourceManager().setTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER, mixedTopics),
      (err) => {
        return err instanceof Error && err.message.includes("Cluster ID mismatch in topics");
      },
      "Expected error when setting mixed connection IDs",
    );
  });

  it("CCLOUD: getTopicsForCluster() should return undefined if no cached topics for this cluster", async () => {
    const manager = getResourceManager();
    await manager.setKafkaClusters(CCLOUD_CONNECTION_ID, [TEST_CCLOUD_KAFKA_CLUSTER]);

    const topics = await manager.getTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER);
    assert.deepStrictEqual(topics, undefined);
  });

  it("CCLOUD: getTopicsForCluster() should return empty array of topics if empty array is set", async () => {
    const manager = getResourceManager();
    await manager.setKafkaClusters(CCLOUD_CONNECTION_ID, [TEST_CCLOUD_KAFKA_CLUSTER]);

    await manager.setTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER, []);
    const topics = await manager.getTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER);
    assert.deepStrictEqual(topics, []);
  });

  it("CCLOUD: getTopicsForCluster() should return the correct cloud topics", async () => {
    const manager = getResourceManager();

    const otherCcloudCluster = CCloudKafkaCluster.create({
      ...TEST_CCLOUD_KAFKA_CLUSTER,
      id: "other-cluster-id",
    });

    await manager.setKafkaClusters(CCLOUD_CONNECTION_ID, [
      TEST_CCLOUD_KAFKA_CLUSTER,
      otherCcloudCluster,
    ]);

    const ccloudTopics = [
      KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, name: "test-ccloud-topic-1" }),
      KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, name: "test-ccloud-topic-2" }),
    ];

    const otherCcloudClusterTopics = [
      KafkaTopic.create({
        ...TEST_CCLOUD_KAFKA_TOPIC,
        name: "test-ccloud-topic-3",
        clusterId: otherCcloudCluster.id,
      }),
    ];

    await manager.setTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER, ccloudTopics);

    await manager.setKafkaClusters(CCLOUD_CONNECTION_ID, [
      TEST_CCLOUD_KAFKA_CLUSTER,
      otherCcloudCluster,
    ]);

    await manager.setTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER, ccloudTopics);

    const ccloudTopicsForMainCluster = await manager.getTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER);
    assert.deepEqual(
      ccloudTopicsForMainCluster,
      ccloudTopics,
      "Expected cloud topics to be returned for the cloud cluster",
    );

    // Now set another batch of topics for a different cloud cluster
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

    // No cross-contamination between different cloud clusters
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
});

describe("ResourceManager Schema Registry methods", function () {
  let rm: ResourceManager;

  beforeEach(async () => {
    // fresh slate for each test
    await clearWorkspaceState();
    rm = getResourceManager();
  });

  afterEach(async () => {
    // clean up after each test
    await clearWorkspaceState();
  });

  it("setSchemaRegistries() error when given mixed connection id array", async () => {
    const ccloudSchemaRegistry = CCloudSchemaRegistry.create(TEST_CCLOUD_SCHEMA_REGISTRY);
    const localSchemaRegistry = LocalSchemaRegistry.create(TEST_LOCAL_SCHEMA_REGISTRY);
    const mixedRegistries = [ccloudSchemaRegistry, localSchemaRegistry];

    await assert.rejects(
      rm.setSchemaRegistries(CCLOUD_CONNECTION_ID, mixedRegistries),
      (err) => {
        return err instanceof Error && err.message.includes("Connection ID mismatch");
      },
      "Expected error when setting mixed connection IDs",
    );
  });

  it("setSchemaRegistries() overwrites prior stored info", async () => {
    await getWorkspaceState().update(
      rm.generateWorkspaceStorageKey(
        CCLOUD_CONNECTION_ID,
        GeneratedKeyResourceType.SCHEMA_REGISTRIES,
      ),
      undefined,
    );

    const ccloudSchemaRegistry = CCloudSchemaRegistry.create(TEST_CCLOUD_SCHEMA_REGISTRY);
    await rm.setSchemaRegistries(CCLOUD_CONNECTION_ID, [ccloudSchemaRegistry]);

    const storedRegistries: CCloudSchemaRegistry[] =
      await rm.getSchemaRegistries(CCLOUD_CONNECTION_ID);

    assert.deepStrictEqual(
      storedRegistries,
      [ccloudSchemaRegistry],
      "Expected stored registries to match",
    );

    // Now set with two registries.
    const anotherCcloudSchemaRegistry = CCloudSchemaRegistry.create({
      ...TEST_CCLOUD_SCHEMA_REGISTRY,
      id: "another-ccloud-sr-id",
      environmentId: "another-env-id" as EnvironmentId,
    });

    // set both ...
    const both = [ccloudSchemaRegistry, anotherCcloudSchemaRegistry];
    await rm.setSchemaRegistries(CCLOUD_CONNECTION_ID, both);

    // ... and verify both are stored.
    const storedRegistriesAfter: CCloudSchemaRegistry[] =
      await rm.getSchemaRegistries(CCLOUD_CONNECTION_ID);

    assert.deepStrictEqual(
      storedRegistriesAfter,
      both,
      "Expected stored registries to match after reassignment",
    );
  });
});

describe("ResourceManager Flink Artifact methods", function () {
  const baseEnvId = TEST_CCLOUD_ENVIRONMENT_ID;
  const provider = "aws";
  const region1 = "us-east-1";
  const region2 = "us-west-2";

  let rm: ResourceManager;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(async () => {
    rm = getResourceManager();
    await clearWorkspaceState();
  });

  afterEach(async () => {
    await clearWorkspaceState();
  });

  function makeArtifact(
    id: string,
    envId: EnvironmentId,
    prov: string,
    reg: string,
    name?: string,
  ): FlinkArtifact {
    return new FlinkArtifact({
      connectionId: CCLOUD_CONNECTION_ID,
      connectionType: ConnectionType.Ccloud,
      environmentId: envId,
      id,
      name: name ?? `artifact-${id}`,
      description: `Description for ${id}`,
      provider: prov,
      region: reg,
      documentationLink: "https://example.com/docs",
      metadata: {
        created_at: new Date(),
        updated_at: new Date(),
      } as ArtifactV1FlinkArtifactMetadata,
    });
  }

  it("getFlinkArtifacts() should return undefined (cache miss) when none stored", async () => {
    const envProviderRegion: IEnvProviderRegion = {
      environmentId: baseEnvId,
      provider,
      region: region1,
    };
    const artifacts = await rm.getFlinkArtifacts(envProviderRegion);
    assert.strictEqual(artifacts, undefined);
  });

  it("setFlinkArtifacts() then getFlinkArtifacts() should return stored artifacts", async () => {
    const envProviderRegion: IEnvProviderRegion = {
      environmentId: baseEnvId,
      provider,
      region: region1,
    };
    const artifactsToStore = [
      makeArtifact("fa-1", baseEnvId, provider, region1),
      makeArtifact("fa-2", baseEnvId, provider, region1),
    ];

    await rm.setFlinkArtifacts(envProviderRegion, artifactsToStore);

    const stored: FlinkArtifact[] | undefined = await rm.getFlinkArtifacts(envProviderRegion);
    assert.ok(stored);
    assert.deepStrictEqual(
      stored.map((a) => a.id),
      artifactsToStore.map((a) => a.id),
    );
    for (const art of stored) {
      assert.ok(art instanceof FlinkArtifact, "Expected instance of FlinkArtifact");
      assert.strictEqual(art.provider, provider);
      assert.strictEqual(art.region, region1);
      assert.strictEqual(art.environmentId, baseEnvId);
    }
  });

  it("setFlinkArtifacts() with empty array should persist empty list (not cache miss)", async () => {
    const envProviderRegion: IEnvProviderRegion = {
      environmentId: baseEnvId,
      provider,
      region: region1,
    };

    await rm.setFlinkArtifacts(envProviderRegion, []);
    const stored = await rm.getFlinkArtifacts(envProviderRegion);
    assert.deepStrictEqual(stored, []);
  });

  it("setFlinkArtifacts() should isolate different provider/region keys", async () => {
    const key1: IEnvProviderRegion = {
      environmentId: baseEnvId,
      provider,
      region: region1,
    };
    const key2: IEnvProviderRegion = {
      environmentId: baseEnvId,
      provider,
      region: region2,
    };

    const artifactsKey1 = [makeArtifact("fa-a", baseEnvId, provider, region1)];
    const artifactsKey2 = [
      makeArtifact("fa-b", baseEnvId, provider, region2),
      makeArtifact("fa-c", baseEnvId, provider, region2),
    ];

    await rm.setFlinkArtifacts(key1, artifactsKey1);
    await rm.setFlinkArtifacts(key2, artifactsKey2);

    const stored1 = await rm.getFlinkArtifacts(key1);
    const stored2 = await rm.getFlinkArtifacts(key2);

    assert.deepStrictEqual(
      stored1?.map((a) => a.id),
      artifactsKey1.map((a) => a.id),
    );
    assert.deepStrictEqual(
      stored2?.map((a) => a.id),
      artifactsKey2.map((a) => a.id),
    );
  });

  for (const { label, artifact: mismatchedArtifact } of [
    {
      label: "environment mismatch",
      artifact: makeArtifact("fa-y", "other-env-id" as EnvironmentId, provider, region1),
    },
    {
      label: "provider mismatch",
      artifact: makeArtifact("fa-y", baseEnvId, "gcp", region1),
    },
    {
      label: "region mismatch",
      artifact: makeArtifact("fa-y", baseEnvId, provider, "eu-central-1"),
    },
  ]) {
    it(`setFlinkArtifacts() should throw on ${label}`, async () => {
      const envProviderRegion: IEnvProviderRegion = {
        environmentId: baseEnvId,
        provider,
        region: region1,
      };
      const artifacts = [
        // Valid one...
        makeArtifact("fa-x", baseEnvId, provider, region1),
        // ... and one with the deliberate mismatch.
        mismatchedArtifact,
      ];
      await assert.rejects(
        rm.setFlinkArtifacts(envProviderRegion, artifacts),
        (err: unknown) =>
          err instanceof Error && err.message.includes("Environment/Provider/Region mismatch"),
        `Expected ${label} error`,
      );
    });
  }

  it("getFlinkArtifacts() should not leak artifacts across different regions", async () => {
    const key1: IEnvProviderRegion = {
      environmentId: baseEnvId,
      provider,
      region: region1,
    };

    const artifactsKey1 = [makeArtifact("fa-a", baseEnvId, provider, region1)];
    await rm.setFlinkArtifacts(key1, artifactsKey1);

    const key2: IEnvProviderRegion = {
      environmentId: baseEnvId,
      provider,
      region: region2,
    };
    const missingInKey2 = await rm.getFlinkArtifacts(key2);
    assert.strictEqual(missingInKey2, undefined);
  });
});

describe("ResourceManager direct connection methods", function () {
  let rm: ResourceManager;

  before(async () => {
    // extension needs to be activated before any storage management can be done
    await getTestExtensionContext();
  });

  beforeEach(async () => {
    rm = getResourceManager();
    // fresh slate for each test
    await rm.deleteDirectConnections();
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

  it("deleteDirectConnection() should correctly delete a direct connection and not touch existing connections", async function () {
    // allow two retries since this test is flaky in CI
    this.retries(2);

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

  it("deleteDirectConnections() should delete all direct connections", async function () {
    // allow two retries since this test is flaky in CI
    this.retries(2);

    // preload multiple connections
    const specs: CustomConnectionSpec[] = [
      { ...TEST_DIRECT_CONNECTION_FORM_SPEC, id: "foo1" as ConnectionId },
      { ...TEST_DIRECT_CONNECTION_FORM_SPEC, id: "bar2" as ConnectionId },
      { ...TEST_DIRECT_CONNECTION_FORM_SPEC, id: "baz3" as ConnectionId },
    ];
    await Promise.all(specs.map((spec) => rm.addDirectConnection(spec)));

    // make sure they exist
    let storedSpecs: DirectConnectionsById = await rm.getDirectConnections();
    assert.ok(storedSpecs);
    assert.equal(storedSpecs.size, specs.length, mapToString(storedSpecs));

    // delete all connections
    await rm.deleteDirectConnections();

    // make sure they're gone
    storedSpecs = await rm.getDirectConnections();
    assert.deepStrictEqual(storedSpecs, new Map());
  });
});

describe("ResourceManager SR subject methods", function () {
  let resourceManager: ResourceManager;

  before(async () => {
    // extension needs to be activated before any storage management can be done
    resourceManager = getResourceManager();
  });

  this.beforeEach(async () => {
    // fresh slate for each test
    await clearWorkspaceState();
  });

  this.afterEach(async () => {
    // clean up after each test
    await clearWorkspaceState();
  });

  function createTestSubjects(schemaRegistry: SchemaRegistry, count: number): Subject[] {
    const subjects: Subject[] = [];
    for (let i = 0; i < count; i++) {
      const subjectName = `test-subject-${i + 1}`;
      const subject = new Subject(
        subjectName,
        schemaRegistry.connectionId,
        schemaRegistry.environmentId,
        schemaRegistry.id,
        null,
      );
      // Add the subject to the list of subjects
      subjects.push(subject);
    }
    return subjects;
  }

  it("getSubjects() should return undefined if no cached subjects for this schema registry", async () => {
    for (const sr of [
      TEST_CCLOUD_SCHEMA_REGISTRY,
      TEST_LOCAL_SCHEMA_REGISTRY,
      TEST_DIRECT_SCHEMA_REGISTRY,
    ]) {
      const subjects = await resourceManager.getSubjects(sr);
      assert.deepStrictEqual(subjects, undefined);
    }
  });

  it("getSubjects() should return undefined if one ccloud SR is set but not the other", async () => {
    // Set up the cloud topics.

    const otherCCloudSR = CCloudSchemaRegistry.create({
      ...TEST_CCLOUD_SCHEMA_REGISTRY,
      id: "other-cluster-id",
    });

    // Set some subjects for the other cloud SR
    await resourceManager.setSubjects(otherCCloudSR, createTestSubjects(otherCCloudSR, 2));

    // But our main cloud SR should not have any.
    const subjects = await resourceManager.getSubjects(TEST_LOCAL_SCHEMA_REGISTRY);
    assert.deepStrictEqual(subjects, undefined);
  });

  it("getSubjects() should return empty array of subjects if empty array is set", async () => {
    for (const sr of [
      TEST_CCLOUD_SCHEMA_REGISTRY,
      TEST_LOCAL_SCHEMA_REGISTRY,
      TEST_DIRECT_SCHEMA_REGISTRY,
    ]) {
      await resourceManager.setSubjects(sr, []);
      const subjects = await resourceManager.getSubjects(sr);
      assert.deepStrictEqual(subjects, []);
    }
  });

  it("getSubjects() should return the correct subjects for the schema registry", async () => {
    const testSubjects = createTestSubjects(TEST_CCLOUD_SCHEMA_REGISTRY, 2);
    await resourceManager.setSubjects(TEST_CCLOUD_SCHEMA_REGISTRY, testSubjects);
    let retrievedSubjects = await resourceManager.getSubjects(TEST_CCLOUD_SCHEMA_REGISTRY);
    assert.deepStrictEqual(retrievedSubjects, testSubjects, "first comparison");

    // and rewriting to new subjects should work
    const newTestSubjects = createTestSubjects(TEST_CCLOUD_SCHEMA_REGISTRY, 3);
    await resourceManager.setSubjects(TEST_CCLOUD_SCHEMA_REGISTRY, newTestSubjects);
    retrievedSubjects = await resourceManager.getSubjects(TEST_CCLOUD_SCHEMA_REGISTRY);
    assert.deepStrictEqual(retrievedSubjects, newTestSubjects, "second comparison");
  });

  it("setSubjects() with undefined should clear out just that single schema registry's subjects", async () => {
    // setSubjects(..., undefined) is way to clear out a single schema registry's subjects.

    // Set subjects for two different ccloud-based registries
    await resourceManager.setSubjects(
      TEST_CCLOUD_SCHEMA_REGISTRY,
      createTestSubjects(TEST_CCLOUD_SCHEMA_REGISTRY, 2),
    );

    const otherCCloudSR = CCloudSchemaRegistry.create({
      ...TEST_CCLOUD_SCHEMA_REGISTRY,
      id: "other-ccloud-env-id-registry",
      environmentId: "other-ccloud-env-id" as EnvironmentId,
    });

    const otherCCloudSRSubjects = createTestSubjects(otherCCloudSR, 3);
    await resourceManager.setSubjects(otherCCloudSR, otherCCloudSRSubjects);

    // Verify that the subjects were set correctly
    let retrievedSubjects = await resourceManager.getSubjects(TEST_CCLOUD_SCHEMA_REGISTRY);
    assert.ok(retrievedSubjects);
    assert.equal(retrievedSubjects.length, 2);

    retrievedSubjects = await resourceManager.getSubjects(otherCCloudSR);
    assert.ok(retrievedSubjects);
    assert.equal(retrievedSubjects.length, 3);

    // Now clear out the first one
    await resourceManager.setSubjects(TEST_CCLOUD_SCHEMA_REGISTRY, undefined);
    // Verify that the first one is gone
    const missingSubjects = await resourceManager.getSubjects(TEST_CCLOUD_SCHEMA_REGISTRY);
    assert.deepStrictEqual(missingSubjects, undefined);
    // Verify that the second one is still there
    const otherSubjects = await resourceManager.getSubjects(otherCCloudSR);
    assert.ok(otherSubjects);
    assert.equal(otherSubjects.length, 3);
    assert.deepStrictEqual(otherSubjects, otherCCloudSRSubjects);
  });

  it("purgeConnectionResources(LOCAL_CONNECTION_ID) should correctly delete only local SR subjects", async () => {
    // set the subjects in extension storage before deleting them
    await resourceManager.setSubjects(
      TEST_CCLOUD_SCHEMA_REGISTRY,
      createTestSubjects(TEST_CCLOUD_SCHEMA_REGISTRY, 2),
    );
    const localSubjects = createTestSubjects(TEST_LOCAL_SCHEMA_REGISTRY, 2);
    await resourceManager.setSubjects(TEST_LOCAL_SCHEMA_REGISTRY, localSubjects);

    // clear all local resources
    await resourceManager.purgeConnectionResources(LOCAL_CONNECTION_ID);

    // verify the local topics were deleted correctly.
    const missingLocalSubjects = await resourceManager.getSubjects(TEST_LOCAL_SCHEMA_REGISTRY);
    assert.deepStrictEqual(missingLocalSubjects, undefined);

    // verify the ccloud topics were not deleted.
    const fetchedCCloudSubjects = await resourceManager.getSubjects(TEST_CCLOUD_SCHEMA_REGISTRY);
    assert.ok(fetchedCCloudSubjects);
  });
});

describe("ResourceManager general utility methods", function () {
  let ccloudTopics: KafkaTopic[];

  before(async () => {
    // extension needs to be activated before any storage management can be done
    await getTestExtensionContext();

    ccloudTopics = [
      KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, name: "test-ccloud-topic-1" }),
      KafkaTopic.create({ ...TEST_CCLOUD_KAFKA_TOPIC, name: "test-ccloud-topic-2" }),
    ];
  });

  beforeEach(async () => {
    // fresh slate for each test
    await clearWorkspaceState();
  });

  afterEach(async () => {
    // clean up after each test
    await clearWorkspaceState();
  });

  it("CCLOUD: purgeConnectionResources() should correctly delete all CCloud resources", async () => {
    // set the CCloud resources before deleting them
    const resourceManager = getResourceManager();
    await resourceManager.setEnvironments(CCLOUD_CONNECTION_ID, [TEST_CCLOUD_ENVIRONMENT]);
    await resourceManager.setKafkaClusters(CCLOUD_CONNECTION_ID, [TEST_CCLOUD_KAFKA_CLUSTER]);
    await resourceManager.setSchemaRegistries(CCLOUD_CONNECTION_ID, [TEST_CCLOUD_SCHEMA_REGISTRY]);
    await resourceManager.setTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER, ccloudTopics);
    await resourceManager.setSubjects(TEST_CCLOUD_SCHEMA_REGISTRY, [TEST_CCLOUD_SUBJECT]);

    await resourceManager.purgeConnectionResources(CCLOUD_CONNECTION_ID);

    // verify all the CCloud resources were deleted.

    const missingEnvironments =
      await resourceManager.getEnvironments<CCloudEnvironment>(CCLOUD_CONNECTION_ID);
    assert.deepStrictEqual(missingEnvironments, []);

    const missingClusters =
      await resourceManager.getKafkaClusters<CCloudKafkaCluster>(CCLOUD_CONNECTION_ID);
    assert.deepStrictEqual(missingClusters, []);

    const missingSchemaRegistries =
      await resourceManager.getSchemaRegistries<CCloudSchemaRegistry>(CCLOUD_CONNECTION_ID);
    assert.deepStrictEqual(missingSchemaRegistries, []);

    // For reasons, these two represent emptiness with undefined, not empty arrays. Ah, consistency!
    const missingTopics = await resourceManager.getTopicsForCluster(TEST_CCLOUD_KAFKA_CLUSTER);
    assert.deepStrictEqual(missingTopics, undefined);

    const missingSubjects = await resourceManager.getSubjects(TEST_CCLOUD_SCHEMA_REGISTRY);
    assert.deepStrictEqual(missingSubjects, undefined);
  });
});

describe("ResourceManager Uri metadata methods", () => {
  let resourceManager: ResourceManager;

  const testUri: Uri = Uri.parse("file:///test-file.sql");
  const testMetadata: UriMetadata = {
    [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: TEST_CCLOUD_FLINK_COMPUTE_POOL_ID,
  };

  before(async () => {
    // extension needs to be activated before any storage management can be done
    await getTestExtensionContext();
  });

  beforeEach(async () => {
    resourceManager = getResourceManager();

    // fresh slate for each test
    await clearWorkspaceState();
  });

  afterEach(async () => {
    // clean up after each test
    await clearWorkspaceState();
  });

  it("should set and get Uri metadata correctly", async () => {
    await resourceManager.setUriMetadata(testUri, testMetadata);
    const retrievedMetadata: UriMetadata | undefined =
      await resourceManager.getUriMetadata(testUri);

    assert.deepStrictEqual(retrievedMetadata, testMetadata);
  });

  it("should return undefined when getting metadata for Uri that has no metadata", async () => {
    const nonExistentUri = Uri.parse("file:///non-existent-file.sql");
    const retrievedMetadata: UriMetadata | undefined =
      await resourceManager.getUriMetadata(nonExistentUri);

    assert.strictEqual(retrievedMetadata, undefined);
  });

  it("should delete Uri metadata correctly", async () => {
    // set initial metadata
    await resourceManager.setUriMetadata(testUri, testMetadata);
    let retrievedMetadata: UriMetadata | undefined = await resourceManager.getUriMetadata(testUri);
    assert.deepStrictEqual(retrievedMetadata, testMetadata);

    // delete and verify it's gone
    await resourceManager.deleteUriMetadata(testUri);
    retrievedMetadata = await resourceManager.getUriMetadata(testUri);
    assert.strictEqual(retrievedMetadata, undefined);
  });

  it("should update existing metadata when setting new metadata for the same Uri", async () => {
    // set initial metadata
    await resourceManager.setUriMetadata(testUri, {
      [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: TEST_CCLOUD_FLINK_COMPUTE_POOL_ID,
    });
    // update with new metadata
    const newPoolId = "updated-compute-pool-id";
    await resourceManager.setUriMetadata(testUri, {
      [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: newPoolId,
    });
    // make sure the merged metadata is correct
    const retrievedMetadata: UriMetadata | undefined =
      await resourceManager.getUriMetadata(testUri);

    assert.deepStrictEqual(retrievedMetadata, {
      [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: newPoolId, // not TEST_CCLOUD_FLINK_COMPUTE_POOL_ID
    });
  });

  it("should set and get individual Uri metadata key/value pairs correctly", async () => {
    const poolId = randomUUID();
    await resourceManager.setUriMetadataValue(
      testUri,
      UriMetadataKeys.FLINK_COMPUTE_POOL_ID,
      poolId,
    );

    const retrievedValue = await resourceManager.getUriMetadataValue(
      testUri,
      UriMetadataKeys.FLINK_COMPUTE_POOL_ID,
    );

    assert.strictEqual(retrievedValue, poolId);
  });

  it("should return undefined when getting a metadata value that doesn't exist", async () => {
    // no preloading metadata for this test
    const value = await resourceManager.getUriMetadataValue(
      testUri,
      UriMetadataKeys.FLINK_COMPUTE_POOL_ID,
    );

    assert.strictEqual(value, undefined);
  });

  it("should handle multiple Uris with different metadata sequentially", async () => {
    const uri1 = Uri.parse("file:///path1/file1.sql");
    const uri2 = Uri.parse("file:///path2/file2.sql");

    const metadata1 = { [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: "pool1" };
    const metadata2 = { [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: "pool2" };

    await resourceManager.setUriMetadata(uri1, metadata1);
    await resourceManager.setUriMetadata(uri2, metadata2);

    const retrieved1: UriMetadata | undefined = await resourceManager.getUriMetadata(uri1);
    const retrieved2: UriMetadata | undefined = await resourceManager.getUriMetadata(uri2);

    assert.deepStrictEqual(retrieved1, metadata1);
    assert.deepStrictEqual(retrieved2, metadata2);
  });

  it("should clear all Uri metadata when deleteAllUriMetadata is called", async () => {
    // set multiple Uris with metadata
    const uri1 = Uri.parse("file:///path1/file1.sql");
    const uri2 = Uri.parse("file:///path2/file2.sql");
    await resourceManager.setUriMetadata(uri1, {
      [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: "pool1",
    });
    await resourceManager.setUriMetadata(uri2, {
      [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: "pool2",
    });
    // verify they exist
    const allMetadata: UriMetadataMap = await resourceManager.getAllUriMetadata();
    assert.strictEqual(allMetadata.size, 2);

    await resourceManager.deleteAllUriMetadata();

    const emptyMetadata: UriMetadataMap = await resourceManager.getAllUriMetadata();
    assert.strictEqual(emptyMetadata.size, 0);
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

describe("ResourceManager.runWithMutex()", function () {
  it("makes new mutexes on demand", async () => {
    const resourceManager = getResourceManager();
    const mutexKey = "test-mutex-key" as GeneratedWorkspaceKey;
    let happy: boolean = false;
    await resourceManager["runWithMutex"](mutexKey, async () => {
      happy = true;
    });

    assert.strictEqual(happy, true, "Expected the mutex to run the function successfully");
  });
});
