import { ElectronApplication, expect, Page } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { test } from "../baseTest";
import {
  ConnectionType,
  DirectConnectionKafkaConfig,
  DirectConnectionSchemaRegistryConfig,
  FormConnectionType,
  SupportedAuthType,
} from "../connectionTypes";
import { TextDocument } from "../objects/editor/TextDocument";
import { Notification } from "../objects/notifications/Notification";
import { NotificationArea } from "../objects/notifications/NotificationArea";
import { ResourcesView } from "../objects/views/ResourcesView";
import { SchemasView, SelectSchemaRegistry } from "../objects/views/SchemasView";
import { SelectKafkaCluster, TopicsView } from "../objects/views/TopicsView";
import { DirectConnectionItem } from "../objects/views/viewItems/DirectConnectionItem";
import { KafkaClusterItem } from "../objects/views/viewItems/KafkaClusterItem";
import { SchemaRegistryItem } from "../objects/views/viewItems/SchemaRegistryItem";
import { DirectConnectionForm } from "../objects/webviews/DirectConnectionFormWebview";
import { Tag } from "../tags";
import {
  cleanupLocalConnection,
  setupDirectConnection,
  setupLocalConnection,
} from "../utils/connections";
import { openConfluentSidebar } from "../utils/sidebarNavigation";

/**
 * E2E test suite for testing the direct connection CRUD lifecycle.
 * {@see https://github.com/confluentinc/vscode/issues/2025}
 *
 * Test flow:
 * 1. Create a connection based on the current target cluster (CCloud, local, CP)
 * 2. Fill out the configuration based on the config dimension:
 * - Kafka only
 * - Schema Registry only
 * - Kafka + Schema Registry
 * 3. Test connection within the form through the "Test" button
 * 4. Save the connection and verify it appears in the Resources view with expected child resources
 * 5. Edit the connection through the connection item's inline action
 * 6. Export the connection to a file
 * 7. Delete the connection through the connection item's inline action
 * 8. Import a connection config from a file
 */

enum ConfigType {
  Kafka = "Kafka",
  SchemaRegistry = "Schema Registry",
  KafkaAndSchemaRegistry = "Kafka+Schema Registry",
}

