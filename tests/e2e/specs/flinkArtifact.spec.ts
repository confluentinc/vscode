import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { stubDialog } from "electron-playwright-helpers";
import { existsSync, unlinkSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { test } from "../baseTest";
import { FileExplorer } from "../objects/FileExplorer";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { FlinkDatabaseView, SelectFlinkDatabase } from "../objects/views/FlinkDatabaseView";
import { ViewItem } from "../objects/views/viewItems/ViewItem";
import { Tag } from "../tags";
import { ConnectionType } from "../types/connection";
import { executeVSCodeCommand } from "../utils/commands";
import { createInvalidJarFile, createLargeFile } from "../utils/flinkDatabase";
import { openConfluentSidebar } from "../utils/sidebarNavigation";
import { randomHexString } from "../utils/strings";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Flink Artifacts", { tag: [Tag.CCloud, Tag.FlinkArtifacts] }, () => {
  test.use({ connectionType: ConnectionType.CCLOUD });
  test.beforeEach(async ({ connectionItem }) => {
    await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");
  });

  test.afterEach(async () => {
    // Only delete temporary test files, not permanent fixtures
    const permanentFixture = path.join(fixturesDir, "udfs-simple.jar");
    if (artifactPath && existsSync(artifactPath) && artifactPath !== permanentFixture) {
      unlinkSync(artifactPath);
    }
  });

  /** The path to an artifact created by the test suite, to be cleaned up in afterEach. */
  let artifactPath: string | undefined;

  const fixturesDir = path.join(__dirname, "..", "..", "fixtures", "flink-artifacts");

  const entrypoints = [
    {
      entrypoint: SelectFlinkDatabase.FromDatabaseViewButton,
      testName: "cluster selected from Artifacts view button",
    },
    {
      entrypoint: SelectFlinkDatabase.DatabaseFromResourcesView,
      testName: "cluster selected from the Resources view",
    },
    {
      entrypoint: SelectFlinkDatabase.ComputePoolFromResourcesView,
      testName: "cluster selected from Flink Compute Pool",
    },
    {
      entrypoint: SelectFlinkDatabase.JarFile,
      testName: "initiated from JAR file in file explorer",
    },
  ];

  // Todo: add GCP, see https://github.com/confluentinc/vscode/issues/2817
  const providersWithRegions = [
    { provider: "AWS", region: "us-east-2" },
    { provider: "AZURE", region: "eastus" },
  ];

  for (const { entrypoint, testName } of entrypoints) {
    for (const { provider, region } of providersWithRegions) {
      test(`should upload a jar and create an artifact successfully [${provider}/${region}] - ${testName}`, async ({
        page,
        electronApp,
      }) => {
        artifactPath = path.join(
          __dirname,
          "..",
          "..",
          "fixtures/flink-artifacts",
          "udfs-simple.jar",
        );

        await setupTestEnvironment(entrypoint, page, electronApp);
        const artifactsView = new FlinkDatabaseView(page);

        await artifactsView.ensureExpanded();
        await artifactsView.loadArtifacts(entrypoint);
        const uploadedArtifactName = await startUploadFlow(
          entrypoint,
          page,
          electronApp,
          artifactsView,
          provider,
          region,
          artifactPath,
        );
        await artifactsView.waitForUploadSuccess();
        const notificationArea = new NotificationArea(page);
        const successNotifications = notificationArea.infoNotifications.filter({
          hasText: "uploaded successfully",
        });
        await expect(successNotifications.first()).toBeVisible();
        const artifactViewItem = await artifactsView.getDatabaseResourceByLabel(
          uploadedArtifactName,
          artifactsView.artifactsContainer,
        );

        await expect(artifactViewItem).toBeVisible();
        await artifactsView.deleteFlinkArtifact(uploadedArtifactName);
        await expect(artifactsView.artifacts.filter({ hasText: uploadedArtifactName })).toHaveCount(
          0,
        );
      });

      test(`should fail to upload a jar exceeding the file limit [${provider}/${region}] - ${testName}`, async ({
        page,
        electronApp,
      }) => {
        artifactPath = createLargeFile({ directory: fixturesDir });
        await setupTestEnvironment(entrypoint, page, electronApp);
        const artifactsView = new FlinkDatabaseView(page);

        await artifactsView.ensureExpanded();
        await artifactsView.loadArtifacts(entrypoint);
        const initialArtifactCount = await artifactsView.artifacts.count();
        try {
          await startUploadFlow(
            entrypoint,
            page,
            electronApp,
            artifactsView,
            provider,
            region,
            artifactPath,
          );
        } catch (error) {
          // Swallow any errors from the upload flow since we expect failure
        }

        await expect(artifactsView.artifacts).toHaveCount(initialArtifactCount);

        const notificationArea = new NotificationArea(page);
        const failureNotifications: Locator = notificationArea.errorNotifications.filter({
          hasText: /Failed to upload/,
        });
        await expect(failureNotifications.first()).toBeVisible();
      });

      test(`should fail to upload a jar file containing invalid content [${provider}/${region}] - ${testName}`, async ({
        page,
        electronApp,
      }) => {
        artifactPath = createInvalidJarFile(`invalid-artifact-${Date.now()}.jar`, fixturesDir);
        await setupTestEnvironment(entrypoint, page, electronApp);
        const artifactsView = new FlinkDatabaseView(page);

        await artifactsView.ensureExpanded();
        await artifactsView.loadArtifacts(entrypoint);
        const initialArtifactCount = await artifactsView.artifacts.count();
        try {
          await startUploadFlow(
            entrypoint,
            page,
            electronApp,
            artifactsView,
            provider,
            region,
            artifactPath,
          );
        } catch (error) {
          // Swallow any errors from the upload flow since we expect failure
        }

        await expect(artifactsView.artifacts).toHaveCount(initialArtifactCount);

        const notificationArea = new NotificationArea(page);
        const failureNotifications: Locator = notificationArea.errorNotifications.filter({
          hasText: /Failed to upload/,
        });
        await expect(failureNotifications.first()).toBeVisible();
      });
    }
  }

  async function setupTestEnvironment(
    entrypoint: SelectFlinkDatabase,
    page: Page,
    electronApp: ElectronApplication,
  ): Promise<void> {
    // JAR file test requires opening the fixtures folder as a workspace
    if (entrypoint === SelectFlinkDatabase.JarFile) {
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
    provider: string,
    region: string,
    filePath: string,
  ): Promise<string> {
    switch (entrypoint) {
      case SelectFlinkDatabase.DatabaseFromResourcesView:
        return await completeArtifactUploadFlow(electronApp, filePath, artifactsView);
      case SelectFlinkDatabase.FromDatabaseViewButton:
        return await completeArtifactUploadFlow(electronApp, filePath, artifactsView);
      case SelectFlinkDatabase.ComputePoolFromResourcesView:
        return await completeUploadFlowForComputePool(
          electronApp,
          artifactsView,
          provider,
          region,
          filePath,
        );
      case SelectFlinkDatabase.JarFile:
        return await completeArtifactUploadFlowForJAR(
          page,
          filePath,
          artifactsView,
          provider,
          region,
        );
    }
  }

  async function completeUploadFlowForComputePool(
    electronApp: ElectronApplication,
    artifactsView: FlinkDatabaseView,
    provider: string,
    region: string,
    filePath: string,
  ): Promise<string> {
    await artifactsView.clickUploadFromComputePool(provider, region);
    // Skip initiation since the upload modal was already opened via the compute pool context menu
    const uploadedArtifactName = await artifactsView.uploadFlinkArtifact(
      electronApp,
      filePath,
      true,
    );

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
  return await artifactsView.uploadFlinkArtifact(electronApp, artifactPath, false);
}

/**
 * Complete the artifact upload flow when initiated from a JAR file in the file explorer.
 * This function handles the quickpick navigation and then selects the Flink database.
 */
async function completeArtifactUploadFlowForJAR(
  page: Page,
  artifactPath: string,
  artifactsView: FlinkDatabaseView,
  provider: string,
  region: string,
): Promise<string> {
  // Use the artifact file name (without extension) as the artifact name
  const baseFileName = path.basename(artifactPath, ".jar");
  // Add random suffix to avoid conflicts during development
  const artifactName = `${baseFileName}-${randomHexString(6)}`;

  const fileExplorer = new FileExplorer(page);
  await fileExplorer.ensureVisible();
  const jarFile = fileExplorer.treeItems.filter({ hasText: path.basename(artifactPath) });
  await expect(jarFile).toHaveCount(1);
  await expect(jarFile).not.toHaveAttribute("aria-expanded");
  const fileItem = new ViewItem(page, jarFile);
  await fileItem.rightClickContextMenuAction("Upload Flink Artifact to Confluent Cloud");

  await artifactsView.uploadFlinkArtifactFromJAR(artifactName, `${provider}/${region}`);

  // Switch back to the Confluent extension sidebar from the file explorer
  await openConfluentSidebar(page);

  await artifactsView.clickSelectKafkaClusterAsFlinkDatabase();
  const kafkaClusterQuickpick = new Quickpick(page);
  await expect(kafkaClusterQuickpick.locator).toBeVisible();
  await expect(kafkaClusterQuickpick.items).not.toHaveCount(0);
  const matchingCluster = kafkaClusterQuickpick.items
    .filter({ hasText: `${provider}/${region}` })
    .first();
  await expect(matchingCluster).toBeVisible();
  await matchingCluster.click();

  return artifactName;
}
