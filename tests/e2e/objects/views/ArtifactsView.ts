import { expect, Locator, Page } from "@playwright/test";
import { ConnectionType } from "../../connectionTypes";
import { ResourcesView } from "./ResourcesView";
import { View } from "./View";
import { KafkaClusterItem } from "./viewItems/KafkaClusterItem";

export enum SelectFlinkDatabase {
  FromResourcesView = "Flink database action from the Resources view",
  FromArtifactsViewButton = "Artifacts view nav action",
}

const TEST_ENV_NAME = "flink-testing-env";
const TEST_COMPUTE_POOL_NAME = "azure-pool";
const TEST_KAFKA_CLUSTER_NAME = "azure-cluster";
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

  get ccloudKafkaClusters(): Locator {
    // Search from the entire page instead of just this view's tree items
    return this.page
      .locator('[role="treeitem"]')
      .filter({ has: this.page.locator(".codicon-confluent-kafka-cluster") })
      .and(this.page.locator("[aria-level='3'][aria-label^='CCLOUD connection: Kafka Cluster']"));
  }

  async loadArtifacts(
    connectionType: ConnectionType,
    entrypoint: SelectFlinkDatabase,
    clusterLabel?: string | RegExp,
  ): Promise<void> {
    const resourcesView = new ResourcesView(this.page);
    // First, expand the CCloud env
    await expect(resourcesView.ccloudEnvironments).not.toHaveCount(0);
    await resourcesView.ccloudEnvironments.getByText(TEST_ENV_NAME).click();
    // TODO: add second entrypoint option to select from the Artifacts view button
    switch (entrypoint) {
      case SelectFlinkDatabase.FromResourcesView: {
        let kafkaClusters: Locator;
        kafkaClusters = this.ccloudKafkaClusters;

        const kafkaClusterItem = kafkaClusters.filter({ hasText: clusterLabel });
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
