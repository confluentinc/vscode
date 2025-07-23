import * as assert from "assert";
import * as sinon from "sinon";
import { QuickPickItemKind, window } from "vscode";

import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_LOCAL_ENVIRONMENT,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ResourceLoader } from "../loaders";
import { CCloudKafkaCluster, KafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import * as topicsViewProviders from "../viewProviders/topics";
import { flinkDatabaseQuickpick, kafkaClusterQuickPick } from "./kafkaClusters";
import { QuickPickItemWithValue } from "./types";

describe("kafkaClusterQuickPick", () => {
  let sandbox: sinon.SinonSandbox;
  const mockLoaders = [
    {
      getEnvironments: sinon.stub(),
      getKafkaClustersForEnvironmentId: sinon.stub(),
    },
  ];

  let showQuickPickStub: sinon.SinonStub;

  before(async () => {
    // Set up the test environment
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const loadersStub = sandbox.stub(ResourceLoader, "loaders");
    loadersStub.returns(mockLoaders as any);
    showQuickPickStub = sandbox.stub(window, "showQuickPick");
    showQuickPickStub.resolves(undefined);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("bails out early if the environment has no clusters", async () => {
    mockLoaders[0].getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
    mockLoaders[0].getKafkaClustersForEnvironmentId.resolves([]);
    const showInformationMessageStub = sandbox
      .stub(window, "showInformationMessage")
      .resolves(undefined);

    const result = await kafkaClusterQuickPick();
    assert.strictEqual(result, undefined);
    assert.strictEqual(showInformationMessageStub.callCount, 1);
    assert.strictEqual(
      showInformationMessageStub.getCall(0).args[0],
      "No Kafka clusters available.",
    );
  });

  it("should return undefined if getKafkaClustersForEnvironmentId() is out of synch with getEnvironments()", async () => {
    mockLoaders[0].getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
    // should have included clusters referencing TEST_LOCAL_ENVIRONMENT, so will make code hit error.
    mockLoaders[0].getKafkaClustersForEnvironmentId.resolves([TEST_CCLOUD_KAFKA_CLUSTER]);

    const result = await kafkaClusterQuickPick();
    assert.strictEqual(result, undefined);
  });

  it("Offers all Kafka clusters if driven w/o a filter lambda", async () => {
    const clusters: KafkaCluster[] = [
      TEST_LOCAL_KAFKA_CLUSTER,
      LocalKafkaCluster.create({ ...TEST_LOCAL_KAFKA_CLUSTER, id: "local-kafka-cluster-xyz" }),
    ];

    mockLoaders[0].getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
    mockLoaders[0].getKafkaClustersForEnvironmentId.resolves(clusters);

    // Call with no filter lambda.
    await kafkaClusterQuickPick();

    const itemsCalledWith: QuickPickItemWithValue<KafkaCluster>[] =
      showQuickPickStub.getCall(0).args[0];

    // one separator for the single environment, two for the two clusters
    assert.strictEqual(itemsCalledWith.length, 3);
    assert.strictEqual(itemsCalledWith[0].kind, QuickPickItemKind.Separator);

    // other two items are the clusters. Their description should be the id.
    // and their .value should be the cluster.
    assert.strictEqual(itemsCalledWith[1].description, clusters[0].id);
    assert.strictEqual(itemsCalledWith[1].value, clusters[0]);
    assert.strictEqual(itemsCalledWith[2].description, clusters[1].id);
    assert.strictEqual(itemsCalledWith[2].value, clusters[1]);
  });

  it("Filters Kafka clusters based on the provided filter lambda", async () => {
    const clusters: KafkaCluster[] = [
      TEST_LOCAL_KAFKA_CLUSTER,
      LocalKafkaCluster.create({ ...TEST_LOCAL_KAFKA_CLUSTER, id: "local-kafka-cluster-xyz" }),
    ];

    mockLoaders[0].getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
    mockLoaders[0].getKafkaClustersForEnvironmentId.resolves(clusters);

    // Call with a filter lambda that only allows the first cluster.
    const filter = (cluster: KafkaCluster) => cluster.id === TEST_LOCAL_KAFKA_CLUSTER.id;
    await kafkaClusterQuickPick({ filter: filter });

    const itemsCalledWith = showQuickPickStub.getCall(0).args[0];

    // one separator for the single environment, one for the single cluster
    assert.strictEqual(itemsCalledWith.length, 2);
    assert.strictEqual(itemsCalledWith[0].kind, QuickPickItemKind.Separator);

    // other item is the cluster. Its description should be the id.
    assert.strictEqual(itemsCalledWith[1].description, clusters[0].id);
  });

  it("Uses the provided placeHolder in the quick pick", async () => {
    const clusters: KafkaCluster[] = [
      TEST_LOCAL_KAFKA_CLUSTER,
      LocalKafkaCluster.create({ ...TEST_LOCAL_KAFKA_CLUSTER, id: "local-kafka-cluster-xyz" }),
    ];

    mockLoaders[0].getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
    mockLoaders[0].getKafkaClustersForEnvironmentId.resolves(clusters);

    const placeHolder = "Select a Juicy Kafka cluster";
    await kafkaClusterQuickPick({ placeHolder: placeHolder });

    const optionsCalledWith = showQuickPickStub.getCall(0).args[1];
    assert.strictEqual(optionsCalledWith.placeHolder, placeHolder);
  });

  it("Prefers the focused cluster if it exists", async () => {
    const clusters: KafkaCluster[] = [
      TEST_LOCAL_KAFKA_CLUSTER,
      LocalKafkaCluster.create({ ...TEST_LOCAL_KAFKA_CLUSTER, id: "local-kafka-cluster-xyz" }),
    ];

    mockLoaders[0].getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
    mockLoaders[0].getKafkaClustersForEnvironmentId.resolves(clusters);

    // Simulate a focused cluster
    const focusedCluster = clusters[1];
    const getTopicViewProviderStub = sandbox.stub().returns({ kafkaCluster: focusedCluster });
    sandbox.stub(topicsViewProviders, "getTopicViewProvider").returns(getTopicViewProviderStub());

    await kafkaClusterQuickPick();

    const itemsCalledWith = showQuickPickStub.getCall(0).args[0];

    // one separator for the single environment, two for the two clusters
    assert.strictEqual(itemsCalledWith.length, 3);
    assert.strictEqual(itemsCalledWith[0].kind, QuickPickItemKind.Separator);

    // First cluster should be the focused one, and its description should be the id.
    assert.strictEqual(itemsCalledWith[1].description, focusedCluster.id);
  });
});

describe("flinkDatabaseQuickPick", () => {
  let sandbox: sinon.SinonSandbox;

  let showQuickPickStub: sinon.SinonStub;

  const mockLoaders = [
    {
      getEnvironments: sinon.stub(),
      getKafkaClustersForEnvironmentId: sinon.stub(),
    },
  ];

  before(async () => {
    // Set up the test environment
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    const loadersStub = sandbox.stub(ResourceLoader, "loaders");
    loadersStub.returns(mockLoaders as any);
    showQuickPickStub = sandbox.stub(window, "showQuickPick");
    showQuickPickStub.resolves(undefined);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Filters out non-ccloud, non-same-provider-region clusters", async () => {
    const computePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;
    // make sure these line up, else test assumptions are wrong
    assert.equal(computePool.provider, TEST_CCLOUD_KAFKA_CLUSTER.provider);
    assert.equal(computePool.region, TEST_CCLOUD_KAFKA_CLUSTER.region);

    const localClusters = [TEST_LOCAL_KAFKA_CLUSTER];
    const ccloudClusters = [
      TEST_CCLOUD_KAFKA_CLUSTER,
      CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        id: "ccloud-kafka-cluster-xyz",
        provider: "other-provider",
        region: "other-region",
      }),
    ];

    mockLoaders[0].getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT, TEST_CCLOUD_ENVIRONMENT]);
    mockLoaders[0].getKafkaClustersForEnvironmentId.callsFake((envId: string) => {
      if (envId === TEST_LOCAL_ENVIRONMENT.id) {
        return localClusters;
      } else if (envId === TEST_CCLOUD_ENVIRONMENT.id) {
        return ccloudClusters;
      }
    });

    await flinkDatabaseQuickpick(computePool);
    const itemsCalledWith = showQuickPickStub.getCall(0).args[0];
    // one separator for the single environment, one for the single cloud
    // cluster in same provider/region.
    assert.strictEqual(itemsCalledWith.length, 2);
    assert.strictEqual(itemsCalledWith[0].kind, QuickPickItemKind.Separator);
    // other two items are the clusters. Their description should be the id.
    // and their .value should be the cluster.
    assert.strictEqual(itemsCalledWith[1].description, ccloudClusters[0].id);
    assert.strictEqual(itemsCalledWith[1].value, TEST_CCLOUD_KAFKA_CLUSTER);
  });
});
