import { ElectronApplication, expect, Locator, Page } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { loadFixtureFromFile } from "../../../fixtures/utils";
import { ConnectionType } from "../../connectionTypes";
import { TextDocument } from "../editor/TextDocument";
import { NotificationArea } from "../notifications/NotificationArea";
import { InputBox } from "../quickInputs/InputBox";
import { Quickpick } from "../quickInputs/Quickpick";
import { ResourcesView } from "./ResourcesView";
import { View } from "./View";
import { SubjectItem } from "./viewItems/SubjectItem";

export enum SchemaType {
  Avro = "AVRO",
  Json = "JSON",
  Protobuf = "PROTOBUF",
}

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
    await expect(this.header).toHaveAttribute("aria-expanded", "true");
    await expect(this.body).toBeVisible();
  }

  /**
   * Creates a new schema version and subject by going through the full flow:
   * 1. Opens schema creation workflow
   * 2. Selects schema type
   * 3. Enters schema content
   * 4. Uploads and creates new subject
   * @returns The generated subject name for cleanup
   */
  async createSchemaVersion(
    page: Page,
    schemaType: SchemaType,
    schemaFile: string,
    subjectName?: string,
  ): Promise<string> {
    await this.clickCreateNewSchema();

    // select initial schema type before the document opens
    const createSchemaTypeQuickpick = new Quickpick(page);
    await expect(createSchemaTypeQuickpick.locator).toBeVisible();
    await createSchemaTypeQuickpick.selectItemByText(schemaType);

    // enter schema content into editor
    const schemaContent: string = loadFixtureFromFile(schemaFile);
    const untitledDocument = new TextDocument(page, "Untitled-1");
    await expect(untitledDocument.locator).toBeVisible();
    await untitledDocument.insertContent(schemaContent);

    await this.clickUploadSchema();

    // select editor/file name in the first quickpick
    const documentQuickpick = new Quickpick(page);
    await expect(documentQuickpick.locator).toBeVisible();
    await documentQuickpick.selectItemByText("Untitled");

    // select schema type in the next quickpick
    const uploadSchemaTypeQuickpick = new Quickpick(page);
    await expect(uploadSchemaTypeQuickpick.locator).toBeVisible();
    await uploadSchemaTypeQuickpick.selectItemByText(schemaType);

    // select "Create new subject" in the next quickpick
    const subjectQuickpick = new Quickpick(page);
    await expect(subjectQuickpick.locator).toBeVisible();
    const createNewSubjectItem: Locator = subjectQuickpick.items.filter({
      hasText: "Create new subject",
    });
    await expect(createNewSubjectItem).not.toHaveCount(0);
    await createNewSubjectItem.click();

    // enter subject name in the input box and submit
    const subjectInputBox = new InputBox(page);
    await expect(subjectInputBox.input).toBeVisible();
    if (!subjectName) {
      const randomValue: string = Math.random().toString(36).substring(2, 15);
      subjectName = `customer-${randomValue}-value`;
    }
    await subjectInputBox.input.fill(subjectName);
    await subjectInputBox.confirm();

    // clear out and close the untitled document after uploading so we only have one editor open
    // during the rest of the tests'
    await untitledDocument.deleteAll();
    await untitledDocument.close();

    // if we made it this far, we can return the subject so the .afterEach() hook can delete the
    // subject (and schema version) that was just created
    return subjectName;
  }

  async deleteSchemaSubject(
    page: Page,
    electronApp: ElectronApplication,
    subjectName: string,
    deletionConfirmation: string,
  ) {
    // stub the system dialog (warning modal) that appears when hard-deleting
    // NOTE: "Yes, Hard Delete" is the first button on macOS/Windows, second on Linux
    const confirmButtonIndex = process.platform === "linux" ? 1 : 0;
    await stubMultipleDialogs(electronApp, [
      {
        method: "showMessageBox",
        value: {
          response: confirmButtonIndex, // simulate clicking the "Yes, Hard Delete" button
          checkboxChecked: false,
        },
      },
    ]);

    // find the schema item in the view and start the deletion from its context menu
    const subjectLocator: Locator = this.subjects.filter({ hasText: subjectName });
    const subjectItem = new SubjectItem(page, subjectLocator.first());
    await subjectItem.locator.scrollIntoViewIfNeeded();
    await expect(subjectItem.locator).toBeVisible();
    await subjectItem.rightClickContextMenuAction("Delete All Schemas in Subject");

    // select the Hard Delete option
    const deletionQuickpick = new Quickpick(page);
    const hardDelete = deletionQuickpick.items.filter({ hasText: "Hard Delete" });
    await expect(hardDelete).not.toHaveCount(0);
    await hardDelete.click();

    // enter the confirmation text input
    const confirmationBox = new InputBox(page);
    await expect(confirmationBox.input).toBeVisible();
    await confirmationBox.input.fill(deletionConfirmation);
    await confirmationBox.confirm();

    // the system dialog is automatically handled by the stub above, no need to handle it here
    const notificationArea = new NotificationArea(page);
    const deletionNotifications = notificationArea.infoNotifications.filter({
      hasText: /hard deleted/,
    });
    await expect(deletionNotifications.first()).toBeVisible();
  }
}
