import { Page } from "@playwright/test";
import { Quickpick } from "../quickInputs/Quickpick";
import { QuickpickItem } from "../quickInputs/QuickpickItem";
import { DirectConnectionForm } from "../webviews/DirectConnectionForm";
import { View } from "./View";
import { CCloudEnvironmentItem } from "./viewItems/CCloudEnvironmentItem";
import { CCloudItem } from "./viewItems/CCloudItem";
import { KafkaClusterItem } from "./viewItems/KafkaClusterItem";
import { LocalItem } from "./viewItems/LocalItem";
import { ViewItem } from "./viewItems/ViewItem";

/**
 * Object representing the "Resources"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view} in the "Confluent"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container}.
 */
export class ResourcesView extends View {
  constructor(page: Page) {
    // we don't need a regex pattern here because we don't update the tree view title/description
    // (unlike the Topics/Schemas/Flink views that show the currently-selected env & focused resource)
    super(page, "Resources Section");
  }

  /** Click the "Search" nav action in the view title area. */
  async clickSearch(): Promise<void> {
    await this.clickNavAction("Search");
  }

  /** Click the "Add New Connection" nav action in the view title area. */
  async clickAddNewConnection(): Promise<void> {
    await this.clickNavAction("Add New Connection");
  }

  /** Click the "Refresh" nav action in the view title area. */
  async clickRefresh(): Promise<void> {
    await this.clickNavAction("Refresh");
  }

  /**
   * Open the Direct Connection form by clicking "Add New Connection" -> "Enter manually".
   * @returns A DirectConnectionForm instance for interacting with the form
   */
  async openDirectConnectionForm(): Promise<DirectConnectionForm> {
    await this.clickAddNewConnection();

    const quickpick = new Quickpick(this.page);
    // choices will be either "Enter manually" or "Import from file"
    const items: QuickpickItem[] = await quickpick.getItems({
      text: /Enter manually/,
      waitForItems: true,
    });
    if (items.length === 0) {
      throw new Error("'Enter manually' option not found in 'Add New Connection' quickpick");
    }

    await items[0].locator.click();
    return new DirectConnectionForm(this.page);
  }

  /**
   * Get the static "Confluent Cloud" {@link CCloudItem tree item} used for signing in/out and
   * changing CCloud organizations.
   */
  async getConfluentCloudItem(): Promise<CCloudItem> {
    const items: ViewItem[] = await this.getItems({ text: "Confluent Cloud" });
    if (items.length === 0) {
      throw new Error("Confluent Cloud item not found in Resources view");
    }
    return new CCloudItem(this.page, items[0].locator);
  }

  /**
   * Get the static "Local" {@link LocalItem tree item} used for the resources managed by the
   * extension through the Docker engine API (Kafka cluster, Schema Registry, etc.).
   */
  async getLocalItem(): Promise<ViewItem> {
    const items: ViewItem[] = await this.getItems({ text: "Local" });
    if (items.length === 0) {
      throw new Error("Local item not found in Resources view");
    }
    return new LocalItem(this.page, items[0].locator);
  }

  /** Get all root-level direct connection {@link ViewItem tree items}. */
  async getDirectConnectionItems(): Promise<ViewItem[]> {
    // filter by level=1 to get the root level items,
    // then filter by the accessibilityInfo used in the EnvironmentTreeItem
    const items: ViewItem[] = await this.getItems({
      level: 1,
      waitForItems: true,
    });
    const directItems: ViewItem[] = [];
    for (const item of items) {
      const ariaLabel: string | null = await item.locator.getAttribute("aria-label");
      if (ariaLabel?.startsWith("Direct connection: ")) {
        directItems.push(item);
      }
    }
    return directItems;
  }

  /**
   * Get all (CCloud) environment {@link CCloudEnvironmentItem tree items}.
   * (These are only available after completing the CCloud sign-in flow and the "Confluent Cloud"
   * tree item is expanded. Local and direct connections do not have "environment" tree items.)
   */
  async getCCloudEnvironmentItems(): Promise<CCloudEnvironmentItem[]> {
    const items: ViewItem[] = await this.getItems({
      iconId: "confluent-environment",
      waitForItems: true,
    });
    return items.map((item) => new CCloudEnvironmentItem(this.page, item.locator));
  }

  /**
   * Get all Kafka cluster {@link KafkaClusterItem tree items}.
   * - If the user completed the CCloud sign-in flow and an environment tree item is expanded, this
   * will return CCloud Kafka cluster tree items first, with varying labels.
   * - If the user is running the `confluent-local` Docker container, this will include a **local**
   * Kafka cluster tree item with the **"confluent-local"** label.
   * - If the user has a direct connection with a successfully-connected Kafka cluster config, and
   * that direct connection/"environment" tree item is expanded, this will include a Kafka cluster
   * tree item with the **"Kafka cluster"** label.
   */
  async getKafkaClusterItems(options?: {
    ccloud?: boolean;
    local?: boolean;
    direct?: boolean;
  }): Promise<KafkaClusterItem[]> {
    const items: ViewItem[] = await this.getItems({
      iconId: "confluent-kafka-cluster",
      waitForItems: true,
    });
    const kafkaClusterItems: KafkaClusterItem[] = items.map(
      (item) => new KafkaClusterItem(this.page, item.locator),
    );
    // return all items if no filter options are provided
    if (!options || (!options.ccloud && !options.local && !options.direct)) {
      return kafkaClusterItems;
    }

    // check labels to determine which items to include based on the options
    const filteredItems: KafkaClusterItem[] = [];
    for (const item of kafkaClusterItems) {
      const [isLocal, isDirect, isCCloud] = await Promise.all([
        item.isLocal(),
        item.isDirect(),
        item.isCCloud(),
      ]);
      const shouldInclude: boolean =
        (options.local === true && isLocal) ||
        (options.direct === true && isDirect) ||
        (options.ccloud === true && isCCloud);
      if (shouldInclude) {
        filteredItems.push(item);
      }
    }
    return filteredItems;
  }
}
