import { expect, Locator, Page } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { loadFixtureFromFile } from "../../fixtures/utils";
import { test } from "../baseTest";
import { TextDocument } from "../objects/editor/TextDocument";
import { Notification } from "../objects/notifications/Notification";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { InputBox } from "../objects/quickInputs/InputBox";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { ResourcesView } from "../objects/views/ResourcesView";
import { SchemasView } from "../objects/views/SchemasView";
import { SubjectItem } from "../objects/views/viewItems/SubjectItem";
import {
  DirectConnectionForm,
  FormConnectionType,
  SupportedAuthType,
} from "../objects/webviews/DirectConnectionFormWebview";
import { executeVSCodeCommand } from "../utils/commands";
import { configureVSCodeSettings } from "../utils/settings";
import { openConfluentExtension } from "./utils/confluent";
import { login } from "./utils/confluentCloud";

/** Schema types and their corresponding file extensions to test. */
const SCHEMA_TYPES = [
  ["AVRO", "avsc"],
  ["JSON", "json"],
  ["PROTOBUF", "proto"],
] as const;

/**
 * E2E test suite for testing the whole schema management flow in the extension.
 * {@see https://github.com/confluentinc/vscode/issues/1839}
 *
 * Test flow:
 * 1. Set up connection:
 *    a. CCLOUD: Log in to Confluent Cloud from the sidebar auth flow
 *    b. DIRECT: Fill out the Add New Connection form and submit with Schema Registry connection details
 * 2. Select a Schema Registry
 * 3. Create a new subject with an initial schema version
 * 4. Try to evolve the schema to a new version
 *    a. Valid/compatible schema update
 *    b. Invalid/incompatible schema update
 * 5. Clean up by deleting the subject
 */

