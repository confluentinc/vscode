import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { ConnectionType } from "../../connectionTypes";
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
    return this.treeItems.filter({
      hasText: "Local",
      has: this.page.locator(".codicon-device-desktop"),
    });
  }

  /** Locator for all root-level direct connection tree items. */
  get directConnections(): Locator {
    // use the accessibilityInformation label we're adding instead of trying to filter by icons/names
    return this.treeItems.and(this.page.locator('[aria-label^="DIRECT: connection "]'));
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
    return this.kafkaClusters.and(
      this.page.locator("[aria-level='3'][aria-label^='CCLOUD connection: Kafka Cluster']"),
    );
  }

  /**
   * Locator for Flinkable CCloud Kafka cluster tree items.
   * Only visible when a {@link ccloudEnvironments CCloud environment item} is expanded.
   */
  get ccloudFlinkableKafkaClusters(): Locator {
    return this.kafkaClusters.and(
      this.page.locator(
        "[aria-level='3'][aria-label^='CCLOUD connection: Kafka Cluster (Flinkable)']",
      ),
    );
  }

  /**
   * Locator for local Kafka cluster tree items.
   * Only visible when the {@link localItem "Local" item} is expanded.
   */
  get localKafkaClusters(): Locator {
    // second nested element: Local connection item -> Kafka cluster item
    return this.kafkaClusters.and(
      this.page.locator("[aria-level='2'][aria-label^='LOCAL connection: Kafka Cluster']"),
    );
  }

  /**
   * Locator for direct connection Kafka cluster tree items.
   * Only visible when a {@link directConnections "Direct Connections" item} is available and
   * expanded with a Kafka cluster configured.
   */
  get directKafkaClusters(): Locator {
    // second nested element: Direct connection item -> Kafka cluster item
    return this.kafkaClusters.and(
      this.page.locator("[aria-level='2'][aria-label^='DIRECT connection: Kafka Cluster']"),
    );
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
    return this.schemaRegistries.and(
      this.page.locator("[aria-level='3'][aria-label^='CCLOUD connection: Schema Registry']"),
    );
  }

  /**
   * Locator for local Schema Registry tree items.
   * Only visible when the {@link localItem "Local" item} is expanded.
   */
  get localSchemaRegistries(): Locator {
    // second nested element: Local connection item -> Schema Registry item
    return this.schemaRegistries.and(
      this.page.locator("[aria-level='2'][aria-label^='LOCAL connection: Schema Registry']"),
    );
  }

  /**
   * Locator for direct connection Schema Registry tree items.
   * Only visible when a {@link directConnections direct connection item} is available and
   * expanded with a Schema Registry configured.
   */
  get directSchemaRegistries(): Locator {
    // second nested element: Direct connection item -> Schema Registry item
    return this.schemaRegistries.and(
      this.page.locator("[aria-level='2'][aria-label^='DIRECT connection: Schema Registry']"),
    );
  }

  /** Locator for all Flink Compute Pool tree items.*/
  get flinkComputePools(): Locator {
    // only available for CCloud connections
    return this.treeItems.filter({
      has: this.page.locator(".codicon-confluent-flink-compute-pool"),
    });
  }

  /**
   * Locator for CCloud Flink Compute Pool tree items.
   * Only visible when a {@link ccloudEnvironments CCloud environment item} is expanded.
   */
  get ccloudFlinkComputePools(): Locator {
    // third nested element: Confluent Cloud item -> environment item -> Flink Compute Pool item
    return this.flinkComputePools.and(this.page.locator("[aria-level='3']"));
  }

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

  /**
   * Open the Direct Connection form by clicking "Add New Connection" -> "Import from file".
   *
   * To avoid saving off any sensitive connection details for these tests, the file picker dialog
   * should be handled through a stub in the test that calls this method and provides the JSON
   * content to import.
   *
   * @returns A DirectConnectionForm instance for the imported connection
   */
  async addNewConnectionFromFileImport(): Promise<DirectConnectionForm> {
    await this.clickAddNewConnection();

    const quickpick = new Quickpick(this.page);
    // choices will be either "Enter manually" or "Import from file"
    const importFromFileItem = quickpick.items.filter({ hasText: /Import from file/ });
    await expect(importFromFileItem).not.toHaveCount(0);
    await importFromFileItem.first().click();
    return new DirectConnectionForm(this.page);
  }

  /**
   * Locate a connection environment item in the view for a given {@link ConnectionType connection type}.
   * If there are multiple environments for the connection type, you can optionally provide a
   * `label` string or regex to filter the results.
   *
   * This requires the connection to be fully set up beforehand (e.g. CCloud authentication,
   * direct connection form completion, etc.) so that the environment item is present.
   *
   * NOTE: CCloud connections may have multiple environments, but the local connection and direct
   * connections are each treated as individual "environments" in the Resources view.
   *
   * @param connectionType The type of connection (CCloud or Direct)
   * @param label Optional string or regex to filter the located environments
   * @returns A Locator for the environment item
   */
  async getEnvironment(connectionType: ConnectionType, label?: string | RegExp): Promise<Locator> {
    let environment: Locator;

    switch (connectionType) {
      case ConnectionType.Ccloud: {
        await expect(this.ccloudEnvironments).not.toHaveCount(0);
        environment = label
          ? this.ccloudEnvironments.filter({ hasText: label }).first()
          : this.ccloudEnvironments.first();
        break;
      }
      case ConnectionType.Direct: {
        await expect(this.directConnections).not.toHaveCount(0);
        environment = label
          ? this.directConnections.filter({ hasText: label }).first()
          : this.directConnections.first();
        break;
      }
      case ConnectionType.Local: {
        await expect(this.localItem).not.toHaveCount(0);
        environment = this.localItem;
        break;
      }
      default:
        throw new Error(`Unsupported connection type: ${connectionType}`);
    }

    await expect(environment).toBeVisible();
    return environment;
  }

  /**
   * Expand a connection's environment in the Resources view.
   *
   * NOTE: CCloud connections may have multiple environments, but the local connection and direct
   * connections are each treated as individual "environments" in the Resources view.
   */
  async expandConnectionEnvironment(
    connectionType: ConnectionType,
    label?: string | RegExp,
  ): Promise<void> {
    const environment = await this.getEnvironment(connectionType, label);

    if ((await environment.getAttribute("aria-expanded")) === "false") {
      await environment.click();
    }
    await expect(environment).toHaveAttribute("aria-expanded", "true");
  }

  /** Locate a direct connection item in the view by its label. */
  async getDirectConnection(label: string | RegExp): Promise<Locator> {
    return await this.getEnvironment(ConnectionType.Direct, label);
  }

  /**
   * Locate a Kafka cluster item in the view for a given {@link ConnectionType connection type}.
   * If there are multiple clusters for the connection type, you can optionally provide a
   * `clusterHasText` string or regex to filter the results.
   *
   * NOTE: This requires the connection to be fully set up beforehand (e.g. CCloud authentication,
   * direct connection form completion, etc.) so that the cluster item is present.
   *
   * @param connectionType The type of connection (CCloud or Direct)
   * @param clusterHasText Optional string or regex to filter the located clusters
   * @returns A Locator for the Kafka cluster item
   */
  async getKafkaCluster(
    connectionType: ConnectionType,
    clusterHasText?: string | RegExp,
  ): Promise<Locator> {
    let kafkaClusters: Locator;

    // whatever connection we're using needs to be expanded so any Kafka clusters are visible
    await this.expandConnectionEnvironment(connectionType);

    switch (connectionType) {
      case ConnectionType.Ccloud: {
        kafkaClusters = this.ccloudKafkaClusters;
        break;
      }
      case ConnectionType.Direct: {
        kafkaClusters = this.directKafkaClusters;
        break;
      }
      case ConnectionType.Local: {
        kafkaClusters = this.localKafkaClusters;
        break;
      }
      default:
        throw new Error(`Unsupported connection type: ${connectionType}`);
    }

    await expect(kafkaClusters).not.toHaveCount(0);

    const kafkaCluster: Locator = clusterHasText
      ? kafkaClusters.filter({ hasText: clusterHasText }).first()
      : kafkaClusters.first();
    await expect(kafkaCluster).toBeVisible();
    return kafkaCluster;
  }

  /**
   * Locate a Schema Registry item in the view for a given {@link ConnectionType connection type}.
   * If there are multiple registries for the connection type, you can optionally provide a
   * `registryHasText` string or regex to filter the results.
   *
   * NOTE: This requires the connection to be fully set up beforehand (e.g. CCloud authentication,
   * direct connection form completion, etc.) so that the registry item is present.
   *
   * @param connectionType The type of connection (CCloud or Direct)
   * @param registryHasText Optional string or regex to filter the located registries
   * @returns A Locator for the Schema Registry item
   */
  async getSchemaRegistry(
    connectionType: ConnectionType,
    registryHasText?: string | RegExp,
  ): Promise<Locator> {
    let schemaRegistries: Locator;

    // whatever connection we're using needs to be expanded so any Schema Registries are visible
    await this.expandConnectionEnvironment(connectionType);

    switch (connectionType) {
      case ConnectionType.Ccloud: {
        schemaRegistries = this.ccloudSchemaRegistries;
        break;
      }
      case ConnectionType.Direct: {
        schemaRegistries = this.directSchemaRegistries;
        break;
      }
      case ConnectionType.Local: {
        schemaRegistries = this.localSchemaRegistries;
        break;
      }
      default:
        throw new Error(`Unsupported connection type: ${connectionType}`);
    }

    await expect(schemaRegistries).not.toHaveCount(0);

    const schemaRegistry: Locator = registryHasText
      ? schemaRegistries.filter({ hasText: registryHasText }).first()
      : schemaRegistries.first();
    await expect(schemaRegistry).toBeVisible();
    return schemaRegistry;
  }
}
