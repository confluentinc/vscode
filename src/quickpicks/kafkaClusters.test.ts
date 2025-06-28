import * as assert from "assert";
import * as sinon from "sinon";
import { QuickPickItemKind, window } from "vscode";

import {
  getStubbedCCloudResourceLoader,
  getStubbedLocalResourceLoader,
} from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_LOCAL_ENVIRONMENT,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { CCloudResourceLoader, LocalResourceLoader } from "../loaders";
import { CCloudKafkaCluster, KafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import * as topicsViewProviders from "../viewProviders/topics";
import { flinkDatabaseQuickpick, kafkaClusterQuickPick, logger as qpLogger } from "./kafkaClusters";
import { QuickPickItemWithValue } from "./types";

describe("kafkaClusterQuickPick", () => {
  let sandbox: sinon.SinonSandbox;
  let showQuickPickStub: sinon.SinonStub;
  let stubbedLocalLoader: sinon.SinonStubbedInstance<LocalResourceLoader>;

  before(async () => {
    // Set up the test environment
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    stubbedLocalLoader = getStubbedLocalResourceLoader(sandbox);
    showQuickPickStub = sandbox.stub(window, "showQuickPick").resolves();
    showQuickPickStub.resolves(undefined);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("bails out early if the environment has no clusters", async () => {
    stubbedLocalLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
    stubbedLocalLoader.getKafkaClustersForEnvironmentId.resolves([]);
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
    stubbedLocalLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
    // should have included clusters referencing TEST_LOCAL_ENVIRONMENT, so will make code hit error.
    stubbedLocalLoader.getKafkaClustersForEnvironmentId.resolves([TEST_CCLOUD_KAFKA_CLUSTER]);

    // mock out the logger's warning method so we can prove going down into this unexpected codepath
    const loggerWarnStub = sandbox.stub(qpLogger, "warn");

    const result = await kafkaClusterQuickPick();
    assert.strictEqual(result, undefined);
    assert.strictEqual(loggerWarnStub.callCount, 1);
    assert.strictEqual(
      loggerWarnStub.getCall(0).args[0],
      `No environment found for Kafka cluster ${TEST_CCLOUD_KAFKA_CLUSTER.name}`,
    );
  });

  it("Offers all Kafka clusters if driven w/o a filter lambda", async () => {
    const clusters: KafkaCluster[] = [
      TEST_LOCAL_KAFKA_CLUSTER,
      LocalKafkaCluster.create({ ...TEST_LOCAL_KAFKA_CLUSTER, id: "local-kafka-cluster-xyz" }),
    ];

    stubbedLocalLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
    stubbedLocalLoader.getKafkaClustersForEnvironmentId.resolves(clusters);

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

    stubbedLocalLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
    stubbedLocalLoader.getKafkaClustersForEnvironmentId.resolves(clusters);

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

    stubbedLocalLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
    stubbedLocalLoader.getKafkaClustersForEnvironmentId.resolves(clusters);

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

    stubbedLocalLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
    stubbedLocalLoader.getKafkaClustersForEnvironmentId.resolves(clusters);

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
  let stubbedCCloudLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
  let showQuickPickStub: sinon.SinonStub;

  before(async () => {
    // Set up the test environment
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    stubbedCCloudLoader = getStubbedCCloudResourceLoader(sandbox);
    showQuickPickStub = sandbox.stub(window, "showQuickPick").resolves();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Filters out non-ccloud, non-same-provider-region clusters", async () => {
    const computePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;
    // make sure these line up, else test assumptions are wrong
    assert.equal(computePool.provider, TEST_CCLOUD_KAFKA_CLUSTER.provider);
    assert.equal(computePool.region, TEST_CCLOUD_KAFKA_CLUSTER.region);

    const ccloudClusters = [
      TEST_CCLOUD_KAFKA_CLUSTER,
      CCloudKafkaCluster.create({
        ...TEST_CCLOUD_KAFKA_CLUSTER,
        id: "ccloud-kafka-cluster-xyz",
        provider: "other-provider",
        region: "other-region",
      }),
    ];

    stubbedCCloudLoader.getEnvironments.resolves([TEST_CCLOUD_ENVIRONMENT]);
    stubbedCCloudLoader.getKafkaClustersForEnvironmentId.resolves(ccloudClusters);

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
