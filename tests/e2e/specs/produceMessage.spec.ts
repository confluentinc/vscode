import { expect } from "@playwright/test";
import { loadFixtureFromFile } from "../../fixtures/utils";
import { test } from "../baseTest";
import type { TextDocument } from "../objects/editor/TextDocument";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { SchemasView, SchemaType, SelectSchemaRegistry } from "../objects/views/SchemasView";
import { SelectKafkaCluster, TopicsView } from "../objects/views/TopicsView";
import { TopicItem } from "../objects/views/viewItems/TopicItem";
import { Tag } from "../tags";
import { ConnectionType } from "../types/connection";
import { openNewUntitledDocument } from "../utils/documents";

/**
 * E2E test suite for testing the produce message functionality, with and without associated schemas.
 * {@see https://github.com/confluentinc/vscode/issues/1840}
 *
 * Test flow:
 * 1. Set up connection (CCloud, Direct, or Local)
 * 2. Select a Kafka cluster
 * 3. Create a topic
 * 4. Set up schema, if necessary:
 *    a. Skip for no-schema scenario
 *    b. Create a new subject with an initial schema version
 * 5. Try to produce a message by clicking the `confluent-new-message` icon (envelope with magnifying glass)
 *    a. Good scenario: should produce the message and show a success notification
 *    b. Bad scenario: should raise a basic JSON validation error and show a diagnostic in the editor
 *  (if we're working with a schema):
 *    c. Ugly scenario: should raise a schema validation error and show a diagnostic in the editor
 * 6. Clean up by deleting the topic, and any schema+subject that was created
 */

