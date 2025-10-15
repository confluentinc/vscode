import { expect, Locator, Page } from "@playwright/test";
import { ConnectionType } from "../../connectionTypes";
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
    super(page, /Artifacts.*Section/);
  }

  /** Get all (root-level) artifact items in the view. */
  get artifacts(): Locator {
    return this.treeItems;
  }

  async clickArtifactsView(): Promise<void> {
    // Note: eventually might want to switch on entrypoints
    const artifactsView = new ArtifactsView(this.page);
    await artifactsView.header.click();

    await expect(this.header).toHaveAttribute("aria-expanded", "true");
    await expect(this.body).toBeVisible();
  }

  async loadArtifacts(entrypoint: SelectFlinkDatabase): Promise<void> {
    switch (entrypoint) {
      case SelectFlinkDatabase.FromResourcesView: {
        const resourcesView = new ResourcesView(this.page);

        // First, ensure the connection environment is expanded to see environments
        await resourcesView.expandConnectionEnvironment(ConnectionType.Ccloud);

        // Get all environments and expand them to see their clusters
        const environments = resourcesView.ccloudEnvironments;
        const envCount = await environments.count();

        // Expand all environments to reveal their child clusters
        for (let i = 0; i < envCount; i++) {
          const env = environments.nth(i);
          const isExpanded = await env.getAttribute("aria-expanded");

          if (isExpanded !== "true") {
            await env.click();
            // Wait for expansion to complete
            await expect(env).toHaveAttribute("aria-expanded", "true");
          }
        }

        // Now find and click on the actual Kafka cluster that has Flink compute pools
        const kafkaClusters = resourcesView.flinkableCcloudKafkaClustersByProximity;

        const kafkaClusterItem = kafkaClusters.first();

        await expect(kafkaClusterItem).toBeVisible();
        const clusterItem = new KafkaClusterItem(this.page, kafkaClusterItem);
        await clusterItem.selectAsFlinkDatabase();

        await expect(this.header).toHaveAttribute("aria-expanded", "true");
        await expect(this.body).toBeVisible();
        await expect(async () => {
          const artifactCount = await this.artifacts.count();
          const hasLoadingIndicator = await this.body
            .locator('.loading, .spinner, [aria-label*="loading"]')
            .isVisible();

          // Either we have artifacts loaded OR we're still in a loading state
          // This ensures we don't exit while artifacts are still being fetched
          expect(artifactCount > 0 || !hasLoadingIndicator).toBeTruthy();
          // timeout 0 means we wait indefinitely for one of the conditions to be true
        }).toPass({ timeout: 0 });

        break;
      }
      default:
        throw new Error(`Unsupported entrypoint: ${entrypoint}`);
    }
  }
}
