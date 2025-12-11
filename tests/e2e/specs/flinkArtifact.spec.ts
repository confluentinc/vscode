import type { ElectronApplication, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { stubDialog } from "electron-playwright-helpers";
import * as path from "path";
import { fileURLToPath } from "url";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import { FileExplorer } from "../objects/FileExplorer";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { FlinkDatabaseView, SelectFlinkDatabase } from "../objects/views/FlinkDatabaseView";
import { ViewItem } from "../objects/views/viewItems/ViewItem";
import { Tag } from "../tags";
import { executeVSCodeCommand } from "../utils/commands";
import { openConfluentSidebar } from "../utils/sidebarNavigation";

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
      entrypoint: SelectFlinkDatabase.FromDatabaseViewButton,
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
    {
      entrypoint: SelectFlinkDatabase.JARFile,
      testName: "should upload Flink Artifact when initiated from JAR file in file explorer",
    },
  ];

  for (const config of entrypoints) {
    test(config.testName, async ({ page, electronApp }) => {
      await setupTestEnvironment(config.entrypoint, page, electronApp);

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

      // make sure Artifacts container is expanded before we check that it's uploaded (and then deleted)
      await artifactsView.expandArtifactsContainer();

      // make sure Artifacts container is expanded before we check that it's uploaded (and then deleted)
      await artifactsView.expandArtifactsContainer();
      await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(
        1,
      );

      await artifactsView.deleteFlinkArtifact(uploadedArtifactName);
      await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(
        0,
      );
    });
  }

  async function setupTestEnvironment(
    entrypoint: SelectFlinkDatabase,
    page: Page,
    electronApp: ElectronApplication,
  ): Promise<void> {
    // JAR file test requires opening the fixtures folder as a workspace
    if (entrypoint === SelectFlinkDatabase.JARFile) {
      const fixturesDir = path.join(__dirname, "..", "..", "fixtures", "flink-artifacts");

      await stubDialog(electronApp, "showOpenDialog", {
        filePaths: [fixturesDir],
      });
      await executeVSCodeCommand(page, "workbench.action.files.openFolder");

      // make sure the explorer view is visible before we activate the extension
      const explorerView = new FileExplorer(page);
      await explorerView.ensureVisible();

      // Wait for extension to reactivate so we can use the upload action
      await openConfluentSidebar(page);
    }
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
      case SelectFlinkDatabase.FromDatabaseViewButton:
        return await completeArtifactUploadFlow(electronApp, artifactPath, artifactsView);
      case SelectFlinkDatabase.ComputePoolFromResourcesView:
        if (!providerRegion) {
          throw new Error("providerRegion is required for ComputePoolFromResourcesView");
        }
        return await completeUploadFlowForComputePool(electronApp, artifactsView, providerRegion);
      case SelectFlinkDatabase.JARFile:
        return await completeArtifactUploadFlowForJAR(
          page,
          artifactPath,
          artifactsView,
          providerRegion,
        );
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
    // a Flink database is selected, so yield back to the test to expand the container and check
    // for the uploaded artifact
    return uploadedArtifactName;
  }
});

async function completeArtifactUploadFlow(
  electronApp: ElectronApplication,
  artifactPath: string,
  artifactsView: FlinkDatabaseView,
): Promise<string> {
  const uploadedArtifactName = await artifactsView.uploadFlinkArtifact(electronApp, artifactPath);
  return uploadedArtifactName;
}

/**
 * Complete the artifact upload flow when initiated from a JAR file in the file explorer.
 * This function handles the quickpick navigation and then selects the Flink database.
 */
async function completeArtifactUploadFlowForJAR(
  page: Page,
  artifactPath: string,
  artifactsView: FlinkDatabaseView,
  providerRegion?: string,
): Promise<string> {
  // Use the artifact file name (without extension) as the artifact name
  const baseFileName = path.basename(artifactPath, ".jar");
  // Add random suffix to avoid conflicts during development
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const artifactName = `${baseFileName}-${randomSuffix}`;

  const fileExplorer = new FileExplorer(page);
  await fileExplorer.ensureVisible();
  const jarFile = fileExplorer.treeItems.filter({ hasText: path.basename(artifactPath) });
  await expect(jarFile).toHaveCount(1);
  // await expect(jarFile).toHaveAttribute("aria-label", `${path.basename(artifactPath)}, File`);
  const fileItem = new ViewItem(page, jarFile);
  await fileItem.rightClickContextMenuAction("Upload Flink Artifact to Confluent Cloud");

  await artifactsView.uploadFlinkArtifactFromJAR(artifactName, providerRegion);

  // Switch back to the Confluent extension sidebar from the file explorer
  await openConfluentSidebar(page);

  await artifactsView.clickSelectKafkaClusterAsFlinkDatabase();
  const kafkaClusterQuickpick = new Quickpick(page);
  await expect(kafkaClusterQuickpick.locator).toBeVisible();
  await expect(kafkaClusterQuickpick.items).not.toHaveCount(0);
  await kafkaClusterQuickpick.items.first().click();

  return artifactName;
}
