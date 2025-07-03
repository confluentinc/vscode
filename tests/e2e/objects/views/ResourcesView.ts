import { expect, Locator, Page } from "@playwright/test";
import { Quickpick } from "../quickInputs/Quickpick";
import { DirectConnectionForm } from "../webviews/DirectConnectionFormWebview";
import { View } from "./View";

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

  // Connection-specific locators:

  /**
   * Locator for the static "Confluent Cloud" tree item used for signing in/out and
   * changing CCloud organizations.
   */
  get confluentCloudItem(): Locator {
    return this.treeItems.filter({ hasText: "Confluent Cloud" });
  }

  /**
   * Locator for all (CCloud) environment tree items.
   * Only visible when the {@link confluentCloudItem "Confluent Cloud" item} is expanded.
   */
  get ccloudEnvironments(): Locator {
    return this.treeItems.filter({ has: this.page.locator(".codicon-confluent-environment") });
  }

  /**
   * Locator for the static "Local" tree item used for the resources managed by the
   * extension through the Docker engine API (Kafka cluster, Schema Registry, etc.).
   */
  get localItem(): Locator {
    return this.treeItems.filter({ hasText: "Local" });
  }

  /** Locator for all root-level direct connection tree items. */
  get directConnections(): Locator {
    // we can't use this.treeItems since we have to look for an attribute instead of filtering
    // based on the existing selector
    return this.body.locator('[role="treeitem"][aria-label^="Direct connection: "]');
  }

  // Kafka cluster locators:

  /** Locator for all Kafka cluster tree items. */
  get kafkaClusters(): Locator {
    return this.treeItems.filter({ has: this.page.locator(".codicon-confluent-kafka-cluster") });
  }

  /**
   * Locator for CCloud Kafka cluster tree items.
   * Only visible when a {@link ccloudEnvironments CCloud environment item} is expanded.
   */
  get ccloudKafkaClusters(): Locator {
    // third nested element: Confluent Cloud item -> environment item -> Kafka cluster item
    return this.body
      .locator("[role='treeitem'][aria-level='3']")
      .filter({ has: this.page.locator(".codicon-confluent-kafka-cluster") });
  }

  /**
   * Locator for local Kafka cluster tree items.
   * Only visible when the {@link localItem "Local" item} is expanded.
   */
  get localKafkaClusters(): Locator {
    return this.kafkaClusters.filter({ hasText: "confluent-local" });
  }

  /**
   * Locator for direct connection Kafka cluster tree items.
   * Only visible when a {@link directConnections "Direct Connections" item} is available and
   * expanded.
   */
  get directKafkaClusters(): Locator {
    return this.kafkaClusters.filter({ hasText: "Kafka Cluster" });
  }

  /** Locator for all Schema Registry tree items. */
  get schemaRegistries(): Locator {
    return this.treeItems.filter({ has: this.page.locator(".codicon-confluent-schema-registry") });
  }

  /**
   * Locator for CCloud Schema Registry tree items.
   * Only visible when a {@link ccloudEnvironments CCloud environment item} is expanded.
   */
  get ccloudSchemaRegistries(): Locator {
    // third nested element: Confluent Cloud item -> environment item -> Schema Registry item
    return this.body
      .locator("[role='treeitem'][aria-level='3']")
      .filter({ has: this.page.locator(".codicon-confluent-schema-registry") });
  }

  /**
   * Locator for local Schema Registry tree items.
   * Only visible when the {@link localItem "Local" item} is expanded.
   */
  get localSchemaRegistries(): Locator {
    return this.schemaRegistries.filter({ hasText: "confluent-local" });
  }

  /**
   * Locator for direct connection Schema Registry tree items.
   * Only visible when a {@link directConnections "Direct Connections" item} is available and
   * expanded.
   */
  get directSchemaRegistries(): Locator {
    return this.schemaRegistries.filter({ hasText: "Schema Registry" });
  }

  // FUTURE: add Flink compute pool getter methods

  /**
   * Open the Direct Connection form by clicking "Add New Connection" -> "Enter manually".
   * @returns A DirectConnectionForm instance for interacting with the form
   */
  async addNewConnectionManually(): Promise<DirectConnectionForm> {
    await this.clickAddNewConnection();

    const quickpick = new Quickpick(this.page);
    // choices will be either "Enter manually" or "Import from file"
    const enterManuallyItem = quickpick.items.filter({ hasText: /Enter manually/ });
    await expect(enterManuallyItem).not.toHaveCount(0);
    await enterManuallyItem.first().click();
    return new DirectConnectionForm(this.page);
  }
}
