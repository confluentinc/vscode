import type { ElectronApplication, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import {
  FlinkDatabaseView,
  FlinkViewMode,
  SelectFlinkDatabase,
} from "../objects/views/FlinkDatabaseView";
import { Tag } from "../tags";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Flink Artifacts", { tag: [Tag.CCloud, Tag.FlinkArtifacts] }, () => {
  test.use({ connectionType: ConnectionType.Ccloud });
  test.beforeEach(async ({ connectionItem }) => {
    await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");
  });

  const artifactPath = path.join(
    __dirname,
    "..",
    "..",
    "fixtures/flink-artifacts",
    "udfs-simple.jar",
  );

  const entrypoints = [
    {
      entrypoint: SelectFlinkDatabase.FromArtifactsViewButton,
      testName: "should upload Flink Artifact when cluster selected from Artifacts view button",
    },
    {
      entrypoint: SelectFlinkDatabase.DatabaseFromResourcesView,
      testName: "should upload Flink Artifact when cluster selected from the Resources view",
    },
    {
      entrypoint: SelectFlinkDatabase.ComputePoolFromResourcesView,
      testName: "should upload Flink Artifact when cluster selected from Flink Compute Pool",
    },
  ];

  for (const config of entrypoints) {
    test(config.testName, async ({ page, electronApp }) => {
      const artifactsView = new FlinkDatabaseView(page);
      await artifactsView.ensureExpanded();
      const providerRegion = await artifactsView.loadArtifacts(config.entrypoint);
      const uploadedArtifactName = await startUploadFlow(
        config.entrypoint,
        page,
        electronApp,
        artifactsView,
        providerRegion,
      );
      await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(
        1,
      );

      await artifactsView.deleteFlinkArtifact(uploadedArtifactName);
      await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(
        0,
      );
    });
  }

  async function startUploadFlow(
    entrypoint: SelectFlinkDatabase,
    page: Page,
    electronApp: ElectronApplication,
    artifactsView: FlinkDatabaseView,
    providerRegion?: string,
  ): Promise<string> {
    switch (entrypoint) {
      case SelectFlinkDatabase.DatabaseFromResourcesView:
        return await completeArtifactUploadFlow(electronApp, artifactPath, artifactsView);
      case SelectFlinkDatabase.FromArtifactsViewButton:
        return await completeArtifactUploadFlow(electronApp, artifactPath, artifactsView);
      case SelectFlinkDatabase.ComputePoolFromResourcesView:
        if (!providerRegion) {
          throw new Error("providerRegion is required for ComputePoolFromResourcesView");
        }
        return await completeUploadFlowForComputePool(electronApp, artifactsView, providerRegion);
    }
  }

  async function completeUploadFlowForComputePool(
    electronApp: ElectronApplication,
    artifactsView: FlinkDatabaseView,
    providerRegion: string,
  ): Promise<string> {
    // Skip initiation since the upload modal was already opened via the compute pool context menu
    const uploadedArtifactName = await artifactsView.uploadFlinkArtifact(
      electronApp,
      artifactPath,
      true,
    );

    // Parse provider/region from format "PROVIDER/region" (e.g., "AWS/us-east-2")
    const [provider, region] = providerRegion.split("/");
    await artifactsView.selectKafkaClusterByProviderRegion(provider, region);
    await artifactsView.clickSwitchToFlinkResource(FlinkViewMode.Artifacts);

    await expect(artifactsView.artifacts.first()).toBeVisible();
    return uploadedArtifactName;
  }
});

async function completeArtifactUploadFlow(
  electronApp: ElectronApplication,
  artifactPath: string,
  artifactsView: FlinkDatabaseView,
): Promise<string> {
  await artifactsView.clickSwitchToFlinkResource(FlinkViewMode.Artifacts);
  const uploadedArtifactName = await artifactsView.uploadFlinkArtifact(electronApp, artifactPath);
  return uploadedArtifactName;
}