test.describe("Direct Connection CRUD Lifecycle", () => {
  let resourcesView: ResourcesView;
  let withLocalKafka = false;
  let withLocalSchemaRegistry = false;

  test.beforeEach(async ({ page, electronApp }) => {
    await openConfluentSidebar(page);

    resourcesView = new ResourcesView(page);

    // stub the disconnect confirmation dialog
    const confirmButtonIndex = process.platform === "linux" ? 1 : 0;
    await stubMultipleDialogs(electronApp, [
      {
        method: "showMessageBox",
        value: {
          response: confirmButtonIndex, // Simulates clicking "Yes, disconnect"
          checkboxChecked: false,
        },
      },
    ]);
  });

  test.afterEach(async ({ page }) => {
    // if we set up a local connection to "shadow" its config, make sure to stop containers
    if (withLocalKafka || withLocalSchemaRegistry) {
      await cleanupLocalConnection(page, { schemaRegistry: withLocalSchemaRegistry });
      withLocalKafka = false;
      withLocalSchemaRegistry = false;
    }
  });

  // test dimensions:
  const connectionTypes: Array<
    [
      string,
      FormConnectionType,
      // function for setting up the Kafka config
      (
        page: Page,
        electronApp: ElectronApplication,
      ) => DirectConnectionKafkaConfig | Promise<DirectConnectionKafkaConfig>,
      // function for setting up the Schema Registry config
      (
        page: Page,
        electronApp: ElectronApplication,
      ) => DirectConnectionSchemaRegistryConfig | Promise<DirectConnectionSchemaRegistryConfig>,
    ]
  > = [
    [
      "CCloud API key+secret",
      FormConnectionType.ConfluentCloud,
      () => {
        return {
          bootstrapServers: process.env.E2E_KAFKA_BOOTSTRAP_SERVERS!,
          authType: SupportedAuthType.API,
          credentials: {
            api_key: process.env.E2E_KAFKA_API_KEY!,
            api_secret: process.env.E2E_KAFKA_API_SECRET!,
          },
        };
      },
      () => {
        return {
          uri: process.env.E2E_SR_URL!,
          authType: SupportedAuthType.API,
          credentials: {
            api_key: process.env.E2E_SR_API_KEY!,
            api_secret: process.env.E2E_SR_API_SECRET!,
          },
        };
      },
    ],
    [
      "Local shadow",
      FormConnectionType.ApacheKafka,
      async (page: Page, electronApp: ElectronApplication) => {
        withLocalKafka = true;
        withLocalSchemaRegistry = true;
        // set up a local connection first to "shadow" its config
        await setupLocalConnection(page, { kafka: true, schemaRegistry: true });
        // right-click to copy the bootstrap servers to the clipboard for pasting into the form
        await electronApp.context().grantPermissions(["clipboard-read"]);
        const localKafka = await resourcesView.getKafkaCluster(ConnectionType.Local);
        await expect(localKafka).not.toHaveCount(0);
        const localKafkaItem = new KafkaClusterItem(page, localKafka.first());
        await localKafkaItem.copyBootstrapServers();
        const bootstrapServers = await page.evaluate(() => navigator.clipboard.readText());
        return {
          bootstrapServers,
          authType: SupportedAuthType.None,
          credentials: {},
        };
      },
      async (page: Page, electronApp: ElectronApplication) => {
        withLocalKafka = true;
        withLocalSchemaRegistry = true;
        // set up a local connection first to "shadow" its config
        await setupLocalConnection(page, { kafka: true, schemaRegistry: true });
        // right-click to copy the SR URI to the clipboard for pasting into the form
        await electronApp.context().grantPermissions(["clipboard-read"]);
        const localSchemaRegistry = await resourcesView.getSchemaRegistry(ConnectionType.Local);
        await expect(localSchemaRegistry).not.toHaveCount(0);
        const localSchemaRegistryItem = new SchemaRegistryItem(page, localSchemaRegistry.first());
        await localSchemaRegistryItem.copyUri();
        const uri = await page.evaluate(() => navigator.clipboard.readText());
        return {
          uri,
          authType: SupportedAuthType.None,
          credentials: {},
        };
      },
    ],
    // FUTURE: add support for CP config
  ];
  const configTypes: Array<ConfigType> = [
    ConfigType.Kafka,
    ConfigType.SchemaRegistry,
    ConfigType.KafkaAndSchemaRegistry,
  ];

  for (const [
    connectionTypeName,
    formConnectionType,
    loadKafkaConfig,
    loadSchemaRegistryConfig,
  ] of connectionTypes) {
    test.describe(connectionTypeName, { tag: [Tag.Direct] }, () => {
      for (const configType of configTypes) {
        test.describe(configType, () => {
          let kafkaConfig: DirectConnectionKafkaConfig | undefined;
          let schemaRegistryConfig: DirectConnectionSchemaRegistryConfig | undefined;

          test.beforeEach(async ({ page, electronApp }) => {
            if (
              configType === ConfigType.Kafka ||
              configType === ConfigType.KafkaAndSchemaRegistry
            ) {
              kafkaConfig = await loadKafkaConfig(page, electronApp);
            }
            if (
              configType === ConfigType.SchemaRegistry ||
              configType === ConfigType.KafkaAndSchemaRegistry
            ) {
              schemaRegistryConfig = await loadSchemaRegistryConfig(page, electronApp);
            }
          });

          test("should create, edit, export, delete, and import a valid direct connection config", async ({
            page,
            electronApp,
          }) => {
            const resourcesView = new ResourcesView(page);

            // 1. create the connection
            const connectionName = `Playwright ${connectionTypeName} (${configType})`;
            const connectionItem: DirectConnectionItem = await setupDirectConnection(page, {
              name: connectionName,
              formConnectionType,
              kafkaConfig,
              schemaRegistryConfig,
            });
            await expectConnectionResources(resourcesView, configType);

            // 2. edit the connection
            const form: DirectConnectionForm = await connectionItem.clickEditConnection();
            await expect(form.formHeader).toContainText("Edit connection details");
            const newName = `${connectionName} v2`;
            await form.nameField.clear();
            await form.fillConnectionName(newName);
            await form.updateButton.click();
            // make sure the resources view refreshes and shows the updated connection name
            await expect(connectionItem.label).toHaveText(newName);

            // 3. export the connection to a JSON file
            const tmpConnectionDir = mkdtempSync(join(tmpdir(), "vscode-test-direct-connection-"));
            await stubMultipleDialogs(electronApp, [
              {
                method: "showOpenDialog",
                value: {
                  filePaths: [tmpConnectionDir],
                },
              },
            ]);
            await connectionItem.clickExportConnectionDetails();
            const notificationArea = new NotificationArea(page);
            await expect(notificationArea.infoNotifications).toHaveCount(1);
            const notification = new Notification(page, notificationArea.infoNotifications.first());
            await expect(notification.message).toContainText("Connection file saved at");
            // inspect exported file contents
            await notification.clickActionButton("Open File");
            // same name transformation as what `confluent.connections.direct.export` uses
            const exportFileName = `${newName.trim().replace(/\s+/g, "_")}.json`;
            const exportDoc = new TextDocument(page, exportFileName);
            await expect(exportDoc.tab).toBeVisible();
            await expect(exportDoc.editorContent).toContainText(`"name": "${newName}"`);

            // 4. disconnect
            await connectionItem.clickDisconnect();
            // warning modal is already stubbed to confirm disconnect
            await expect(resourcesView.directConnections).toHaveCount(0);

            // 5. import the exported connection file
            await stubMultipleDialogs(electronApp, [
              {
                method: "showOpenDialog",
                value: {
                  filePaths: [join(tmpConnectionDir, exportFileName)],
                },
              },
            ]);
            const importForm: DirectConnectionForm =
              await resourcesView.addNewConnectionFromFileImport();
            await expect(importForm.formHeader).toContainText("Import connection");
            await importForm.nameField.clear();
            const importName = `Imported ${newName}`;
            await importForm.fillConnectionName(importName);
            await importForm.saveButton.click();

            // 6. focus the connection resources (Topics and/or Schemas views, depending on config)
            const topicsView = new TopicsView(page);
            const schemasView = new SchemasView(page);
            await focusConnectionResources(topicsView, schemasView, configType);

            // 7. disconnect again and verify Topics and/or Schemas views reset
            const importedConnection = await resourcesView.getDirectConnection(importName);
            await expect(importedConnection).toHaveCount(1);
            const importedConnectionItem = new DirectConnectionItem(
              page,
              importedConnection.first(),
            );
            await expect(importedConnectionItem.locator).toBeVisible();
            await connectionItem.clickDisconnect();
            await expect(resourcesView.directConnections).toHaveCount(0);
            await expect(topicsView.topics).toHaveCount(0);
            await expect(schemasView.subjects).toHaveCount(0);
          });

          test("should show error information for an invalid connection config", async ({
            page,
          }) => {
            const connectionName = `INVALID Playwright ${connectionTypeName} (${configType})`;
            const connectionItem: DirectConnectionItem = await setupDirectConnection(
              page,
              {
                name: connectionName,
                formConnectionType,
                kafkaConfig: kafkaConfig
                  ? { ...kafkaConfig, bootstrapServers: "invalid:1234" }
                  : undefined,
                schemaRegistryConfig: schemaRegistryConfig
                  ? { ...schemaRegistryConfig, uri: "http://invalid:1234" }
                  : undefined,
              },
              true, // expect an error after clicking "Test" and confirm the view item isn't expandable
            );
            // connection should still be visible, but:
            // - it should have a warning icon
            // - its tooltip should show "Unable to connect to" with other details
            await expect(connectionItem.icon).toHaveClass(/warning/);
            const tooltip = await connectionItem.showTooltip();
            await expect(tooltip).toContainText("Unable to connect to");

            const notificationArea = new NotificationArea(page);
            const errorNotifications = notificationArea.errorNotifications.filter({
              hasText: "Failed to establish connection",
            });
            await expect(errorNotifications).toHaveCount(1);
            const notification = new Notification(page, errorNotifications.first());
            await notification.dismiss();
          });
        });
      }
    });
  }
});

