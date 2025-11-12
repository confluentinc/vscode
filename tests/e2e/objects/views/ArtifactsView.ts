import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { stubDialog } from "electron-playwright-helpers";
import path from "path";
import { ConnectionType } from "../../connectionTypes";
import { NotificationArea } from "../notifications/NotificationArea";
import { Quickpick } from "../quickInputs/Quickpick";
import { ResourcesView } from "./ResourcesView";
import { View } from "./View";
import { KafkaClusterItem } from "./viewItems/KafkaClusterItem";
import { ViewItem } from "./viewItems/ViewItem";

export enum SelectFlinkDatabase {
  DatabaseFromResourcesView = "Flink database action from the Resources view",
  FromArtifactsViewButton = "Artifacts view nav action",
}

/**
 * Object representing the "Flink Database tree view"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view} in the "Confluent"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container}.
 * Provides access to Flink artifact items and actions within the view.
 */
export class FlinkDatabaseView extends View {
  constructor(page: Page) {
    super(page, /Flink Database.*Section/);
  }

  /** Get all (root-level) artifact items in the Flink Artifacts section. */
  get artifacts(): Locator {
    // Target the Flink Artifacts section specifically, not the Flink Database section
    return this.treeItems;
  }

  /**
   * Load the Flink Artifacts view by selecting a Kafka cluster as the Flink database,
   * using the specified entrypoint.
   * @param entrypoint - The method to select the Kafka cluster
   * @param clusterLabel - Optional label or regex to identify the Kafka cluster in the quickpick
   */
  async loadArtifacts(
    entrypoint: SelectFlinkDatabase,
    clusterLabel?: string | RegExp,
  ): Promise<void> {
    switch (entrypoint) {
      case SelectFlinkDatabase.DatabaseFromResourcesView:
        await this.loadArtifactsFromResourcesView(clusterLabel);
        break;
      case SelectFlinkDatabase.FromArtifactsViewButton:
        await this.loadArtifactsFromButton(clusterLabel);
        break;
      default:
        throw new Error(`Unsupported entrypoint: ${entrypoint}`);
    }
  }

  /**
   * Load artifacts by selecting a Kafka cluster from the Resources view.
   * @param clusterLabel - Optional label or regex to identify the Kafka cluster
   */
  private async loadArtifactsFromResourcesView(clusterLabel?: string | RegExp): Promise<void> {
    const resourcesView = new ResourcesView(this.page);
    await resourcesView.expandConnectionEnvironment(ConnectionType.Ccloud);

    const flinkableClusters = resourcesView.ccloudFlinkableKafkaClusters;
    await expect(flinkableClusters).not.toHaveCount(0);

    const clusterLocator = clusterLabel
      ? flinkableClusters.filter({ hasText: clusterLabel }).first()
      : flinkableClusters.first();
    const clusterItem = new KafkaClusterItem(this.page, clusterLocator);
    await clusterItem.selectAsFlinkDatabase();
  }

  /**
   * Load artifacts by selecting a Kafka cluster from the Artifacts view button.
   * @param clusterLabel - Optional label or regex to identify the Kafka cluster
   */
  private async loadArtifactsFromButton(clusterLabel?: string | RegExp): Promise<void> {
    await this.clickSelectKafkaClusterAsFlinkDatabase();

    const kafkaClusterQuickpick = new Quickpick(this.page);
    await expect(kafkaClusterQuickpick.locator).toBeVisible();
    await expect(kafkaClusterQuickpick.items).not.toHaveCount(0);

    const clusterItem = clusterLabel
      ? kafkaClusterQuickpick.items.filter({ hasText: clusterLabel }).first()
      : kafkaClusterQuickpick.items.first();
    await clusterItem.click();
  }

  /**
   * Upload a Flink artifact JAR file to Confluent Cloud.
   * Clicks the upload button in the view title area, navigates through the quickpick steps,
   * and selects the specified JAR file.
   * @param electronApp - The Electron application instance
   * @param filePath - The path to the JAR file to upload
   * @returns The name of the uploaded artifact
   */
  async uploadFlinkArtifact(electronApp: ElectronApplication, filePath: string): Promise<string> {
    await this.initiateUpload();
    await this.selectJarFile(electronApp, filePath);
    const artifactName = await this.enterArtifactName(filePath);
    await this.confirmUpload();
    await this.waitForUploadSuccess();
    return artifactName;
  }

  /**
   * Click the "Select Kafka Cluster" nav action in the view title area, which will show a
   * quickpick with a list of Kafka cluster items.
   */
  async clickSelectKafkaClusterAsFlinkDatabase(): Promise<void> {
    await this.clickNavAction("Select Kafka Cluster as Flink Database");
  }

