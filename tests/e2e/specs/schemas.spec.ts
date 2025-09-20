import { expect, Locator } from "@playwright/test";
import { loadFixtureFromFile } from "../../fixtures/utils";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import { TextDocument } from "../objects/editor/TextDocument";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { SchemasView, SchemaType, SelectSchemaRegistry } from "../objects/views/SchemasView";
import { SubjectItem } from "../objects/views/viewItems/SubjectItem";
import { Tag } from "../tags";

/**
 * E2E test suite for testing the whole schema management flow in the extension.
 * {@see https://github.com/confluentinc/vscode/issues/1839}
 *
 * Test flow:
 * 1. Set up connection (CCloud, Direct, or Local)
 * 2. Select a Schema Registry
 * 3. Create a new subject with an initial schema version
 * 4. Try to evolve the schema to a new version
 *    a. Valid/compatible schema update
 *    b. Invalid/incompatible schema update
 * 5. Clean up by deleting the subject
 */

test.describe("Schema Management", () => {
  let subjectName: string;
  // most tests only create one schema version, but the "should evolve schema to second version" test
  // should create a second version, which will change this to the subject name itself
  let deletionConfirmation = "v1";

  test.beforeEach(() => {
    subjectName = "";
  });

  test.afterEach(async ({ page, electronApp }) => {
    // delete the subject if it was created during the test
    if (subjectName) {
      const schemasView = new SchemasView(page);
      await schemasView.deleteSchemaSubject(page, electronApp, subjectName, deletionConfirmation);
    }
  });

  // test dimensions:
  const connectionTypes: Array<[ConnectionType, Tag]> = [
    [ConnectionType.Ccloud, Tag.CCloud],
    [ConnectionType.Direct, Tag.Direct],
    [ConnectionType.Local, Tag.Local],
  ];
  const schemaTypes: Array<[SchemaType, string]> = [
    [SchemaType.Avro, "avsc"],
    [SchemaType.Json, "json"],
    [SchemaType.Protobuf, "proto"],
  ];

  for (const [connectionType, connectionTag] of connectionTypes) {
    test.describe(`${connectionType} Connection`, { tag: [connectionTag] }, () => {
      // tell the `setupConnection` fixture which connection type to create
      test.use({ connectionType });

      test.beforeEach(async ({ page, connectionItem }) => {
        // ensure connection tree item has resources available to work with
        await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");

        const schemasView = new SchemasView(page);
        await schemasView.loadSchemaSubjects(
          connectionType,
          SelectSchemaRegistry.FromResourcesView,
        );
      });

      for (const [schemaType, fileExtension] of schemaTypes) {
        test.describe(`${schemaType} schema`, () => {
          const schemaFile = `schemas/customer.${fileExtension}`;

          test("should create a new subject and upload the first schema version", async ({
            page,
          }) => {
            const schemasView = new SchemasView(page);
            subjectName = await schemasView.createSchemaVersion(page, schemaType, schemaFile);

            const notificationArea = new NotificationArea(page);
            const successNotifications: Locator = notificationArea.infoNotifications.filter({
              hasText: /Schema registered to new subject/,
            });
            await expect(successNotifications.first()).toBeVisible();

            const subjectLocator: Locator = schemasView.subjects.filter({ hasText: subjectName });
            await expect(subjectLocator).toBeVisible();
          });

          test("should create a new schema version with valid/compatible changes", async ({
            page,
          }) => {
            const schemasView = new SchemasView(page);
            subjectName = await schemasView.createSchemaVersion(page, schemaType, schemaFile);

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
            await subjectItem.clickUploadSchemaForSubject();
            // select editor/file name in the first quickpick
            const documentQuickpick = new Quickpick(page);
            await expect(documentQuickpick.locator).toBeVisible();
            await documentQuickpick.selectItemByText(expectedTabName);
            // select schema type in the next quickpick
            const uploadSchemaTypeQuickpick = new Quickpick(page);
            await expect(uploadSchemaTypeQuickpick.locator).toBeVisible();
            await uploadSchemaTypeQuickpick.selectItemByText(schemaType);

            const notificationArea = new NotificationArea(page);
            const successNotifications = notificationArea.infoNotifications.filter({
              hasText: /New version 2 registered to existing subject/,
            });
            await expect(successNotifications.first()).toBeVisible();

            // update deletion confirmation from "v1" to the subject name for proper cleanup
            // since there are now two versions
            deletionConfirmation = subjectName;
          });

          test("should reject invalid/incompatible schema evolution and not create a second version", async ({
            page,
          }) => {
            const schemasView = new SchemasView(page);
            subjectName = await schemasView.createSchemaVersion(page, schemaType, schemaFile);
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
            await subjectItem.clickUploadSchemaForSubject();
            // select editor/file name in the first quickpick
            const documentQuickpick = new Quickpick(page);
            await expect(documentQuickpick.locator).toBeVisible();
            await documentQuickpick.selectItemByText(expectedTabName);
            // select schema type in the next quickpick
            const uploadSchemaTypeQuickpick = new Quickpick(page);
            await expect(uploadSchemaTypeQuickpick.locator).toBeVisible();
            await uploadSchemaTypeQuickpick.selectItemByText(schemaType);

            const notificationArea = new NotificationArea(page);
            const errorNotifications: Locator = notificationArea.errorNotifications.filter({
              hasText: "Conflict with prior schema version",
            });
            await expect(errorNotifications.first()).toBeVisible();

            // since we didn't create a second schema version, we should still be able to delete
            // the subject based on the fact that there is still only one version
            deletionConfirmation = "v1";
          });
        });
      }
    });
  }
});
