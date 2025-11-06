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

    await this.page.keyboard.press("ArrowDown");
    await this.page.keyboard.press("ArrowDown");
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
}
