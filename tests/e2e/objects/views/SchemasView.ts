import { expect, Locator, Page } from "@playwright/test";
import { ConnectionType } from "../../utils/connections";
import { Quickpick } from "../quickInputs/Quickpick";
import { ResourcesView } from "./ResourcesView";
import { View } from "./View";

export enum SelectSchemaRegistry {
  FromResourcesView = "Schema Registry action from the Resources view",
  FromSchemasViewButton = "Schemas view nav action",
}

/**
 * Object representing the "Schemas"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view} in the "Confluent"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container}.
 */
export class SchemasView extends View {
  constructor(page: Page) {
    super(page, /Schemas.*Section/);
  }

  /**
   * Click the "Search" nav action in the view title area.
   *
   * NOTE: This requires a Schema Registry to be selected first.
   */
  async clickSearch(): Promise<void> {
    await this.clickNavAction("Search");
  }

  /** Click the "Create New Schema" nav action in the view title area. */
  async clickCreateNewSchema(): Promise<void> {
    await this.clickNavAction("Create New Schema");
  }

  /**
   * Click the "Upload Schema to Schema Registry" nav action in the view title area.
   *
   * NOTE: This requires a Schema Registry to be selected first.
   */
  async clickUploadSchema(): Promise<void> {
    await this.clickNavAction("Upload Schema to Schema Registry");
  }

  /**
   * Click the "Select Schema Registry" nav action in the view title area.
   *
   * NOTE: This requires at least one connection with a Schema Registry to be available.
   */
  async clickSelectSchemaRegistry(): Promise<void> {
    await this.clickNavAction("Select Schema Registry");
  }

  /**
   * Click the "Refresh" nav action in the view title area.
   *
   * NOTE: This requires a Schema Registry to be selected first.
   */
  async clickRefresh(): Promise<void> {
    await this.clickNavAction("Refresh");
  }

  /** Get all (root-level) subject items in the view. */
  get subjects(): Locator {
    return this.body.locator("[role='treeitem'][aria-level='1']");
  }

  /**
   * Get all schema version items in the view.
   * (One level below {@link subjects subject items}.)
   */
  get schemaVersions(): Locator {
    // we don't use `this.subjects` because these are sibling elements to subjects in the DOM
    return this.body.locator("[role='treeitem'][aria-level='2']");
  }

  /**
   * Once a connection is established, load schema subjects into the view using the specified
   * {@link SelectSchemaRegistry entrypoint}.
   *
   * If using the {@link SelectSchemaRegistry.FromSchemasViewButton "Select Schema Registry" nav action}
   * entrypoint, you can optionally provide a `registryLabel` to select a specific registry from the
   * quickpick list. If not provided, the first registry in the list will be selected.
   */
  async loadSchemaSubjects(
    connectionType: ConnectionType,
    entrypoint: SelectSchemaRegistry,
    registryLabel?: string | RegExp,
  ): Promise<void> {
    switch (entrypoint) {
      case SelectSchemaRegistry.FromResourcesView: {
        const resourcesView = new ResourcesView(this.page);
        const registry = await resourcesView.getSchemaRegistry(connectionType);
        await registry.click();
        break;
      }
      case SelectSchemaRegistry.FromSchemasViewButton: {
        await this.clickSelectSchemaRegistry();
        const schemaRegistryQuickpick = new Quickpick(this.page);
        await expect(schemaRegistryQuickpick.locator).toBeVisible();
        await expect(schemaRegistryQuickpick.items).not.toHaveCount(0);
        const registryItem = registryLabel
          ? schemaRegistryQuickpick.items.filter({ hasText: registryLabel }).first()
          : schemaRegistryQuickpick.items.first();
        await registryItem.click();
        break;
      }
      default:
        throw new Error(`Unsupported entrypoint: ${entrypoint}`);
    }
  }
}
