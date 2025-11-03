import { expect, Locator, Page } from "@playwright/test";
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
    super(page, /Artifacts.*Section/);
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

  async loadArtifacts(
    entrypoint: SelectFlinkDatabase,
    clusterLabel?: string | RegExp,
  ): Promise<void> {
    switch (entrypoint) {
      case SelectFlinkDatabase.FromResourcesView: {
        const resourcesView = new ResourcesView(this.page);
        await resourcesView.expandConnectionEnvironment(ConnectionType.Ccloud);

        const flinkableClusters = resourcesView.flinkableCcloudKafkaClusters;
        await expect(flinkableClusters).not.toHaveCount(0);
        const clusterItem = new KafkaClusterItem(this.page, flinkableClusters.first());
        await clusterItem.selectAsFlinkDatabase();
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
        break;
      }
      default:
        throw new Error(`Unsupported entrypoint: ${entrypoint}`);
    }
  }
}
