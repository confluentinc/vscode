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

  // <a class="action-label codicon codicon-cloud-upload" role="button" aria-label="Upload Flink Artifact to Confluent Cloud" tabindex="-1"></a>
  /** Click the "Create Artifact" nav action in the view title area. */
  async clickCreateArtifact(): Promise<void> {
    // is the the codicon the nav action?
    await this.clickNavAction("Create Artifact");
  }

  async clickSelectKafkaClusterAsFlinkDatabase(): Promise<void> {
    await this.clickNavAction("Select Kafka Cluster as Flink Database");
  }
  /** Get all (root-level) artifact items in the view. */
  get artifacts(): Locator {
    return this.treeItems;
  }

  async clickArtifactsView(): Promise<void> {
    // eventually might want to switch on entrypoints, but also maybe not for the general resources view
    const artifactsView = new ArtifactsView(this.page);
    await artifactsView.header.click();

    await expect(this.header).toHaveAttribute("aria-expanded", "true");
    await expect(this.body).toBeVisible();
  }

  async loadArtifacts(
    connectionType: ConnectionType,
    entrypoint: SelectFlinkDatabase,
    clusterLabel?: string | RegExp,
  ): Promise<void> {
    switch (entrypoint) {
      case SelectFlinkDatabase.FromResourcesView: {
        const resourcesView = new ResourcesView(this.page);
        const cluster = await resourcesView.getKafkaCluster(connectionType);
        const clusterItem = new KafkaClusterItem(this.page, cluster.first());
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
    await expect(this.header).toHaveAttribute("aria-expanded", "true");
    await expect(this.body).toBeVisible();
  }
}
