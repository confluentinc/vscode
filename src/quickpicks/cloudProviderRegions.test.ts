import * as assert from "assert";
import sinon from "sinon";
import { QuickPickItemKind, window } from "vscode";
import {
  FcpmV2RegionListDataInner,
  FcpmV2RegionListDataInnerApiVersionEnum,
  FcpmV2RegionListDataInnerKindEnum,
} from "../clients/flinkComputePool";
import * as ccloudResourceLoader from "../loaders/ccloudResourceLoader";
import { IProviderRegion } from "../models/resource";
import { cloudProviderRegionQuickPick, regionFilter } from "./cloudProviderRegions";
import { QuickPickItemWithValue } from "./types";

describe("quickpicks/cloudProviderRegions.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("cloudProviderRegionQuickPick()", () => {
    let showQuickPickStub: sinon.SinonStub;
    let loadProviderRegionsStub: sinon.SinonStub;

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

    beforeEach(() => {
      showQuickPickStub = sandbox.stub(window, "showQuickPick");
      loadProviderRegionsStub = sandbox.stub(ccloudResourceLoader, "loadProviderRegions");
      loadProviderRegionsStub.resolves(testRegions);
    });

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
});