test.describe("Produce Message(s) to Topic", { tag: [Tag.ProduceMessageToTopic] }, () => {
  let topicItem: TopicItem;
  let subjectName: string;

  // tests here will only ever create one schema version
  const deletionConfirmation = "v1";

  test.beforeEach(async ({ page }) => {
    subjectName = "";
  });

  // test dimensions:
  const connectionTypes: Array<[ConnectionType, Tag]> = [
    [ConnectionType.Ccloud, Tag.CCloud],
    [ConnectionType.Direct, Tag.Direct],
    [ConnectionType.Local, Tag.Local],
  ];
  const schemaTypes: Array<[SchemaType | null, string | null]> = [
    [null, null],
    [SchemaType.Avro, "avsc"],
    [SchemaType.Json, "json"],
    [SchemaType.Protobuf, "proto"],
  ];

  for (const [connectionType, connectionTag] of connectionTypes) {
    test.describe(
      `${connectionType} connection`,
      { tag: [connectionTag, Tag.RequiresTopic] },
      () => {
        for (const [schemaType, fileExtension] of schemaTypes) {
          test.describe(schemaType ? `${schemaType} schema` : "(no schema)", () => {
            const schemaSuffix = schemaType ? schemaType.toLowerCase() : "no-schema";

            // specify the connection type to use with the `connectionItem` fixture, and the topic to
            // create with the `topic` fixture
            test.use({
              connectionType,
              topicConfig: { name: `e2e-produce-message-${schemaSuffix}` },
            });

            test.beforeEach(async ({ page, connectionItem, topic: topicName }) => {
              // ensure connection tree item has resources available to work with
              await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");

              const topicsView = new TopicsView(page);
              // click a Kafka cluster from the Resources view to open and populate the Topics view
              await topicsView.loadTopics(connectionType, SelectKafkaCluster.FromResourcesView);
              let targetTopic = topicsView.topicsWithoutSchemas.filter({ hasText: topicName });

              // if we want to use a schema, create a new subject with an initial schema version to match
              // the topic we're using
              if (schemaType && fileExtension) {
                const schemasView = new SchemasView(page);
                await schemasView.loadSchemaSubjects(
                  connectionType,
                  SelectSchemaRegistry.FromResourcesView,
                );
                // create the schema version and keep track of the subject name for cleanup later
                subjectName = await schemasView.createSchemaVersion(
                  page,
                  schemaType,
                  `schemas/customer.${fileExtension}`,
                  `${topicName}-value`,
                );

                // make sure the Topics view is updated to show the topic with schemas
                // (which, in the background, will associate the topic with the subject we created,
                // which then informs the schema key/value/etc quickpick during the produce flow)
                await topicsView.clickRefresh();
                targetTopic = topicsView.topicsWithSchemas.filter({
                  hasText: topicName,
                });
              }

              // until we can delete topics, we may have too many to show at once in the view, so
              // scroll the target topic into view before trying to click it
              await targetTopic.scrollIntoViewIfNeeded();
              topicItem = new TopicItem(page, targetTopic.first());
              await expect(topicItem.locator).toBeVisible();
            });

            test.afterEach(async ({ page, electronApp }) => {
              // delete the subject if it was created during the test
              if (subjectName) {
                const schemasView = new SchemasView(page);
                await schemasView.deleteSchemaSubject(
                  page,
                  electronApp,
                  subjectName,
                  deletionConfirmation,
                );
              }
            });

            test("should successfully produce a message", async ({ page }) => {
              // open a new JSON editor and add "good" content
              const document: TextDocument = await openNewUntitledDocument(page, "json");
              const messageContent: string = loadFixtureFromFile("produceMessages/good.json");
              await document.insertContent(messageContent);

              await topicItem.clickSendMessages();
              // click the currently open document item in the document/URI quickpick
              const documentQuickpick = new Quickpick(page);
              await expect(documentQuickpick.locator).toBeVisible();
              const currentDocumentItem = documentQuickpick.items.filter({
                hasText: "Untitled",
              });
              await expect(currentDocumentItem).not.toHaveCount(0);
              await currentDocumentItem.click();
              // confirm the default selection in the schema multi-select quickpick
              const schemaQuickpick = new Quickpick(page);
              await expect(schemaQuickpick.locator).toBeVisible();
              // we could check the default selection(s) here based on which schemas are used (key,
              // value, key+value, etc) but that isn't necessary for now
              await schemaQuickpick.confirm();

              // expect info notification about successfully producing the message
              const notificationArea = new NotificationArea(page);
              const successNotifications = notificationArea.infoNotifications.filter({
                hasText: /Successfully produced 1 message to topic/,
              });
              await expect(successNotifications).not.toHaveCount(0);
            });

            test("should show a JSON validation error when producing a bad message", async ({
              page,
            }) => {
              // open a new JSON editor and add content that's missing the required 'key' field
              const document: TextDocument = await openNewUntitledDocument(page, "json");
              const badMessageContent: string = loadFixtureFromFile(
                "produceMessages/bad_missing-key.json",
              );
              await document.insertContent(badMessageContent);

              await topicItem.clickSendMessages();
              // click the currently open document item in the document/URI quickpick
              const documentQuickpick = new Quickpick(page);
              await expect(documentQuickpick.locator).toBeVisible();
              const currentDocumentItem = documentQuickpick.items.filter({
                hasText: "Untitled",
              });
              await expect(currentDocumentItem).not.toHaveCount(0);
              await currentDocumentItem.click();
              // no schema quickpick since we should show an error notification before getting to that point

              await expect(document.errorDiagnostics).not.toHaveCount(0);

              // expect error notification about basic JSON validation failure
              const notificationArea = new NotificationArea(page);
              const errorNotifications = notificationArea.errorNotifications.filter({
                hasText: /JSON schema validation failed/,
              });
              await expect(errorNotifications).toHaveCount(1);
            });

            if (schemaType) {
              test("should show a schema validation error when producing a bad message", async ({
                page,
              }) => {
                // open a new JSON editor and add content that doesn't follow the schema
                const document: TextDocument = await openNewUntitledDocument(page, "json");
                const uglyMessageContent: string = loadFixtureFromFile(
                  "produceMessages/ugly_schema-validation-error.json",
                );
                await document.insertContent(uglyMessageContent);

                await topicItem.clickSendMessages();
                // click the currently open document item in the document/URI quickpick
                const documentQuickpick = new Quickpick(page);
                await expect(documentQuickpick.locator).toBeVisible();
                const currentDocumentItem = documentQuickpick.items.filter({
                  hasText: "Untitled",
                });
                await expect(currentDocumentItem).not.toHaveCount(0);
                await currentDocumentItem.click();
                // confirm the default selection in the schema multi-select quickpick
                const schemaQuickpick = new Quickpick(page);
                await expect(schemaQuickpick.locator).toBeVisible();
                // we could check the default selection(s) here based on which schemas are used (key,
                // value, key+value, etc) but that isn't necessary for now
                await schemaQuickpick.confirm();

                await expect(document.errorDiagnostics).not.toHaveCount(0);

                // expect error notification about schema validation failure
                const notificationArea = new NotificationArea(page);
                const errorNotifications = notificationArea.errorNotifications.filter({
                  hasText: /Failed to produce 1 message to topic/,
                });
                await expect(errorNotifications).toHaveCount(1);
              });
            }
          });
        }
      },
    );
  }
});
