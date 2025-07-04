import { Locator, Page } from "@playwright/test";
import { View } from "./View";

/**
 * Object representing the "Schemas"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view} in the "Confluent"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container}.
 */
export class SchemasView extends View {
  constructor(page: Page) {
    super(page, /Schemas.*Section/);
  }

  /** Click the "Search" nav action in the view title area. */
  async clickSearch(): Promise<void> {
    await this.clickNavAction("Search");
  }

  /** Click the "Create New Schema" nav action in the view title area. */
  async clickCreateNewSchema(): Promise<void> {
    await this.clickNavAction("Create New Schema");
  }

  /** Click the "Upload Schema to Schema Registry" nav action in the view title area. */
  async clickUploadSchema(): Promise<void> {
    await this.clickNavAction("Upload Schema to Schema Registry");
  }

  /** Click the "Select Schema Registry" nav action in the view title area. */
  async clickSelectSchemaRegistry(): Promise<void> {
    await this.clickNavAction("Select Schema Registry");
  }

  /** Click the "Refresh" nav action in the view title area. */
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
   * Get a specific subject by name.
   * @param subjectName The name of the subject to find
   */
  getSubjectByName(subjectName: string): Locator {
    return this.subjects.filter({ hasText: subjectName });
  }
}
