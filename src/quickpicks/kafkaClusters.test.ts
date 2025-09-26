import * as assert from "assert";
import * as sinon from "sinon";
import { QuickPickItemKind, window } from "vscode";

import {
  getStubbedCCloudResourceLoader,
  getStubbedLocalResourceLoader,
} from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_LOCAL_ENVIRONMENT,
  TEST_LOCAL_KAFKA_CLUSTER,
} from "../../tests/unit/testResources";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { CCloudResourceLoader, LocalResourceLoader } from "../loaders";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import { EnvironmentId } from "../models/resource";
import * as topicsViewProviders from "../viewProviders/topics";
import { flinkDatabaseQuickpick, kafkaClusterQuickPick } from "./kafkaClusters";
import { QuickPickItemWithValue } from "./types";

describe("quickpicks/kafkaClusters", () => {
  let sandbox: sinon.SinonSandbox;
  let showQuickPickStub: sinon.SinonStub;

  before(async () => {
    // Set up the test environment
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    showQuickPickStub = sandbox.stub(window, "showQuickPick");
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("kafkaClusterQuickPick", () => {
    let localLoader: sinon.SinonStubbedInstance<LocalResourceLoader>;
    let ccloudLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

    beforeEach(() => {
      localLoader = getStubbedLocalResourceLoader(sandbox);
      ccloudLoader = getStubbedCCloudResourceLoader(sandbox);

      // Set ccloud as signed out by default.
      ccloudLoader.getOrganization.resolves(undefined);
      ccloudLoader.getEnvironments.resolves([]);
    });

    it("bails out early if the environment has no clusters / ccloud logged out", async () => {
      localLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
      localLoader.getKafkaClustersForEnvironmentId.resolves([]);
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
      localLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]); // mismatched id vs TEST_CCLOUD_KAFKA_CLUSTER.environmentId
      // should have included clusters referencing TEST_LOCAL_ENVIRONMENT, so will make code hit error.
      localLoader.getKafkaClustersForEnvironmentId.resolves([TEST_CCLOUD_KAFKA_CLUSTER]);

      const result = await kafkaClusterQuickPick();
      assert.strictEqual(result, undefined);
    });

    it("Offers all Kafka clusters if driven w/o a filter lambda", async () => {
      const clusters: KafkaCluster[] = [
        TEST_LOCAL_KAFKA_CLUSTER,
        LocalKafkaCluster.create({ ...TEST_LOCAL_KAFKA_CLUSTER, id: "local-kafka-cluster-xyz" }),
      ];

      localLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
      localLoader.getKafkaClustersForEnvironmentId.resolves(clusters);

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

      localLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
      localLoader.getKafkaClustersForEnvironmentId.resolves(clusters);

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

    it("should return undefined and show an info notification when filter predicate results in zero clusters", async () => {
      const clusters: KafkaCluster[] = [TEST_LOCAL_KAFKA_CLUSTER];
      localLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
      localLoader.getKafkaClustersForEnvironmentId.resolves(clusters);
      const showInformationMessageStub = sandbox
        .stub(window, "showInformationMessage")
        .resolves(undefined);

      const result = await kafkaClusterQuickPick({
        filter: (cluster: KafkaCluster) => cluster.id === "non-existent-cluster-id",
      });

      assert.strictEqual(result, undefined);
      sinon.assert.notCalled(showQuickPickStub);
      sinon.assert.calledOnce(showInformationMessageStub);
      sinon.assert.calledOnceWithMatch(
        showInformationMessageStub,
        "No Kafka clusters available.",
        sinon.match.string,
        sinon.match.string,
      );
    });

    it("Uses the provided placeHolder in the quick pick", async () => {
      const clusters: KafkaCluster[] = [
        TEST_LOCAL_KAFKA_CLUSTER,
        LocalKafkaCluster.create({ ...TEST_LOCAL_KAFKA_CLUSTER, id: "local-kafka-cluster-xyz" }),
      ];

      localLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
      localLoader.getKafkaClustersForEnvironmentId.resolves(clusters);

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

      localLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
      localLoader.getKafkaClustersForEnvironmentId.resolves(clusters);

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
    let ccloudLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;

    beforeEach(() => {
      ccloudLoader = getStubbedCCloudResourceLoader(sandbox);
    });

    afterEach(() => {
      sandbox.restore();
    });

    it("Filters out non-ccloud, non-same-provider-region clusters when called with compute pool", async () => {
      const computePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      // make sure these line up, else test assumptions are wrong
      assert.equal(computePool.provider, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.provider);
      assert.equal(computePool.region, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.region);

      const localClusters = [TEST_LOCAL_KAFKA_CLUSTER];
      const ccloudClusters = [
        TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        // One from a different provider/region, so should be filtered out.
        CCloudKafkaCluster.create({
          ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
          id: "ccloud-kafka-cluster-xyz",
          // Different provider/region
          provider: "other-provider",
          region: "other-region",
          flinkPools: [computePool],
        }),
      ];

      const TEST_CCLOUD_ENVIRONMENT_WITH_FLINK = new CCloudEnvironment({
        ...TEST_CCLOUD_ENVIRONMENT,
        flinkComputePools: [computePool],
      });

      ccloudLoader.getEnvironments.resolves([
        TEST_LOCAL_ENVIRONMENT as CCloudEnvironment, // will be filtered out as non-ccloud.
        TEST_CCLOUD_ENVIRONMENT_WITH_FLINK,
      ]);

      ccloudLoader.getKafkaClustersForEnvironmentId.callsFake(
        async (envId: EnvironmentId): Promise<CCloudKafkaCluster[]> => {
          if (envId === TEST_LOCAL_ENVIRONMENT.id) {
            return localClusters as CCloudKafkaCluster[]; // should be filtered out as non-ccloud.
          } else {
            return ccloudClusters;
          }
        },
      );

      await flinkDatabaseQuickpick(computePool);
      const itemsCalledWith = showQuickPickStub.getCall(0).args[0];
      // one separator for the single environment, one for the single cloud
      // cluster in same provider/region.
      assert.strictEqual(itemsCalledWith.length, 2);
      assert.strictEqual(itemsCalledWith[0].kind, QuickPickItemKind.Separator);
      // other two items are the clusters. Their description should be the id.
      // and their .value should be the cluster.
      assert.strictEqual(itemsCalledWith[1].description, ccloudClusters[0].id);
      assert.strictEqual(itemsCalledWith[1].value, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);
    });

    it("Filters out non-flinkable clusters when called without a compute pool", async () => {
      ccloudLoader.getEnvironments.resolves([TEST_CCLOUD_ENVIRONMENT]); // no flink.
      ccloudLoader.getKafkaClustersForEnvironmentId.callsFake(
        async (): Promise<CCloudKafkaCluster[]> => {
          return [TEST_CCLOUD_KAFKA_CLUSTER, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER];
        },
      );
      await flinkDatabaseQuickpick();
      const itemsCalledWith = showQuickPickStub.getCall(0).args[0];
      // one separator for the single environment, one for the single cloud
      // cluster that is Flinkable.
      assert.strictEqual(itemsCalledWith.length, 2);
      assert.strictEqual(itemsCalledWith[0].kind, QuickPickItemKind.Separator);
      // other two items are the clusters. Their description should be the id.
      // and their .value should be the cluster.
      assert.strictEqual(itemsCalledWith[1].description, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id);
      assert.strictEqual(itemsCalledWith[1].value, TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER);
    });

    it("should return undefined and show information message when no flinkable clusters are available", async () => {
      ccloudLoader.getEnvironments.resolves([TEST_CCLOUD_ENVIRONMENT]);
      // Return only non-flinkable clusters
      ccloudLoader.getKafkaClustersForEnvironmentId.callsFake(
        async (): Promise<CCloudKafkaCluster[]> => {
          return [TEST_CCLOUD_KAFKA_CLUSTER]; // This is not flinkable
        },
      );

      const showInformationMessageStub = sandbox
        .stub(window, "showInformationMessage")
        .resolves(undefined);

      const result = await flinkDatabaseQuickpick();

      assert.strictEqual(result, undefined);
      assert.strictEqual(
        showQuickPickStub.callCount,
        0,
        "showQuickPick should not be called when no flinkable clusters are available",
      );
      assert.strictEqual(showInformationMessageStub.callCount, 1);
      assert.strictEqual(
        showInformationMessageStub.getCall(0).args[0],
        "No Kafka clusters available.",
      );
    });

    it("should return undefined and show information message when compute pool filters out all clusters", async () => {
      const computePool = TEST_CCLOUD_FLINK_COMPUTE_POOL;

      // Create a flinkable cluster but with different provider/region than compute pool
      const differentRegionCluster = CCloudKafkaCluster.create({
        ...TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
        id: "different-region-cluster",
        provider: "different-provider",
        region: "different-region",
        flinkPools: [computePool], // Make it flinkable
      });

      ccloudLoader.getEnvironments.resolves([TEST_CCLOUD_ENVIRONMENT]);
      ccloudLoader.getKafkaClustersForEnvironmentId.callsFake(
        async (): Promise<CCloudKafkaCluster[]> => {
          return [differentRegionCluster]; // Different provider/region from compute pool
        },
      );

      const showInformationMessageStub = sandbox
        .stub(window, "showInformationMessage")
        .resolves(undefined);

      const result = await flinkDatabaseQuickpick(computePool);

      assert.strictEqual(result, undefined);
      assert.strictEqual(
        showQuickPickStub.callCount,
        0,
        "showQuickPick should not be called when compute pool filters out all clusters",
      );
      assert.strictEqual(showInformationMessageStub.callCount, 1);
      assert.strictEqual(
        showInformationMessageStub.getCall(0).args[0],
        "No Kafka clusters available.",
      );
    });
  });
});
