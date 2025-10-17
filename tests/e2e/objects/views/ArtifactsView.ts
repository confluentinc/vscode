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
  // this func is WAY too long
  async loadArtifacts(entrypoint: SelectFlinkDatabase): Promise<void> {
    switch (entrypoint) {
      case SelectFlinkDatabase.FromResourcesView: {
        const resourcesView = new ResourcesView(this.page);

        // First, ensure the connection environment is expanded to see environments
        await resourcesView.expandConnectionEnvironment(ConnectionType.Ccloud);

        // Get all environments and expand them to find one with flinkable clusters
        const environments = resourcesView.ccloudEnvironments;
        const envCount = await environments.count();

        let foundFlinkableEnvironment = false;
        // EWWwwww
        // Expand environments one by one until we find one with flinkable clusters
        for (let i = 0; i < envCount && !foundFlinkableEnvironment; i++) {
          const env = environments.nth(i);
          const isExpanded = await env.getAttribute("aria-expanded");

          if (isExpanded !== "true") {
            await env.click();
            // Wait for expansion to complete
            await expect(env).toHaveAttribute("aria-expanded", "true");
          }

          // Check if this environment has flinkable Kafka clusters
          const kafkaClusters = resourcesView.flinkableCcloudKafkaClusters;
          const clusterCount = await kafkaClusters.count();

          if (clusterCount > 0) {
            foundFlinkableEnvironment = true;

            // Now we can proceed with the first flinkable cluster
            const kafkaClusterItem = kafkaClusters.first();
            await expect(kafkaClusterItem).toBeVisible();

            const clusterItem = new KafkaClusterItem(this.page, kafkaClusterItem);
            await clusterItem.selectAsFlinkDatabase();
          }
        }

        if (!foundFlinkableEnvironment) {
          throw new Error("No environment found with flinkable Kafka clusters");
        }

        break;
      }
      default:
        throw new Error(`Unsupported entrypoint: ${entrypoint}`);
    }
  }
}
