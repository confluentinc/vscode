import * as assert from "assert";
import sinon from "sinon";
import { QuickPickItemKind, window } from "vscode";
import { TEST_CCLOUD_FLINK_COMPUTE_POOL } from "../../tests/unit/testResources/flinkComputePool";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import {
  FcpmV2RegionListDataInner,
  FcpmV2RegionListDataInnerApiVersionEnum,
  FcpmV2RegionListDataInnerKindEnum,
} from "../clients/flinkComputePool";
import * as ccloudResourceLoader from "../loaders/ccloudResourceLoader";
import { CCloudFlinkDbKafkaCluster, CCloudKafkaCluster } from "../models/kafkaCluster";
import { EnvironmentId, IProviderRegion } from "../models/resource";
import * as cloudProviderRegionsModule from "./cloudProviderRegions"; // added for stubbing exported fn
import {
  cloudProviderRegionQuickPick,
  flinkDatabaseRegionsQuickPick,
  regionFilter,
} from "./cloudProviderRegions";
import { QuickPickItemWithValue } from "./types";

describe("quickpicks/cloudProviderRegions.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let loadProviderRegionsStub: sinon.SinonStub;
  let showQuickPickStub: sinon.SinonStub;

  const testRegionDataAWS: FcpmV2RegionListDataInner = {
    api_version: FcpmV2RegionListDataInnerApiVersionEnum.FcpmV2,
    kind: FcpmV2RegionListDataInnerKindEnum.Region,
    id: "aws-us-east-1",
    metadata: {
      self: "https://api.confluent.cloud/fcpm/v2/regions/aws-us-east-1",
    },
    cloud: "AWS",
    region_name: "us-east-1",
    display_name: "US East (N. Virginia)",
    http_endpoint: "https://flink.us-east-1.aws.confluent.cloud",
  };

  const testRegionDataAzure: FcpmV2RegionListDataInner = {
    api_version: FcpmV2RegionListDataInnerApiVersionEnum.FcpmV2,
    kind: FcpmV2RegionListDataInnerKindEnum.Region,
    id: "azure-eastus",
    metadata: {
      self: "https://api.confluent.cloud/fcpm/v2/regions/azure-eastus",
    },
    cloud: "AZURE",
    region_name: "eastus",
    display_name: "East US",
    http_endpoint: "https://flink.eastus.azure.confluent.cloud",
  };

  const testRegions: FcpmV2RegionListDataInner[] = [testRegionDataAWS, testRegionDataAzure];
  before(() => {
    getTestExtensionContext();
  });
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    showQuickPickStub = sandbox.stub(window, "showQuickPick");
    loadProviderRegionsStub = sandbox.stub(ccloudResourceLoader, "loadProviderRegions");
    loadProviderRegionsStub.resolves(testRegions);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("cloudProviderRegionQuickPick()", () => {
    it("should return undefined when no regions are available", async () => {
      loadProviderRegionsStub.resolves([]);

      const result = await cloudProviderRegionQuickPick();

      assert.strictEqual(result, undefined);
      sinon.assert.calledOnce(loadProviderRegionsStub);
      sinon.assert.notCalled(showQuickPickStub);
    });

    it("should correctly set quickpick options", async () => {
      await cloudProviderRegionQuickPick();

      sinon.assert.calledOnce(showQuickPickStub);
      const options = showQuickPickStub.firstCall.args[1];
      assert.strictEqual(options.placeHolder, "Select a region");
      assert.strictEqual(options.ignoreFocusOut, true);
    });

    it("should show quickpick with regions grouped by cloud provider with separators", async () => {
      await cloudProviderRegionQuickPick();

      sinon.assert.calledOnce(loadProviderRegionsStub);
      sinon.assert.calledOnce(showQuickPickStub);

      const quickPickItems: QuickPickItemWithValue<IProviderRegion>[] =
        showQuickPickStub.firstCall.args[0];

      // Should have separators + regions: AWS separator + 1 AWS regions + AZURE separator + 1 AZURE region
      assert.strictEqual(quickPickItems.length, 4);

      // Check AWS separator
      const awsSeparator = quickPickItems[0];
      assert.strictEqual(awsSeparator.label, "AWS");
      assert.strictEqual(awsSeparator.description, "");
      assert.strictEqual(awsSeparator.kind, QuickPickItemKind.Separator);

      // Check AWS region
      const awsRegion = quickPickItems[1];
      assert.strictEqual(awsRegion.label, testRegionDataAWS.display_name);
      assert.strictEqual(awsRegion.description, testRegionDataAWS.http_endpoint);
      assert.deepStrictEqual(awsRegion.value, {
        region: testRegionDataAWS.region_name,
        provider: testRegionDataAWS.cloud,
      });

      // Check AZURE separator
      const azureSeparator = quickPickItems[2];
      assert.strictEqual(azureSeparator.label, "AZURE");
      assert.strictEqual(azureSeparator.kind, QuickPickItemKind.Separator);

      // Check AZURE region
      const azureRegion = quickPickItems[3];
      assert.strictEqual(azureRegion.label, testRegionDataAzure.display_name);
      assert.deepStrictEqual(azureRegion.value, {
        region: testRegionDataAzure.region_name,
        provider: testRegionDataAzure.cloud,
      });
    });

    it("should return the selected region", async () => {
      const expectedRegion: IProviderRegion = {
        region: testRegionDataAWS.region_name,
        provider: testRegionDataAWS.cloud,
      };
      showQuickPickStub.resolves({
        label: testRegionDataAWS.display_name,
        value: expectedRegion,
      });

      const result = await cloudProviderRegionQuickPick();

      assert.deepStrictEqual(result, expectedRegion);
    });

    it("should return undefined if no region is selected", async () => {
      showQuickPickStub.resolves(undefined);

      const result = await cloudProviderRegionQuickPick();

      assert.strictEqual(result, undefined);
    });

    it("should apply filter when provided", async () => {
      const awsOnlyFilter: regionFilter = (region) => region.cloud === "AWS";

      await cloudProviderRegionQuickPick(awsOnlyFilter);

      sinon.assert.calledOnce(showQuickPickStub);

      const quickPickItems: QuickPickItemWithValue<IProviderRegion>[] =
        showQuickPickStub.firstCall.args[0];

      // Should have only AWS separator + 1 AWS region
      assert.strictEqual(quickPickItems.length, 2);

      // Check AWS separator
      assert.strictEqual(quickPickItems[0].label, "AWS");
      assert.strictEqual(quickPickItems[0].kind, QuickPickItemKind.Separator);

      // Check AWS region is present
      assert.strictEqual(quickPickItems[1].label, testRegionDataAWS.display_name);
    });

    it("should return undefined when filter excludes all regions", async () => {
      const noMatchFilter: regionFilter = (region) => region.cloud === "NONEXISTENT";

      const result = await cloudProviderRegionQuickPick(noMatchFilter);

      assert.strictEqual(result, undefined);
      sinon.assert.notCalled(showQuickPickStub);
    });

    it("should handle regions with same cloud provider correctly", async () => {
      const awsOnlyRegion = [testRegionDataAWS];
      loadProviderRegionsStub.resolves(awsOnlyRegion);

      await cloudProviderRegionQuickPick();

      const quickPickItems: QuickPickItemWithValue<IProviderRegion>[] =
        showQuickPickStub.firstCall.args[0];

      // Should have 1 separator + 1 regions
      assert.strictEqual(quickPickItems.length, 2);

      // Verify only one AWS separator is shown
      const separators = quickPickItems.filter((item) => item.kind === QuickPickItemKind.Separator);
      assert.strictEqual(separators.length, 1);
      assert.strictEqual(separators[0].label, "AWS");
    });

    it("should handle single region correctly", async () => {
      loadProviderRegionsStub.resolves([testRegionDataAWS]);

      await cloudProviderRegionQuickPick();

      const quickPickItems: QuickPickItemWithValue<IProviderRegion>[] =
        showQuickPickStub.firstCall.args[0];

      // Should have 1 separator + 1 region
      assert.strictEqual(quickPickItems.length, 2);

      assert.strictEqual(quickPickItems[0].label, "AWS");
      assert.strictEqual(quickPickItems[0].kind, QuickPickItemKind.Separator);
      assert.strictEqual(quickPickItems[1].label, testRegionDataAWS.display_name);
    });

    it("should create separator items with correct properties", async () => {
      const mixedRegions = [testRegionDataAWS, testRegionDataAzure];
      loadProviderRegionsStub.resolves(mixedRegions);

      await cloudProviderRegionQuickPick();

      const quickPickItems: QuickPickItemWithValue<IProviderRegion>[] =
        showQuickPickStub.firstCall.args[0];

      const separators = quickPickItems.filter((item) => item.kind === QuickPickItemKind.Separator);
      assert.strictEqual(separators.length, 2);

      // Check separator properties
      separators.forEach((separator) => {
        assert.strictEqual(separator.description, "");
        assert.strictEqual(separator.kind, QuickPickItemKind.Separator);
        assert.strictEqual(separator.value, undefined);
      });
    });
  });

  describe("flinkDatabaseRegionsQuickPick()", () => {
    let getFlinkDatabasesStub: sinon.SinonStub;

    const testFlinkDbCluster1: CCloudFlinkDbKafkaCluster = CCloudKafkaCluster.create({
      id: "lkc-flink-db-1",
      name: "test-flink-db-cluster-1",
      provider: "AWS",
      region: "us-east-1",
      bootstrapServers: "SASL_SSL://pkc-flink-db-1.us-east-1.aws.confluent.cloud:9092",
      uri: "https://pkc-flink-db-1.us-east-1.aws.confluent.cloud:443",
      environmentId: "env-1" as EnvironmentId,
      flinkPools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
    }) as CCloudFlinkDbKafkaCluster;

    const testFlinkDbCluster2: CCloudFlinkDbKafkaCluster = CCloudKafkaCluster.create({
      id: "lkc-flink-db-2",
      name: "test-flink-db-cluster-2",
      provider: "AWS",
      region: "us-west-2",
      bootstrapServers: "SASL_SSL://pkc-flink-db-2.us-west-2.aws.confluent.cloud:9092",
      uri: "https://pkc-flink-db-2.us-west-2.aws.confluent.cloud:443",
      environmentId: "env-2" as EnvironmentId,
      flinkPools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
    }) as CCloudFlinkDbKafkaCluster;

    const testFlinkDbCluster3: CCloudFlinkDbKafkaCluster = CCloudKafkaCluster.create({
      id: "lkc-flink-db-3",
      name: "test-flink-db-cluster-3",
      provider: "AZURE",
      region: "eastus",
      bootstrapServers: "SASL_SSL://pkc-flink-db-3.eastus.azure.confluent.cloud:9092",
      uri: "https://pkc-flink-db-3.eastus.azure.confluent.cloud:443",
      environmentId: "env-3" as EnvironmentId,
      flinkPools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
    }) as CCloudFlinkDbKafkaCluster;

    const testFlinkDbClusters: CCloudFlinkDbKafkaCluster[] = [
      testFlinkDbCluster1,
      testFlinkDbCluster2,
      testFlinkDbCluster3,
    ];

    beforeEach(() => {
      getFlinkDatabasesStub = sandbox.stub(
        ccloudResourceLoader.CCloudResourceLoader.prototype,
        "getFlinkDatabases",
      );
      getFlinkDatabasesStub.resolves(testFlinkDbClusters);
    });

    it("should correctly set quickpick options", async () => {
      await flinkDatabaseRegionsQuickPick();

      sinon.assert.calledOnce(showQuickPickStub);
      const options = showQuickPickStub.firstCall.args[1];
      assert.strictEqual(options.placeHolder, "Select a region containing a Flink database");
      assert.strictEqual(options.ignoreFocusOut, true);
    });

    it("should show quickpick with regions grouped by cloud provider with separators", async () => {
      await flinkDatabaseRegionsQuickPick();

      sinon.assert.calledOnce(getFlinkDatabasesStub);
      sinon.assert.calledOnce(showQuickPickStub);

      const quickPickItems: QuickPickItemWithValue<IProviderRegion | "VIEW_ALL">[] =
        showQuickPickStub.firstCall.args[0];

      // Should have separators + regions + "View All" item: AWS separator + 2 AWS regions + AZURE separator + 1 AZURE region + "View All" item
      assert.strictEqual(quickPickItems.length, 6);

      // Check AWS separator
      const awsSeparator = quickPickItems[0];
      assert.strictEqual(awsSeparator.label, "AWS");
      assert.strictEqual(awsSeparator.description, "");
      assert.strictEqual(awsSeparator.kind, QuickPickItemKind.Separator);

      // Check first AWS region
      const awsRegion1 = quickPickItems[1];
      assert.strictEqual(awsRegion1.label, "AWS | us-east-1");
      assert.strictEqual(awsRegion1.description, "test-flink-db-cluster-1");
      assert.deepStrictEqual(awsRegion1.value, {
        region: "us-east-1",
        provider: "AWS",
      });

      // Check second AWS region
      const awsRegion2 = quickPickItems[2];
      assert.strictEqual(awsRegion2.label, "AWS | us-west-2");
      assert.strictEqual(awsRegion2.description, "test-flink-db-cluster-2");
      assert.deepStrictEqual(awsRegion2.value, {
        region: "us-west-2",
        provider: "AWS",
      });

      // Check AZURE separator
      const azureSeparator = quickPickItems[3];
      assert.strictEqual(azureSeparator.label, "AZURE");
      assert.strictEqual(azureSeparator.kind, QuickPickItemKind.Separator);

      // Check AZURE region
      const azureRegion = quickPickItems[4];
      assert.strictEqual(azureRegion.label, "AZURE | eastus");
      assert.strictEqual(azureRegion.description, "test-flink-db-cluster-3");
      assert.deepStrictEqual(azureRegion.value, {
        region: "eastus",
        provider: "AZURE",
      });

      // Check "View All" item
      const viewAllItem = quickPickItems[5];
      assert.strictEqual(viewAllItem.label, "View All Available Regions");
      assert.strictEqual(viewAllItem.description, "Show the complete list of regions");
      assert.strictEqual(viewAllItem.value, "VIEW_ALL");
    });

    it("should return the selected region", async () => {
      const expectedRegion: IProviderRegion = {
        region: "us-east-1",
        provider: "AWS",
      };
      showQuickPickStub.resolves({
        label: "AWS | us-east-1",
        value: expectedRegion,
      });

      const result = await flinkDatabaseRegionsQuickPick();

      assert.deepStrictEqual(result, expectedRegion);
    });

    it("should return undefined if no region is selected", async () => {
      showQuickPickStub.resolves(undefined);

      const result = await flinkDatabaseRegionsQuickPick();

      assert.strictEqual(result, undefined);
    });

    it("should call cloudProviderRegionQuickPick when 'View All' is selected", async () => {
      // Stub the higher-level quick pick instead of relying on internal loader side-effects
      const cloudProviderRegionQuickPickStub = sandbox
        .stub(cloudProviderRegionsModule, "cloudProviderRegionQuickPick")
        .resolves(undefined);

      showQuickPickStub.resolves({
        label: "View All Available Regions",
        value: "VIEW_ALL",
      });

      const result = await flinkDatabaseRegionsQuickPick();

      sinon.assert.calledOnce(cloudProviderRegionQuickPickStub); // direct assertion
      assert.strictEqual(result, undefined);
    });

    it("should filter out GCP databases", async () => {
      const gcpCluster: CCloudFlinkDbKafkaCluster = CCloudKafkaCluster.create({
        id: "lkc-flink-db-gcp",
        name: "test-flink-db-cluster-gcp",
        provider: "GCP",
        region: "us-central1",
        bootstrapServers: "SASL_SSL://pkc-flink-db-gcp.us-central1.gcp.confluent.cloud:9092",
        uri: "https://pkc-flink-db-gcp.us-central1.gcp.confluent.cloud:443",
        environmentId: "env-gcp" as EnvironmentId,
        flinkPools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
      }) as CCloudFlinkDbKafkaCluster;

      getFlinkDatabasesStub.resolves([...testFlinkDbClusters, gcpCluster]);

      await flinkDatabaseRegionsQuickPick();

      const quickPickItems: QuickPickItemWithValue<IProviderRegion | "VIEW_ALL">[] =
        showQuickPickStub.firstCall.args[0];

      // Should not include GCP region, only AWS and AZURE
      const gcpItem = quickPickItems.find(
        (item) =>
          item.kind !== QuickPickItemKind.Separator &&
          item.value !== "VIEW_ALL" &&
          (item.value as IProviderRegion).provider === "GCP",
      );
      assert.strictEqual(gcpItem, undefined);
    });

    it("should group multiple databases in the same provider/region", async () => {
      const additionalCluster: CCloudFlinkDbKafkaCluster = CCloudKafkaCluster.create({
        id: "lkc-flink-db-1b",
        name: "test-flink-db-cluster-1b",
        provider: "AWS",
        region: "us-east-1",
        bootstrapServers: "SASL_SSL://pkc-flink-db-1b.us-east-1.aws.confluent.cloud:9092",
        uri: "https://pkc-flink-db-1b.us-east-1.aws.confluent.cloud:443",
        environmentId: "env-1b" as EnvironmentId,
        flinkPools: [TEST_CCLOUD_FLINK_COMPUTE_POOL],
      }) as CCloudFlinkDbKafkaCluster;

      getFlinkDatabasesStub.resolves([...testFlinkDbClusters, additionalCluster]);

      await flinkDatabaseRegionsQuickPick();

      const quickPickItems: QuickPickItemWithValue<IProviderRegion | "VIEW_ALL">[] =
        showQuickPickStub.firstCall.args[0];

      // Find the AWS us-east-1 region item
      const awsEast1Item = quickPickItems.find(
        (item) =>
          item.kind !== QuickPickItemKind.Separator &&
          item.value !== "VIEW_ALL" &&
          (item.value as IProviderRegion).provider === "AWS" &&
          (item.value as IProviderRegion).region === "us-east-1",
      );

      assert.ok(awsEast1Item);
      // Should contain both cluster names, sorted alphabetically
      assert.strictEqual(
        awsEast1Item.description,
        "test-flink-db-cluster-1, test-flink-db-cluster-1b",
      );
    });
  });
});