/** Verify that the expected resources appear in the Resources view for the given {@link ConfigType}. */
async function expectConnectionResources(
  resourcesView: ResourcesView,
  configType: ConfigType,
): Promise<void> {
  if (configType === ConfigType.Kafka || configType === ConfigType.KafkaAndSchemaRegistry) {
    const kafkaCluster = await resourcesView.getKafkaCluster(ConnectionType.Direct);
    await expect(kafkaCluster).toHaveCount(1);
  }
  if (
    configType === ConfigType.SchemaRegistry ||
    configType === ConfigType.KafkaAndSchemaRegistry
  ) {
    const schemaRegistry = await resourcesView.getSchemaRegistry(ConnectionType.Direct);
    await expect(schemaRegistry).toHaveCount(1);
  }
}

/** Focus the Topics and/or Schemas views to load resources for the given {@link ConfigType}. */
async function focusConnectionResources(
  topicsView: TopicsView,
  schemasView: SchemasView,
  configType: ConfigType,
): Promise<void> {
  if (configType === ConfigType.Kafka || configType === ConfigType.KafkaAndSchemaRegistry) {
    await topicsView.loadTopics(ConnectionType.Direct, SelectKafkaCluster.FromResourcesView);
  }
  if (
    configType === ConfigType.SchemaRegistry ||
    configType === ConfigType.KafkaAndSchemaRegistry
  ) {
    await schemasView.loadSchemaSubjects(
      ConnectionType.Direct,
      SelectSchemaRegistry.FromResourcesView,
    );
  }
}
