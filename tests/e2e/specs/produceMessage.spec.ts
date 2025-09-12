import { ElectronApplication, expect, Page } from "@playwright/test";
import { loadFixtureFromFile } from "../../fixtures/utils";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import { TextDocument } from "../objects/editor/TextDocument";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { SchemasView, SchemaType, SelectSchemaRegistry } from "../objects/views/SchemasView";
import {
  DEFAULT_CCLOUD_TOPIC_REPLICATION_FACTOR,
  SelectKafkaCluster,
  TopicsView,
} from "../objects/views/TopicsView";
import { TopicItem } from "../objects/views/viewItems/TopicItem";
import {
  FormConnectionType,
  SupportedAuthType,
} from "../objects/webviews/DirectConnectionFormWebview";
import { Tag } from "../tags";
import { setupCCloudConnection, setupDirectConnection } from "../utils/connections";
import { openNewUntitledDocument } from "../utils/documents";
import { openConfluentSidebar } from "../utils/sidebarNavigation";

/**
 * E2E test suite for testing the produce message functionality, with and without associated schemas.
 * {@see https://github.com/confluentinc/vscode/issues/1840}
 *
 * Test flow:
 * 1. Set up connection:
 *    a. CCLOUD: Log in to Confluent Cloud from the sidebar auth flow
 *    b. DIRECT: Fill out the Add New Connection form and submit with Kafka connection details
 * 2. Select a Kafka cluster with at least one topic
 * 3. Select a topic
 * 4. Set up schema, if necessary:
 *    a. Skip for no-schema scenario
 *    b. Create a new subject with an initial schema version
 * 5. Try to produce a message by clicking the `confluent-new-message` icon (envelope with magnifying glass)
 *    a. Good scenario: should produce the message and show a success notification
 *    b. Bad scenario: should raise a basic JSON validation error and show a diagnostic in the editor
 *  (if we're working with a schema):
 *    c. Ugly scenario: should raise a schema validation error and show a diagnostic in the editor
 * 6. Clean up by deleting the subject, if created
 */

test.describe.only("Produce Message(s) to Topic", () => {
  let topicsView: TopicsView;
  let schemasView: SchemasView;

  let topic: TopicItem;
  let topicName: string;

  let notificationArea: NotificationArea;

  let subjectName: string;
  // tests here will only ever create one schema version
  const deletionConfirmation = "v1";

  test.beforeEach(async ({ page, electronApp }) => {
    subjectName = "";

    await openConfluentSidebar(page);

    topicsView = new TopicsView(page);
    notificationArea = new NotificationArea(page);
  });

  // test dimensions:
  const connectionTypes: Array<
    [ConnectionType, Tag, (page: Page, electronApp: ElectronApplication) => Promise<void>, number]
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
      },
      DEFAULT_CCLOUD_TOPIC_REPLICATION_FACTOR,
    ],
    [
      ConnectionType.Direct,
      Tag.Direct,
      async (page) => {
        await setupDirectConnection(page, {
          formConnectionType: FormConnectionType.ConfluentCloud,
          kafkaConfig: {
            bootstrapServers: process.env.E2E_KAFKA_BOOTSTRAP_SERVERS!,
            authType: SupportedAuthType.API,
            credentials: {
              api_key: process.env.E2E_KAFKA_API_KEY!,
              api_secret: process.env.E2E_KAFKA_API_SECRET!,
            },
          },
          schemaRegistryConfig: {
            uri: process.env.E2E_SR_URL!,
            authType: SupportedAuthType.API,
            credentials: {
              api_key: process.env.E2E_SR_API_KEY!,
              api_secret: process.env.E2E_SR_API_SECRET!,
            },
          },
        });
      },
      DEFAULT_CCLOUD_TOPIC_REPLICATION_FACTOR,
    ],
    // FUTURE: add support for LOCAL connections, see https://github.com/confluentinc/vscode/issues/2140
  ];
  const schemaTypes: Array<[SchemaType | null, string | null]> = [
    [null, null],
    [SchemaType.Avro, "avsc"],
    [SchemaType.Json, "json"],
    [SchemaType.Protobuf, "proto"],
  ];

  for (const [
    connectionType,
    connectionTag,
    connectionSetup,
    newTopicReplicationFactor,
  ] of connectionTypes) {
    test.describe(`${connectionType} connection`, { tag: [connectionTag] }, () => {
      test.beforeEach(async ({ page, electronApp }) => {
        // set up the connection based on type
        await connectionSetup(page, electronApp);
      });

      for (const [schemaType, fileExtension] of schemaTypes) {
        test.describe(schemaType ? `${schemaType} schema` : "(no schema)", () => {
          test.beforeEach(async ({ page }) => {
            // click a Kafka cluster from the Resources view to open and populate the Topics view
            await topicsView.loadTopics(connectionType, SelectKafkaCluster.FromResourcesView);
            // make sure we have a topic to produce messages to first
            const schemaSuffix = schemaType ? schemaType.toLowerCase() : "no-schema";
            topicName = `produce-message-${schemaSuffix}`;
            await topicsView.createTopic(topicName, 1, newTopicReplicationFactor);
            let targetTopic = topicsView.topicsWithoutSchemas.filter({ hasText: topicName });
            await targetTopic.scrollIntoViewIfNeeded();

            // if we want to use a schema, create a new subject with an initial schema version to match
            // the topic we're using
            if (schemaType && fileExtension) {
              schemasView = new SchemasView(page);
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
            topic = new TopicItem(page, targetTopic.first());
            await expect(topic.locator).toBeVisible();
          });

          test.afterEach(async ({ page, electronApp }) => {
            await topicsView.deleteTopic(topicName);

            // delete the subject if it was created during the test
            if (subjectName) {
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

            await topic.clickSendMessages();
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

            await topic.clickSendMessages();
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

              await topic.clickSendMessages();
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
              const errorNotifications = notificationArea.errorNotifications.filter({
                hasText: /Failed to produce 1 message to topic/,
              });
              await expect(errorNotifications).toHaveCount(1);
            });
          }
        });
      }
    });
  }
});