  /** Click the "Switch to Flink Artifacts" nav action in the view title area. */
  async clickSwitchToFlinkResource(
    targetLabel: string = "Switch to Flink Artifacts",
  ): Promise<void> {
    const expandToggle = this.locator.locator(
      '[title="Switch View Mode"], [aria-label="Switch View Mode"]',
    );
    await expandToggle.click();
    const menuItem = this.page
      .locator(".context-view .monaco-menu .monaco-action-bar .action-item")
      .filter({
        hasText: targetLabel,
      });
    await menuItem.first().hover();
    // clicking doesn't work here, so use keyboard navigation instead:
    await this.page.keyboard.press("Enter");

    // Update the label based on the target view mode
    if (targetLabel === "Switch to Flink Artifacts") {
      this.label = /Flink Artifacts.*Section/;
    } else if (targetLabel === "Switch to Flink Database") {
      this.label = /Flink Database.*Section/;
    }
  }

  /**
   * Click the upload button to initiate the artifact upload flow.
   */
  private async initiateUpload(): Promise<void> {
    await this.clickNavAction("Upload Flink Artifact to Confluent Cloud");

    const quickpick = new Quickpick(this.page);
    await expect(quickpick.locator).toBeVisible();
    await expect(quickpick.items).not.toHaveCount(0);
  }

  /**
   * Select the JAR file to upload using the system file dialog.
   * @param electronApp - The Electron application instance
   * @param filePath - The path to the JAR file
   */
  private async selectJarFile(electronApp: ElectronApplication, filePath: string): Promise<void> {
    const quickpick = new Quickpick(this.page);
    const selectedJarFileItem = quickpick.items.filter({ hasText: "3. Select JAR File" }).first();
    await expect(selectedJarFileItem).toBeVisible();

    await stubDialog(electronApp, "showOpenDialog", {
      filePaths: [filePath],
    });

    await selectedJarFileItem.click();
  }

  /**
   * Enter the artifact name in the quickpick input.
   * @param filePath - The path to the JAR file (used to generate the name)
   * @returns The full artifact name with random suffix
   */
  private async enterArtifactName(filePath: string): Promise<string> {
    const quickpick = new Quickpick(this.page);
    const artifactItem = quickpick.items.filter({ hasText: "4. Artifact Name" }).first();
    await expect(artifactItem).toBeVisible();
    await artifactItem.click();

    // Although this resource may be cleaned up, we append a random string to avoid name conflicts during development
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const baseFileName = path.basename(filePath, ".jar");
    const fullArtifactName = `${baseFileName}-${randomSuffix}`;

    await this.page.keyboard.type(fullArtifactName);
    await this.page.keyboard.press("Enter");

    return fullArtifactName;
  }

  /**
   * Confirm the artifact upload by clicking the upload action.
   */
  private async confirmUpload(): Promise<void> {
    const quickpick = new Quickpick(this.page);
    const uploadAction = quickpick.items.filter({ hasText: "Upload Artifact" }).first();
    await expect(uploadAction).toBeVisible();
    await uploadAction.click();
  }

  /**
   * Wait for the upload success notification to appear.
   */
  private async waitForUploadSuccess(): Promise<void> {
    const notificationArea = new NotificationArea(this.page);
    const successNotifications = notificationArea.infoNotifications.filter({
      hasText: "uploaded successfully",
    });
    await expect(successNotifications.first()).toBeVisible();
  }

  /**
   * Delete a Flink artifact from Confluent Cloud.
   * Right-clicks on the artifact item and confirms deletion via the VS Code warning dialog.
   * @param artifactName - The name of the artifact to delete
   */
  async deleteFlinkArtifact(artifactName: string): Promise<void> {
    await this.triggerDeleteAction(artifactName);
    await this.waitForDeleteSuccess();
  }

  /**
   * Trigger the delete action for a specific artifact.
   * @param artifactName - The name of the artifact to delete
   */
  private async triggerDeleteAction(artifactName: string): Promise<void> {
    const artifactLocator = this.artifacts.filter({ hasText: artifactName });
    await expect(artifactLocator).toHaveCount(1);
    const artifactItem = new ViewItem(this.page, artifactLocator.first());
    await artifactItem.locator.scrollIntoViewIfNeeded();
    await expect(artifactItem.locator).toBeVisible();

    // Trigger the context menu delete action
    // The rightClickContextMenuAction uses Enter key which auto-confirms the modal
    await artifactItem.rightClickContextMenuAction("Delete Artifact");
  }

  /**
   * Wait for the delete success notification to appear.
   */
  private async waitForDeleteSuccess(): Promise<void> {
    const notificationArea = new NotificationArea(this.page);
    const successNotifications = notificationArea.infoNotifications.filter({
      hasText: "deleted successfully",
    });
    await expect(successNotifications).not.toHaveCount(0);
  }
}
