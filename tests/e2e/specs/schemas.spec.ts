import { ElectronApplication, expect, Locator, Page } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { loadFixtureFromFile } from "../../fixtures/utils";
import { test } from "../baseTest";
import { TextDocument } from "../objects/editor/TextDocument";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { InputBox } from "../objects/quickInputs/InputBox";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { ResourcesView } from "../objects/views/ResourcesView";
import { SchemasView } from "../objects/views/SchemasView";
import { SubjectItem } from "../objects/views/viewItems/SubjectItem";
import {
  FormConnectionType,
  SupportedAuthType,
} from "../objects/webviews/DirectConnectionFormWebview";
import { Tag } from "../tags";
import { ConnectionType, setupCCloudConnection, setupDirectConnection } from "../utils/connections";
import { configureVSCodeSettings } from "../utils/settings";
import { openConfluentSidebar } from "../utils/sidebarNavigation";

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
  let notificationArea: NotificationArea;

  let subjectName: string;
  // most tests only create one schema version, but the "should evolve schema to second version" test
  // should create a second version, which will change this to the subject name itself
  let deletionConfirmation = "v1";

  test.beforeEach(async ({ page, electronApp }) => {
    subjectName = "";

    // disable auto-formatting and language detection to avoid issues with the editor
    // NOTE: this can't be done in a .beforeAll hook since it won't persist for each test run
    await configureVSCodeSettings(page, electronApp, {
      // this is to avoid VS Code incorrectly setting the language of .proto files as C# so they
      // appear correctly (as "plaintext") in the URI quickpick
      "workbench.editor.languageDetection": false,
      // we also have to disable a lot of auto-formatting so the .insertContent() method properly
      // adds the schema content as it exists in the fixture files
      "editor.autoClosingBrackets": "never",
      "editor.autoClosingQuotes": "never",
      "editor.autoIndent": "none",
      "editor.autoSurround": "never",
      "editor.formatOnType": false,
      "editor.insertSpaces": false,
      "json.format.enable": false,
      "json.validate.enable": false,
      // XXX: this must be set to prevent skipping newlines/commas while content is added to the editor
      "editor.acceptSuggestionOnEnter": "off",
      // this prevents VS Code from converting the `http` to `https` in `$schema` URIs:
      "editor.linkedEditing": false,
    });

    await openConfluentSidebar(page);

    resourcesView = new ResourcesView(page);
    notificationArea = new NotificationArea(page);
  });

  test.afterEach(async ({ page, electronApp }) => {
    await configureVSCodeSettings(page, electronApp, {
      // required for right-click context menu action to delete subject schemas
      "window.menuStyle": "custom",
    });

    // delete the subject if it was created during the test
    if (subjectName) {
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

      // find the schema item in the Schemas view
      const subjectLocator: Locator = schemasView.subjects.filter({ hasText: subjectName });
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

      const deletionNotifications = notificationArea.infoNotifications.filter({
        hasText: /hard deleted/,
      });
      await expect(deletionNotifications.first()).toBeVisible();
    }
  });

  // test dimensions:
  const connectionTypes: Array<
    [ConnectionType, Tag, (page: Page, electronApp: ElectronApplication) => Promise<void>]
  > = [
    [
      ConnectionType.Ccloud,
      Tag.CCloud,
      async (page, electronApp) => {
        await setupCCloudConnection(
          page,
          electronApp,
          process.env.E2E_USERNAME!,
          process.env.E2E_PASSWORD!,
        );

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
      },
    ],
    [
      ConnectionType.Direct,
      Tag.Direct,
      async (page) => {
        await setupDirectConnection(page, {
          formConnectionType: FormConnectionType.ConfluentCloud,
          schemaRegistryConfig: {
            uri: process.env.E2E_SR_URL!,
            authType: SupportedAuthType.API,
            credentials: {
              apiKey: process.env.E2E_SR_API_KEY!,
              apiSecret: process.env.E2E_SR_API_SECRET!,
            },
          },
        });
        // then click on the first (CCloud) Schema Registry to focus it in the Schemas view
        const directSchemaRegistries: Locator = resourcesView.directSchemaRegistries;
        await expect(directSchemaRegistries).not.toHaveCount(0);
        const firstSchemaRegistry: Locator = directSchemaRegistries.first();
        await firstSchemaRegistry.click();
        // NOTE: we don't care about testing SR selection from the Resources view vs the Schemas
        // view for these tests, so we're just picking from the Resources view here
      },
    ],
    // FUTURE: add support for LOCAL connections, see https://github.com/confluentinc/vscode/issues/2140
  ];
  const schemaTypes: Array<[string, string]> = [
    ["AVRO", "avsc"],
    ["JSON", "json"],
    ["PROTOBUF", "proto"],
  ];

  for (const [connectionType, connectionTag, connectionSetup] of connectionTypes) {
    test.describe(`${connectionType} Connection`, { tag: [connectionTag] }, () => {
      test.beforeEach(async ({ page, electronApp }) => {
        // set up the connection based on type
        await connectionSetup(page, electronApp);
        schemasView = new SchemasView(page);
        await expect(schemasView.header).toHaveAttribute("aria-expanded", "true");
      });

      for (const [schemaType, fileExtension] of schemaTypes) {
        const schemaFile = `schemas/customer.${fileExtension}`;

        test(`${schemaType}: should create a new subject and upload the first schema version`, async ({
          page,
        }) => {
          subjectName = await createSchemaVersion(page, schemaType, schemaFile);

          const successNotifications: Locator = notificationArea.infoNotifications.filter({
            hasText: /Schema registered to new subject/,
          });
          await expect(successNotifications.first()).toBeVisible();

          const subjectLocator: Locator = schemasView.subjects.filter({ hasText: subjectName });
          await expect(subjectLocator).toBeVisible();
        });

        test(`${schemaType}: should create a new schema version with valid/compatible changes`, async ({
          page,
        }) => {
          subjectName = await createSchemaVersion(page, schemaType, schemaFile);
          // try to evolve the newly-created schema
          const subjectLocator: Locator = schemasView.subjects.filter({ hasText: subjectName });
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
          const subjectLocator: Locator = schemasView.subjects.filter({ hasText: subjectName });
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

          const errorNotifications: Locator = notificationArea.errorNotifications.filter({
            hasText: "Conflict with prior schema version",
          });
          await expect(errorNotifications.first()).toBeVisible();

          // since we didn't create a second schema version, we should still be able to delete
          // the subject based on the fact that there is still only one version
          deletionConfirmation = "v1";
        });
      }
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
    await subjectInputBox.input.fill(generatedSubjectName);
    await subjectInputBox.confirm();

    // clear out and close the untitled document after uploading so we only have one editor open
    // during the rest of the tests'
    await untitledDocument.deleteAll();
    await untitledDocument.close();

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
