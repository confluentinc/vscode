import type { ElectronApplication } from "@playwright/test";
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

  test("should upload Flink Artifact when triggered by right-clicking on a .jar file", async ({
    page,
    electronApp,
    testTempDir,
  }) => {
    const { Quickpick } = await import("../objects/quickInputs/Quickpick");
    const { InputBox } = await import("../objects/quickInputs/InputBox");
    const { NotificationArea } = await import("../objects/notifications/NotificationArea");
    const { View } = await import("../objects/views/View");
    const { ViewItem } = await import("../objects/views/viewItems/ViewItem");
    const { copyFileSync } = await import("fs");

    // Setup: Load artifacts view and select a Flink database
    const artifactsView = new FlinkDatabaseView(page);
    await artifactsView.ensureExpanded();
    await artifactsView.loadArtifacts(SelectFlinkDatabase.FromArtifactsViewButton);

    // Copy the .jar file to the workspace so it appears in the Explorer
    const jarFileName = path.basename(artifactPath);
    const workspaceJarPath = path.join(testTempDir, jarFileName);
    copyFileSync(artifactPath, workspaceJarPath);

    // Open the Explorer view and find the .jar file
    const explorerView = new View(page, "Explorer");
    await explorerView.ensureExpanded();
    const jarFileItem = new ViewItem(page, explorerView.treeItems.filter({ hasText: jarFileName }));
    await expect(jarFileItem.locator).toBeVisible();

    // Right-click on the .jar file and select "Upload Flink Artifact"
    await jarFileItem.rightClickContextMenuAction("Upload Flink Artifact");

    // Wait for quickpick to appear with upload form
    const quickpick = new Quickpick(page);
    await expect(quickpick.locator).toBeVisible();
    await expect(quickpick.items).not.toHaveCount(0);

    // Select Flink compute pool (item 1)
    const computePoolItem = quickpick.items.filter({ hasText: "1." }).first();
    await expect(computePoolItem).toBeVisible();
    await computePoolItem.click();

    // Select Kafka cluster (item 2)
    const kafkaClusterItem = quickpick.items.filter({ hasText: "2." }).first();
    await expect(kafkaClusterItem).toBeVisible();
    await kafkaClusterItem.click();

    // Generate unique artifact name
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const baseFileName = path.basename(artifactPath, ".jar");
    const uploadedArtifactName = `${baseFileName}-${randomSuffix}`;

    // Enter the artifact name
    const artifactNameItem = quickpick.items.filter({ hasText: "3. Artifact Name" }).first();
    await expect(artifactNameItem).toBeVisible();
    await artifactNameItem.click();

    const inputBox = new InputBox(page);
    await expect(inputBox.locator).toBeVisible();
    await inputBox.input.fill(uploadedArtifactName);
    await inputBox.confirm();

    // Confirm the upload
    const uploadAction = quickpick.items.filter({ hasText: "Upload Artifact" }).first();
    await expect(uploadAction).toBeVisible();
    await uploadAction.click();

    // Wait for upload success notification
    const notificationArea = new NotificationArea(page);
    const successNotifications = notificationArea.infoNotifications.filter({
      hasText: "uploaded successfully",
    });
    await expect(successNotifications.first()).toBeVisible();

    // Verify the artifact appears in the artifacts view
    await artifactsView.clickSwitchToFlinkResource(FlinkViewMode.Artifacts);
    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(1);

    // Cleanup: delete the artifact
    await artifactsView.deleteFlinkArtifact(uploadedArtifactName);
    await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(0);
  });
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
