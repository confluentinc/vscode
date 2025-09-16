import { ElectronApplication, expect, Page } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { ResourcesView } from "../objects/views/ResourcesView";
import { SupportView } from "../objects/views/SupportView";
import { SelectKafkaCluster, TopicsView } from "../objects/views/TopicsView";
import { KafkaClusterItem } from "../objects/views/viewItems/KafkaClusterItem";
import { TopicItem } from "../objects/views/viewItems/TopicItem";
import {
  FormConnectionType,
  SupportedAuthType,
} from "../objects/webviews/DirectConnectionFormWebview";
import { ProjectScaffoldWebview } from "../objects/webviews/ProjectScaffoldWebview";
import { Tag } from "../tags";
import { setupCCloudConnection, setupDirectConnection } from "../utils/connections";
import { configureVSCodeSettings } from "../utils/settings";
import { openConfluentSidebar } from "../utils/sidebarNavigation";
import { verifyGeneratedProject } from "./utils/scaffold";

/**
 * E2E test suite for testing the Project Scaffolding functionality.
 * {@see https://github.com/confluentinc/vscode/issues/1840}
 */

test.describe("Project Scaffolding", () => {
  test.beforeEach(async ({ page, electronApp }) => {
    await openConfluentSidebar(page);

    // Stub the showOpen dialog
    // Will lead to generated projects being stored in a temp directory
    const tmpProjectDir = mkdtempSync(path.join(tmpdir(), "vscode-test-scaffold-"));
    await stubMultipleDialogs(electronApp, [
      {
        method: "showOpenDialog",
        value: {
          filePaths: [tmpProjectDir],
        },
      },
    ]);
  });

  // Templates covered by the E2E tests
  // Each item holds the display name and the name/identifier of a template
  const templates: Array<[string, string]> = [
    ["Kafka Client in Go", "go-client"],
    ["Kafka Client in Java", "java-client"],
    ["Kafka Client in JavaScript", "javascript-client"],
    ["Kafka Client in .NET", "dotnet-client"],
  ];

  // Connection types covered by the E2E tests
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
      },
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
        });
      },
    ],
    // TODO: add support for LOCAL connections, see https://github.com/confluentinc/vscode/issues/2140
  ];

  for (const [templateDisplayName, templateName] of templates) {
    test(`should apply ${templateDisplayName} template from Support view`, async ({ page }) => {
      // Given we navigate to the Support view
      const supportView = new SupportView(page);
      // and we start the generate project flow
      await supportView.clickTreeItem("Generate Project from Template");
      // and we choose a project template from the quickpick
      const projectQuickpick = new Quickpick(page);
      await projectQuickpick.selectItemByText(templateDisplayName);
      // and we provide a simple example configuration and submit the form
      const scaffoldForm = new ProjectScaffoldWebview(page);
      await scaffoldForm.bootstrapServersField.fill("localhost:9092");
      await scaffoldForm.submitForm();

      // Then we should see that the project was generated successfully
      await verifyGeneratedProject(page, templateName, "localhost:9092");
    });

    for (const [connectionType, connectionTag, connectionSetup] of connectionTypes) {
      test.describe(`${connectionType} connection`, { tag: [connectionTag] }, () => {
        test.beforeEach(async ({ page, electronApp }) => {
          // set up the connection based on type
          await connectionSetup(page, electronApp);
          await configureVSCodeSettings(page, electronApp, {
            // required for right-click context menu action
            "window.menuStyle": "custom",
          });
        });

        test(`should apply ${templateDisplayName} template from Kafka topic in Topics view`, async ({
          page,
        }) => {
          // Given we navigate to a topic in the Topics view
          const topicsView = new TopicsView(page);
          await topicsView.loadTopics(connectionType, SelectKafkaCluster.FromResourcesView);
          await expect(topicsView.topics).not.toHaveCount(0);
          const topicItem = new TopicItem(page, topicsView.topics.first());
          await expect(topicItem.locator).toBeVisible();
          // and we start the generate project flow from the right-click context menu
          await topicItem.generateProject();
          // and we choose a project template from the quickpick
          const projectQuickpick = new Quickpick(page);
          await projectQuickpick.selectItemByText(templateDisplayName);
          // and we submit the form using the pre-filled configuration
          const scaffoldForm = new ProjectScaffoldWebview(page);
          await expect(scaffoldForm.bootstrapServersField).not.toBeEmpty();
          const bootstrapServers = await scaffoldForm.bootstrapServersField.inputValue();
          await expect(scaffoldForm.topicField).not.toBeEmpty();
          const topic = await scaffoldForm.topicField.inputValue();
          await scaffoldForm.submitForm();

          // Then we should see that the project was generated successfully
          // and that the configuration holds the correct bootstrapServers and topic values
          await verifyGeneratedProject(page, templateName, bootstrapServers, topic);
        });

        test(`should apply ${templateDisplayName} template from Kafka cluster in Resource view`, async ({
          page,
        }) => {
          // Given we navigate to a cluster in the Resources view
          const resourcesView = new ResourcesView(page);
          const cluster = await resourcesView.getKafkaCluster(connectionType);
          const clusterItem = new KafkaClusterItem(page, cluster);
          await expect(clusterItem.locator).toBeVisible();
          // and we start the generate project flow from the right-click context menu
          await clusterItem.generateProject();
          // and we choose a project template from the quickpick
          const projectQuickpick = new Quickpick(page);
          await projectQuickpick.selectItemByText(templateDisplayName);
          // and we submit the form using the pre-filled configuration
          const scaffoldForm = new ProjectScaffoldWebview(page);
          await expect(scaffoldForm.bootstrapServersField).not.toBeEmpty();
          const bootstrapServers = await scaffoldForm.bootstrapServersField.inputValue();
          await scaffoldForm.submitForm();

          // Then we should see that the project was generated successfully
          // and that the configuration holds the correct bootstrapServers value
          await verifyGeneratedProject(page, templateName, bootstrapServers);
        });
      });
    }
  }
});