test.describe("Schema Management", () => {
  let resourcesView: ResourcesView;
  // this is set after the connections are set up based on their beforeEach hooks
  let schemasView: SchemasView;

  let subjectName: string;
  // most tests only create one schema version, but the "should evolve schema to second version" test
  // should create a second version, which will change this to the subject name itself
  let deletionConfirmation = "v1";

  test.beforeEach(async ({ page, electronApp }) => {
    subjectName = "";

    // disable auto-formatting and language detection to avoid issues with the editor
    // NOTE: this can't be done in a .beforeAll hook since it won't persist for each test run
    await configureVSCodeSettings(page, electronApp, {
      "workbench.editor.languageDetection": false,
      "editor.autoClosingBrackets": "never",
      "editor.autoClosingQuotes": "never",
      "editor.autoIndent": "none",
      "editor.autoSurround": "never",
      "editor.formatOnType": false,
      "editor.insertSpaces": false,
      "json.format.enable": false,
      "json.validate.enable": false,
    });

    await openConfluentExtension(page);
    resourcesView = new ResourcesView(page);
    await expect(resourcesView.header).toHaveAttribute("aria-expanded", "true");
  });

  test.afterEach(async ({ page, electronApp }) => {
    // reset VS Code settings to defaults
    await configureVSCodeSettings(page, electronApp, {});

    // delete the subject if it was created during the test
    if (subjectName) {
      // stub the system dialog (warning modal) that appears when hard-deleting
      await stubMultipleDialogs(electronApp, [
        {
          method: "showMessageBox",
          value: {
            response: 0, // simulate clicking "Yes, Hard Delete" (first button)
            checkboxChecked: false,
          },
        },
      ]);

      // replace this with right-click context actions once this issue is resolved:
      // https://github.com/confluentinc/vscode/issues/1875
      await executeVSCodeCommand(page, "Confluent: Delete All Schemas in Subject");

      // select the subject to delete
      const subjectInputBox = new InputBox(page);
      await expect(subjectInputBox.placeholder).toBeVisible();
      await subjectInputBox.fill(subjectName);
      await subjectInputBox.confirm();

      // select the Hard Delete option
      const deletionQuickpick = new Quickpick(page);
      const hardDelete = deletionQuickpick.items.filter({ hasText: "Hard Delete" });
      await expect(hardDelete).not.toHaveCount(0);
      await hardDelete.click();

      // enter the confirmation text input
      const confirmationBox = new InputBox(page);
      await expect(confirmationBox.input).toBeVisible();
      await confirmationBox.fill(deletionConfirmation);
      await confirmationBox.confirm();

      // the system dialog is automatically handled by the stub above, no need to handle it here

      const notificationArea = new NotificationArea(page);
      const deletionNotifications = notificationArea.infoNotifications.filter({
        hasText: /hard deleted/,
      });
      await expect(deletionNotifications.first()).toBeVisible();
    }
  });

  for (const [schemaType, fileExtension] of SCHEMA_TYPES) {
    const schemaFile = `schemas/customer.${fileExtension}`;

    /** Main tests covered by each connection type test block. */
    const schemaTests = () => {
      test(`${schemaType}: should create a new subject and upload the first schema version`, async ({
        page,
      }) => {
        subjectName = await createSchemaVersion(page, schemaType, schemaFile);

        const notificationArea = new NotificationArea(page);
        const successNotifications: Locator = notificationArea.infoNotifications.filter({
          hasText: /Schema registered to new subject/,
        });
        await expect(successNotifications.first()).toBeVisible();

        const subjectLocator: Locator = schemasView.getSubjectByName(subjectName);
        await expect(subjectLocator).toBeVisible();
      });

      test(`${schemaType}: should create a new schema version with valid/compatible changes`, async ({
        page,
      }) => {
        subjectName = await createSchemaVersion(page, schemaType, schemaFile);
        // try to evolve the newly-created schema
        const subjectLocator: Locator = schemasView.getSubjectByName(subjectName);
        const subjectItem = new SubjectItem(page, subjectLocator.first());
        await subjectItem.clickEvolveLatestSchema();

        // new editor should open with a `<subject name>.v2-draft.confluent.<schema type>` title
        const expectedTabName = `${subjectName}.v2-draft.confluent.${fileExtension}`;
        const evolutionDocument = new TextDocument(page, expectedTabName);
        await expect(evolutionDocument.tab).toBeVisible();
        // make sure the new document is focused before performing operations
        await evolutionDocument.tab.click();
        await expect(evolutionDocument.locator).toBeVisible();

        // enter new (valid) schema content into the new editor
        const goodEvolutionFile = `schemas/customer_good_evolution.${fileExtension}`;
        const schemaContent: string = loadFixtureFromFile(goodEvolutionFile);
        await evolutionDocument.replaceContent(schemaContent);

        // attempt to upload from the subject item (instead of the Schemas view nav action)
        await subjectItem.uploadSchemaForSubject();
        await selectCurrentDocumentFromQuickpick(page, expectedTabName);
        await selectSchemaTypeFromQuickpick(page, schemaType);

        const notificationArea = new NotificationArea(page);
        const successNotifications = notificationArea.infoNotifications.filter({
          hasText: /New version 2 registered to existing subject/,
        });
        await expect(successNotifications.first()).toBeVisible();

        // update deletion confirmation from "v1" to the subject name for proper cleanup
        // since there are now two versions
        deletionConfirmation = subjectName;
      });

      test(`${schemaType}: should reject invalid/incompatible schema evolution and not create a second version`, async ({
        page,
      }) => {
        subjectName = await createSchemaVersion(page, schemaType, schemaFile);
        // try to evolve the newly-created schema
        const subjectLocator: Locator = schemasView.getSubjectByName(subjectName);
        const subjectItem = new SubjectItem(page, subjectLocator.first());
        await subjectItem.clickEvolveLatestSchema();

        // new editor should open with a `<subject name>.v2-draft.confluent.<schema type>` title
        const expectedTabName = `${subjectName}.v2-draft.confluent.${fileExtension}`;
        const badEvolutionDocument = new TextDocument(page, expectedTabName);
        await expect(badEvolutionDocument.tab).toBeVisible();
        // make sure the new document is focused before performing operations
        await badEvolutionDocument.tab.click();
        await expect(badEvolutionDocument.locator).toBeVisible();

        // enter new (invalid) schema content into the new editor
        const badEvolutionFile = `schemas/customer_bad_evolution.${fileExtension}`;
        const schemaContent: string = loadFixtureFromFile(badEvolutionFile);
        await badEvolutionDocument.replaceContent(schemaContent);

        // attempt to upload from the subject item (instead of the Schemas view nav action)
        await subjectItem.uploadSchemaForSubject();
        await selectCurrentDocumentFromQuickpick(page, expectedTabName);
        await selectSchemaTypeFromQuickpick(page, schemaType);

        const notificationArea = new NotificationArea(page);
        const errorNotifications: Locator = notificationArea.errorNotifications.filter({
          hasText: "Conflict with prior schema version",
        });
        await expect(errorNotifications.first()).toBeVisible();

        // since we didn't create a second schema version, we should still be able to delete
        // the subject based on the fact that there is still only one version
        deletionConfirmation = "v1";
      });
    };

    test.describe("CCLOUD Connection", () => {
      test.beforeEach(async ({ page, electronApp }) => {
        // CCloud connection setup:
        await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);
        // make sure the "Confluent Cloud" item in the Resources view is expanded and doesn't show the
        // "(Not Connected)" description
        const ccloudItem: Locator = resourcesView.confluentCloudItem;
        await expect(ccloudItem).toBeVisible();
        await expect(ccloudItem).not.toHaveText("(Not Connected)");
        await expect(ccloudItem).toHaveAttribute("aria-expanded", "true");

        // expand the first (CCloud) environment to show Kafka clusters, Schema Registry, and maybe
        // Flink compute pools
        await expect(resourcesView.ccloudEnvironments).not.toHaveCount(0);
        const firstEnvironment: Locator = resourcesView.ccloudEnvironments.first();
        // environments are collapsed by default, so we need to expand it first
        await firstEnvironment.click();
        await expect(firstEnvironment).toHaveAttribute("aria-expanded", "true");

        // then click on the first (CCloud) Schema Registry to focus it in the Schemas view
        await expect(resourcesView.ccloudSchemaRegistries).not.toHaveCount(0);
        const firstSchemaRegistry: Locator = resourcesView.ccloudSchemaRegistries.first();
        await firstSchemaRegistry.click();
        // NOTE: we don't care about testing SR selection from the Resources view vs the Schemas
        // view for these tests, so we're just picking from the Resources view here
        schemasView = new SchemasView(page);
        await expect(schemasView.header).toHaveAttribute("aria-expanded", "true");
      });

      schemaTests();
    });

    test.describe("DIRECT Connection", () => {
      test.beforeEach(async ({ page }) => {
        // direct connection setup:
        const connectionForm: DirectConnectionForm = await resourcesView.addNewConnectionManually();
        const connectionName = "Playwright";
        await connectionForm.fillConnectionName(connectionName);
        await connectionForm.selectConnectionType(FormConnectionType.ConfluentCloud);
        // only configure the Schema Registry connection
        await connectionForm.fillSchemaRegistryUri(process.env.E2E_SR_URL!);
        await connectionForm.selectSchemaRegistryAuthType(SupportedAuthType.API);
        await connectionForm.fillSchemaRegistryCredentials({
          api_key: process.env.E2E_SR_API_KEY!,
          api_secret: process.env.E2E_SR_API_SECRET!,
        });

        await connectionForm.testButton.click();
        await expect(connectionForm.successMessage).toBeVisible();
        await connectionForm.saveButton.click();

        // make sure we see the notification indicating the connection was created
        const notificationArea = new NotificationArea(page);
        const notifications: Locator = notificationArea.infoNotifications.filter({
          hasText: "New Connection Created",
        });
        await expect(notifications).toHaveCount(1);
        const notification = new Notification(page, notifications.first());
        await notification.dismiss();
        // don't wait for the "Waiting for <connection> to be usable..." progress notification since
        // it may disappear quickly

        // wait for the Resources view to refresh and show the new direct connection
        await expect(resourcesView.directConnections).not.toHaveCount(0);
        await expect(resourcesView.directConnections.first()).toHaveText(connectionName);

        // expand the first direct connection to show its Schema Registry
        await expect(resourcesView.directConnections).not.toHaveCount(0);
        const firstConnection: Locator = resourcesView.directConnections.first();
        // direct connections are collapsed by default, so we need to expand it first
        await firstConnection.click();
        await expect(firstConnection).toHaveAttribute("aria-expanded", "true");

        // then click on the first (CCloud) Schema Registry to focus it in the Schemas view
        const directSchemaRegistries: Locator = resourcesView.directSchemaRegistries;
        await expect(directSchemaRegistries).not.toHaveCount(0);
        const firstSchemaRegistry: Locator = directSchemaRegistries.first();
        await firstSchemaRegistry.click();
        // NOTE: we don't care about testing SR selection from the Resources view vs the Schemas
        // view for these tests, so we're just picking from the Resources view here
        schemasView = new SchemasView(page);
        await expect(schemasView.header).toHaveAttribute("aria-expanded", "true");
      });

      schemaTests();
    });
  }

  /**
   * Creates a new schema version and subject by going through the full flow:
   * 1. Opens schema creation workflow
   * 2. Selects schema type
   * 3. Enters schema content
   * 4. Uploads and creates new subject
   * @returns The generated subject name for cleanup
   */
  async function createSchemaVersion(
    page: Page,
    schemaType: string,
    schemaFile: string,
  ): Promise<string> {
    await schemasView.clickCreateNewSchema();
    await selectSchemaTypeFromQuickpick(page, schemaType);

    // enter schema content into editor
    const schemaContent: string = loadFixtureFromFile(schemaFile);
    const untitledDocument = new TextDocument(page, "Untitled-1");
    await expect(untitledDocument.locator).toBeVisible();
    await untitledDocument.insertContent(schemaContent);

    await schemasView.clickUploadSchema();

    // select editor/file name in the first quickpick
    await selectCurrentDocumentFromQuickpick(page, "Untitled");
    await selectSchemaTypeFromQuickpick(page, schemaType);

    // select "Create new subject" in the next quickpick
    const subjectQuickpick = new Quickpick(page);
    await expect(subjectQuickpick.locator).toBeVisible();
    const createNewSubjectItem: Locator = subjectQuickpick.items.filter({
      hasText: "Create new subject",
    });
    await expect(createNewSubjectItem).not.toHaveCount(0);
    await createNewSubjectItem.click();

    // enter subject name in the input box and submit
    const randomValue: string = Math.random().toString(36).substring(2, 15);
    const generatedSubjectName = `customer-${randomValue}-value`;
    const subjectInputBox = new InputBox(page);
    await expect(subjectInputBox.input).toBeVisible();
    await subjectInputBox.fill(generatedSubjectName);
    await subjectInputBox.confirm();

    // if we made it this far, we can return the subject so the .afterEach() hook can delete the
    // subject (and schema version) that was just created
    return generatedSubjectName;
  }

  /** Select an item from the document quickpick based on a title to match. */
  async function selectCurrentDocumentFromQuickpick(
    page: Page,
    documentTitle: string,
  ): Promise<void> {
    const fileQuickpick = new Quickpick(page);
    await expect(fileQuickpick.locator).toBeVisible();
    const currentFileItem: Locator = fileQuickpick.items.filter({ hasText: documentTitle });
    await expect(currentFileItem).not.toHaveCount(0);
    await currentFileItem.click();
  }

  /** Select a schema type (AVRO/JSON/PROTOBUF) from the schema type quickpick. */
  async function selectSchemaTypeFromQuickpick(page: Page, schemaType: string): Promise<void> {
    const confirmSchemaTypeQuickpick = new Quickpick(page);
    await expect(confirmSchemaTypeQuickpick.locator).toBeVisible();
    const schemaTypeItem: Locator = confirmSchemaTypeQuickpick.items.filter({
      hasText: schemaType,
    });
    await schemaTypeItem.click();
  }
});
