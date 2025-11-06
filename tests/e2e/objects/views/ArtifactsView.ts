import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { ConnectionType } from "../../connectionTypes";
import { Quickpick } from "../quickInputs/Quickpick";
import { ResourcesView } from "./ResourcesView";
import { View } from "./View";
import { KafkaClusterItem } from "./viewItems/KafkaClusterItem";

export enum SelectFlinkDatabase {
  FromResourcesView = "Flink database action from the Resources view",
  FromArtifactsViewButton = "Artifacts view nav action",
}

/**
 * Object representing the "Artifacts tree view"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view} in the "Confluent"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container}.
 */
export class ArtifactsView extends View {
  constructor(page: Page) {
    super(page, /Flink Database.*Section/);
  }

  /** Get all (root-level) artifact items in the view. */
  get artifacts(): Locator {
    return this.treeItems;
  }

  /**
   * Click the "Select Kafka Cluster" nav action in the view title area, which will show a
   * quickpick with a list of Kafka cluster items.
   */
  async clickSelectKafkaClusterAsFlinkDatabase(): Promise<void> {
    await this.clickNavAction("Select Kafka Cluster as Flink Database");
  }

  /** Click the "Switch to Flink Artifacts" nav action in the view title area. */
  async clickSwitchToFlinkArtifacts(): Promise<void> {
    const expandToggle = this.locator.locator(
      '[title="Switch View Mode"], [aria-label="Switch View Mode"]',
    );
    await expandToggle.click();
    const menuItem = this.page
      .locator(".context-view .monaco-menu .monaco-action-bar .action-item")
      .filter({
        hasText: "Switch to Flink Artifacts",
      });
    await menuItem.first().hover();
    // clicking doesn't work here, so use keyboard navigation instead:
    await this.page.keyboard.press("Enter");
  }

  async loadArtifacts(
    entrypoint: SelectFlinkDatabase,
    clusterLabel?: string | RegExp,
  ): Promise<void> {
    switch (entrypoint) {
      case SelectFlinkDatabase.FromResourcesView: {
        const resourcesView = new ResourcesView(this.page);
        await resourcesView.expandConnectionEnvironment(ConnectionType.Ccloud);

        const flinkableClusters = resourcesView.ccloudFlinkableKafkaClusters;
        await expect(flinkableClusters).not.toHaveCount(0);

        const clusterItem = new KafkaClusterItem(this.page, flinkableClusters.first());
        await clusterItem.selectAsFlinkDatabase();
        await this.clickSwitchToFlinkArtifacts();
        break;
      }
      case SelectFlinkDatabase.FromArtifactsViewButton: {
        await this.clickSelectKafkaClusterAsFlinkDatabase();

        const kafkaClusterQuickpick = new Quickpick(this.page);
        await expect(kafkaClusterQuickpick.locator).toBeVisible();
        await expect(kafkaClusterQuickpick.items).not.toHaveCount(0);
        const clusterItem = clusterLabel
          ? kafkaClusterQuickpick.items.filter({ hasText: clusterLabel }).first()
          : kafkaClusterQuickpick.items.first();
        await clusterItem.click();
        await this.clickSwitchToFlinkArtifacts();
        break;
      }
      default:
        throw new Error(`Unsupported entrypoint: ${entrypoint}`);
    }
  }
  /**
   * Upload a Flink artifact JAR file to Confluent Cloud.
   * Clicks the upload button in the view title area, navigates through the quickpick steps,
   * and selects the specified JAR file.
   */
  async uploadFlinkArtifact(filePath: string): Promise<void> {
    const uploadButton = this.page.locator(
      'a.action-label.codicon.codicon-cloud-upload[aria-label="Upload Flink Artifact to Confluent Cloud"]',
    );

    await uploadButton.click();
    const quickpick = new Quickpick(this.page);
    await expect(quickpick.locator).toBeVisible();
    await expect(quickpick.items).not.toHaveCount(0);

    // Select the first environment (or you can add a parameter to specify which one)
    await quickpick.items.first().click();

    // Step 2: Select Compute Pool
    await expect(quickpick.locator).toBeVisible();
    await expect(quickpick.items).not.toHaveCount(0);

    // Select the first compute pool (or you can add a parameter to specify which one)
    await quickpick.items.first().click();

    // Step 3: Select JAR File
    await expect(quickpick.locator).toBeVisible();
    const jarFileOption = quickpick.items
      .filter({
        hasText: "Select JAR File",
      })
      .first();
    await jarFileOption.click();

    // Now the file picker should appear
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);
  }
  async deleteFlinkArtifact(artifactName: string): Promise<void> {
    const artifactItem = this.artifacts.filter({ hasText: artifactName }).first();

    // Right-click on the artifact item to open context menu
    await artifactItem.click({ button: "right" });

    // Wait for context menu to appear and click delete option
    const contextMenu = this.page.locator(".monaco-menu, .context-menu");
    await expect(contextMenu).toBeVisible();

    const deleteAction = contextMenu.locator(
      '[aria-label*="Delete"], [title*="Delete"], text="Delete Flink Artifact"',
    );
    await expect(deleteAction).toBeVisible();
    await deleteAction.click();

    // Handle any confirmation dialog if it appears
    const confirmDialog = this.page.locator(".monaco-dialog, .confirm-dialog");
    if (await confirmDialog.isVisible()) {
      const confirmButton = confirmDialog.locator(
        'button:has-text("Delete"), button:has-text("OK"), button:has-text("Yes")',
      );
      await confirmButton.click();
    }
  }
}
