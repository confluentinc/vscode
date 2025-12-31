import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { stubDialog } from "electron-playwright-helpers";
import * as path from "path";
import { fileURLToPath } from "url";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import { FileExplorer } from "../objects/FileExplorer";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { FlinkDatabaseView, SelectFlinkDatabase } from "../objects/views/FlinkDatabaseView";
import { ViewItem } from "../objects/views/viewItems/ViewItem";
import { Tag } from "../tags";
import { executeVSCodeCommand } from "../utils/commands";
import { cleanupLargeFile, createLargeFile, createNonJavaJarFile } from "../utils/flinkDatabase";
import { openConfluentSidebar } from "../utils/sidebarNavigation";
import { randomHexString } from "../utils/strings";

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

  const fixturesDir = path.join(__dirname, "..", "..", "fixtures", "flink-artifacts");

  const fileSizes = [
    {
      description: "valid size artifact",
      setupFile: () => artifactPath,
      cleanupFile: (_path: string) => {
        /* no cleanup needed for fixture file */
      },
      shouldSucceed: true,
    },
    {
      description: "oversized artifact (>100MB)",
      setupFile: () => createLargeFile({ sizeInMB: 150, directory: fixturesDir }),
      cleanupFile: (filePath: string) => cleanupLargeFile(filePath),
      shouldSucceed: false,
    },
    {
      description: "invalid JAR file",
      setupFile: () => createNonJavaJarFile("invalid.jar", fixturesDir),
      cleanupFile: (filePath: string) => cleanupLargeFile(filePath),
      shouldSucceed: false,
    },
  ];

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
      entrypoint: SelectFlinkDatabase.JarFile,
      testName: "should upload Flink Artifact when initiated from JAR file in file explorer",
    },
  ];

  // Todo: add GCP, see https://github.com/confluentinc/vscode/issues/2817
  const providersWithRegions = [
    { provider: "AWS", region: "us-east-2" },
    { provider: "AZURE", region: "eastus" },
  ];

  // Test matrix: entrypoint × provider/region × file size
  for (const config of entrypoints) {
    for (const providerRegion of providersWithRegions) {
      for (const fileSizeConfig of fileSizes) {
        const { provider, region } = providerRegion;
        const testName = fileSizeConfig.shouldSucceed
          ? config.testName
          : config.testName.replace("should upload", "should reject upload of");

        test.describe(`with ${provider}/${region} - ${fileSizeConfig.description}`, () => {
          fileSizeConfig.shouldSucceed
            ? registerSuccessTest(testName, config.entrypoint, provider, region)
            : registerFailureTest(testName, config.entrypoint, provider, region, fileSizeConfig);
        });
      }
    }
  }

  function registerSuccessTest(
    testName: string,
    entrypoint: SelectFlinkDatabase,
    provider: string,
    region: string,
  ) {
    test(testName, async ({ page, electronApp }) => {
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
  }

  function registerFailureTest(
    testName: string,
    entrypoint: SelectFlinkDatabase,
    provider: string,
    region: string,
    fileSizeConfig: (typeof fileSizes)[number],
  ) {
    test(testName, async ({ page, electronApp }) => {
      const testFilePath = await fileSizeConfig.setupFile();

      try {
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
            testFilePath,
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
      } finally {
        await fileSizeConfig.cleanupFile(testFilePath);
      }
    });
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
  return await artifactsView.uploadFlinkArtifact(electronApp, artifactPath);
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
