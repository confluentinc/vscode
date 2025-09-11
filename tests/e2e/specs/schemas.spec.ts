import { ElectronApplication, expect, Locator, Page } from "@playwright/test";
import { loadFixtureFromFile } from "../../fixtures/utils";
import { test } from "../baseTest";
import { TextDocument } from "../objects/editor/TextDocument";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { ResourcesView } from "../objects/views/ResourcesView";
import { SchemasView } from "../objects/views/SchemasView";
import { SubjectItem } from "../objects/views/viewItems/SubjectItem";
import {
  FormConnectionType,
  SupportedAuthType,
} from "../objects/webviews/DirectConnectionFormWebview";
import { Tag } from "../tags";
import { ConnectionType, setupCCloudConnection, setupDirectConnection } from "../utils/connections";
import {
  createSchemaVersion,
  deleteSchemaSubject,
  SchemaType,
  selectCurrentDocumentFromQuickpick,
  selectSchemaTypeFromQuickpick,
} from "../utils/schemas";
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
    // reset VS Code settings to defaults
    await configureVSCodeSettings(page, electronApp, {});

    // delete the subject if it was created during the test
    if (subjectName) {
      await deleteSchemaSubject(page, electronApp, subjectName, deletionConfirmation);
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
              api_key: process.env.E2E_SR_API_KEY!,
              api_secret: process.env.E2E_SR_API_SECRET!,
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
  const schemaTypes: Array<[SchemaType, string]> = [
    [SchemaType.Avro, "avsc"],
    [SchemaType.Json, "json"],
    [SchemaType.Protobuf, "proto"],
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
});
