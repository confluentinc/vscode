import type { ElectronApplication, Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { stubDialog } from "electron-playwright-helpers";
import path from "path";
import {
  CCLOUD_ENVIRONMENT_NAME,
  CCLOUD_FLINK_COMPUTE_POOLS,
  CCLOUD_KAFKA_CLUSTER_NAME,
  CCLOUD_KAFKA_CLUSTERS,
  findCCloudResource,
} from "../../test-resources";
import { ConnectionType } from "../../types/connection";
import { e2eResourceName } from "../../utils/uniqueName";
import { NotificationArea } from "../notifications/NotificationArea";
import { InputBox } from "../quickInputs/InputBox";
import { Quickpick } from "../quickInputs/Quickpick";
import { ResourcesView } from "./ResourcesView";
import { SearchableView } from "./View";
import { FlinkComputePoolItem } from "./viewItems/FlinkComputePoolItem";
import { KafkaClusterItem } from "./viewItems/KafkaClusterItem";
import { ViewItem } from "./viewItems/ViewItem";

export enum SelectFlinkDatabase {
  DatabaseFromResourcesView = "Flink database action from the Resources view",
  FromDatabaseViewButton = "Flink Database view nav action",
  ComputePoolFromResourcesView = "Compute pool action from the Resources view",
  JarFile = "JAR file from file explorer",
}

/**
 * Object representing the "Flink Database tree view"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view} in the "Confluent"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container}.
 * Provides access to Flink artifact items and actions within the view.
 */
export class FlinkDatabaseView extends SearchableView {
  constructor(page: Page) {
    super(page, /Flink Database.*Section/);
  }

  /** Get the Artifacts container item. */
  get artifactsContainer(): Locator {
    return this.treeItems.filter({ hasText: "Artifacts" }).first();
  }

  /** Artifact items within the Artifacts container based on their accessibilityInformation label. */
  get artifacts(): Locator {
    return this.treeItems.and(this.page.locator('[aria-label^="Flink Artifact: "]'));
  }

  /** Get the UDFs container item. */
  get udfsContainer(): Locator {
    return this.treeItems.filter({ hasText: /^UDFs/ }).first();
  }

  /** UDF items based on their accessibilityInformation label. */
  get udfs(): Locator {
    return this.treeItems.and(this.page.locator('[aria-label^="Flink UDF: "]'));
  }

  /**
   * Load the Flink Artifacts view by selecting a Kafka cluster as the Flink database,
   * using the specified entrypoint.
   * @param entrypoint - The method to select the Kafka cluster
   * @param clusterLabel - Optional cluster name to identify the Kafka cluster in the quickpick
   * @returns The provider/region string if using ComputePoolFromResourcesView, undefined otherwise
   */
  async loadArtifacts(
    entrypoint: SelectFlinkDatabase,
    clusterLabel?: string,
  ): Promise<string | undefined> {
    switch (entrypoint) {
      case SelectFlinkDatabase.DatabaseFromResourcesView:
        await this.selectFlinkDBFromResourcesView(clusterLabel);
        break;
      case SelectFlinkDatabase.FromDatabaseViewButton:
        await this.clickClusterItemFromSelectedDB(clusterLabel);
        break;
      case SelectFlinkDatabase.ComputePoolFromResourcesView:
        return;
      case SelectFlinkDatabase.JarFile:
        return;
      default:
        throw new Error(`Unsupported entrypoint: ${entrypoint}`);
    }
  }

  /**
   * Load artifacts by selecting a Kafka cluster from the Resources view.
   * @param clusterLabel - Optional cluster name to identify the Kafka cluster
   */
  private async selectFlinkDBFromResourcesView(clusterLabel?: string): Promise<void> {
    const resourcesView = new ResourcesView(this.page);
    await resourcesView.expandConnectionEnvironment(ConnectionType.Ccloud);

    const flinkableClusters = resourcesView.ccloudFlinkableKafkaClusters;
    await expect(flinkableClusters).not.toHaveCount(0);

    // default to the configured cluster name for CCloud and require an exact single match, so a
    // substring can't pick another env's flinkable cluster
    const label = clusterLabel ?? CCLOUD_KAFKA_CLUSTER_NAME;
    const matchingClusters = flinkableClusters.filter({ hasText: label });
    await expect(matchingClusters).toHaveCount(1);
    const clusterItem = new KafkaClusterItem(this.page, matchingClusters.first());
    await clusterItem.selectAsFlinkDatabase();
  }

  /**
   * Clicks the upload action from a Flink Compute Pool item in the Resources view.
   */
  async clickUploadFromComputePool(provider: string, region: string): Promise<void> {
    const resourcesView = new ResourcesView(this.page);
    // select the pool by its unique configured name via the shared, exact-match helper, so we
    // can't grab another env's pool
    const poolName = findCCloudResource(CCLOUD_FLINK_COMPUTE_POOLS, provider, region).name;
    const computePoolLocator = await resourcesView.getFlinkComputePool(
      ConnectionType.Ccloud,
      poolName,
    );
    const computePoolItem = new FlinkComputePoolItem(this.page, computePoolLocator);
    await computePoolItem.rightClickContextMenuAction("Upload Flink Artifact to Confluent Cloud");
  }

  /**
   * Click the "Select Kafka Cluster as Flink Database" nav action in the view title area and pick
   * a Kafka cluster from the resulting quickpick. Defaults to the configured cluster name for
   * CCloud so a `.first()` match can't land on another env's cluster.
   * @param clusterLabel - Optional cluster name to identify the Kafka cluster
   */
  private async clickClusterItemFromSelectedDB(clusterLabel?: string): Promise<void> {
    await this.clickSelectKafkaClusterAsFlinkDatabase();

    const kafkaClusterQuickpick = new Quickpick(this.page);
    await expect(kafkaClusterQuickpick.locator).toBeVisible();

    const label = clusterLabel ?? CCLOUD_KAFKA_CLUSTER_NAME;
    await kafkaClusterQuickpick.selectItemByText(label, { exact: true });
  }

  /**
   * Upload a Flink artifact JAR file to Confluent Cloud.
   * Clicks the upload button in the view title area, navigates through the quickpick steps,
   * and selects the specified JAR file.
   * @param electronApp - The Electron application instance
   * @param filePath - The path to the JAR file to upload
   * @param skipInitiation - If true, skips clicking the upload button (assumes quickpick is already open)
   * @returns The name of the uploaded artifact
   */
  async uploadFlinkArtifact(
    electronApp: ElectronApplication,
    filePath: string,
    skipInitiation = false,
  ): Promise<string> {
    if (!skipInitiation) {
      await this.initiateUpload();
    }
    await this.selectJarFile(electronApp, filePath);
    const artifactName = await this.enterArtifactName(filePath);
    await this.confirmUpload();
    return artifactName;
  }

  /**
   * Click the "Select Kafka Cluster" nav action in the view title area, which will show a
   * quickpick with a list of Kafka cluster items.
   */
  async clickSelectKafkaClusterAsFlinkDatabase(): Promise<void> {
    await this.clickNavAction("Select Kafka Cluster as Flink Database");
  }

  /**
   * Select a Kafka cluster as the Flink database, pinned to the uniquely-named cluster configured
   * for the given `provider`/`region` in {@linkcode CCLOUD_KAFKA_CLUSTERS}, so we can't pick
   * another env's cluster.
   * @param provider - The cloud provider (e.g., "AWS", "AZURE", "GCP")
   * @param region - The region (e.g., "us-east-2", "eastus")
   */
  async selectKafkaClusterByProviderRegion(provider: string, region: string): Promise<void> {
    await this.clickSelectKafkaClusterAsFlinkDatabase();

    const kafkaClusterQuickpick = new Quickpick(this.page);
    await expect(kafkaClusterQuickpick.locator).toBeVisible();

    // select by the configured cluster's unique name: the quickpick lists clusters from every
    // visible env, and names differ across envs, so matching by name can't grab another env's
    // cluster the way a provider/region + `.first()` match would
    const clusterName = findCCloudResource(CCLOUD_KAFKA_CLUSTERS, provider, region).name;
    await kafkaClusterQuickpick.selectItemByText(clusterName, { exact: true });
  }

  /** Get a database resource item by its label/name, optionally within a given container. */
  async getDatabaseResourceByLabel(label: string, container?: Locator) {
    if (container) {
      await this.waitForContainerLoaded(container.first());
    }
    return await this.getItemByLabel(label);
  }

  /** Expand a given container item if it is not already expanded. */
  private async expandContainer(container: Locator): Promise<void> {
    await expect(container).toBeVisible();

    const isExpanded = await container.getAttribute("aria-expanded");
    // containers are always Collapsed by default, so we don't need to check for null here
    if (isExpanded === "false") {
      await container.click();
      await expect(container).toHaveAttribute("aria-expanded", "true");
    }
  }

  /** Expand the Artifacts container to show any available artifact items. */
  async expandArtifactsContainer(): Promise<void> {
    await this.expandContainer(this.artifactsContainer);
  }

  /** Expand the UDFs container to show any available UDF tree items. */
  async expandUdfsContainer(): Promise<void> {
    await this.expandContainer(this.udfsContainer);
  }

  /**
   * Run the "Register As UDF" guided flow for the given artifact, providing `className` and
   * `functionName` to the series of quickinput boxes.
   */
  async startGuidedUdfCreation(
    artifactName: string,
    className: string,
    functionName: string,
  ): Promise<void> {
    await this.expandArtifactsContainer();
    const artifactLocator = this.artifacts.filter({ hasText: artifactName });
    await expect(artifactLocator).toHaveCount(1);
    const artifactItem = new ViewItem(this.page, artifactLocator.first());
    await artifactItem.rightClickContextMenuAction("Register As UDF");

    const classNameInput = new InputBox(this.page);
    await expect(classNameInput.locator).toBeVisible();
    await classNameInput.input.fill(className);
    await classNameInput.confirm();

    const functionNameInput = new InputBox(this.page);
    await expect(functionNameInput.locator).toBeVisible();
    await functionNameInput.input.fill(functionName);
    await functionNameInput.confirm();
  }

  /** Open the "Register With Flink SQL" document for the given artifact. */
  async openUdfRegistrationDocument(artifactName: string): Promise<void> {
    await this.expandArtifactsContainer();
    const artifactLocator = this.artifacts.filter({ hasText: artifactName });
    await expect(artifactLocator).toHaveCount(1);
    const artifactItem = new ViewItem(this.page, artifactLocator.first());
    await artifactItem.rightClickContextMenuAction("Register With Flink SQL");
  }

  /** Delete a Flink UDF via its tree-item context menu. */
  async deleteFlinkUdf(functionName: string): Promise<void> {
    const udfLocator = await this.getItemByLabel(functionName);
    const udfItem = new ViewItem(this.page, udfLocator);
    await udfItem.locator.scrollIntoViewIfNeeded();
    await expect(udfItem.locator).toBeVisible();

    await udfItem.rightClickContextMenuAction("Delete UDF");
    const notificationArea = new NotificationArea(this.page);
    const successNotifications = notificationArea.infoNotifications.filter({
      hasText: "deleted successfully",
    });
    await expect(successNotifications).not.toHaveCount(0);
  }

  /**
   * Click the upload button on the Artifacts container to initiate the artifact upload flow.
   */
  private async initiateUpload(): Promise<void> {
    const container = this.artifactsContainer;
    const containerItem = new ViewItem(this.page, container);
    await containerItem.clickInlineAction("Upload Flink Artifact to Confluent Cloud");

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

    // e2eResourceName adds the shared `e2e-vscode-` prefix and a random suffix.
    const fullArtifactName = e2eResourceName(path.basename(filePath, ".jar"));

    const inputBox = new InputBox(this.page);
    await expect(inputBox.locator).toBeVisible();
    await inputBox.input.fill(fullArtifactName);
    await inputBox.confirm();

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
  async waitForUploadSuccess(): Promise<void> {
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
    const artifactLocator = await this.getItemByLabel(artifactName);
    const artifactItem = new ViewItem(this.page, artifactLocator);
    await artifactItem.locator.scrollIntoViewIfNeeded();
    await expect(artifactItem.locator).toBeVisible();

    // Trigger the context menu delete action
    // The rightClickContextMenuAction uses Enter key which auto-confirms the modal
    await artifactItem.rightClickContextMenuAction("Delete Artifact");
    const notificationArea = new NotificationArea(this.page);
    const successNotifications = notificationArea.infoNotifications.filter({
      hasText: "deleted successfully",
    });
    await expect(successNotifications).not.toHaveCount(0);
  }

  /**
   * Upload a Flink artifact JAR file from the VS Code file explorer.
   * Navigates through the quickpick steps after the upload has been initiated from a JAR file.
   * @param artifactName - The name of the uploaded artifact (for verification)
   * @param providerRegion - Optional provider/region to match (e.g., "AWS/us-east-2")
   * @returns The name of the uploaded artifact
   */
  async uploadFlinkArtifactFromJAR(artifactName: string, providerRegion?: string): Promise<string> {
    // Wait for the quickpick to appear
    const quickpick = new Quickpick(this.page);
    await expect(quickpick.locator).toBeVisible();

    // Step 1: Select Environment - pin to the configured env instead of `.first()`, which could
    // upload the artifact to another env (e.g. mcp-test-env) than the one the test later views
    const environmentItem = quickpick.items.filter({ hasText: "1. Select Environment" }).first();
    await expect(environmentItem).toBeVisible();
    await environmentItem.click();

    await expect(quickpick.locator).toBeVisible();
    await quickpick.selectItemByText(CCLOUD_ENVIRONMENT_NAME, { exact: true });

    // Step 2: Select Cloud Provider & Region
    await expect(quickpick.locator).toBeVisible();
    const cloudRegionItem = quickpick.items
      .filter({ hasText: "2. Select Cloud Provider & Region" })
      .first();
    await expect(cloudRegionItem).toBeVisible();
    await cloudRegionItem.click();

    await expect(quickpick.locator).toBeVisible();
    await expect(quickpick.items).not.toHaveCount(0);
    const provider: string = providerRegion ? providerRegion.split("/")[0] : "";
    const providerRegionItem = providerRegion
      ? quickpick.items.filter({ hasText: provider }).first()
      : quickpick.items.first();
    await providerRegionItem.click();

    // Step 3 (JAR file) should already be completed
    // since we initiated from a JAR file

    // Step 4 (Artifact Name) needs to be completed or the old artifact name remains
    const nameItem = quickpick.items.filter({ hasText: "4. Artifact Name" }).first();
    await expect(nameItem).toBeVisible();
    await nameItem.click();

    const inputBox = new InputBox(this.page);
    await expect(inputBox.locator).toBeVisible();
    await inputBox.input.fill(artifactName);
    await inputBox.confirm();

    // Click "Upload Artifact" button
    await expect(quickpick.locator).toBeVisible();
    const uploadAction = quickpick.items.filter({ hasText: "Upload Artifact" }).first();
    await expect(uploadAction).toBeVisible();
    await uploadAction.click();

    return artifactName;
  }
}
