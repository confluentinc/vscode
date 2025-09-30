import { expect } from "@playwright/test";
import { stubMultipleDialogs } from "electron-playwright-helpers";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import { TextDocument } from "../objects/editor/TextDocument";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { ResourcesView } from "../objects/views/ResourcesView";
import { SupportView } from "../objects/views/SupportView";
import {
  DEFAULT_CCLOUD_TOPIC_REPLICATION_FACTOR,
  SelectKafkaCluster,
  TopicsView,
} from "../objects/views/TopicsView";
import { View } from "../objects/views/View";
import { FlinkComputePoolItem } from "../objects/views/viewItems/FlinkComputePoolItem";
import { KafkaClusterItem } from "../objects/views/viewItems/KafkaClusterItem";
import { TopicItem } from "../objects/views/viewItems/TopicItem";
import { ProjectScaffoldWebview } from "../objects/webviews/ProjectScaffoldWebview";
import { Tag } from "../tags";
import { openGeneratedProjectInCurrentWindow, verifyGeneratedProject } from "../utils/scaffold";
import { openConfluentSidebar } from "../utils/sidebarNavigation";

const TEST_ENV_NAME = "main-test-env";
const TEST_COMPUTE_POOL_NAME = "main-test-pool";
const TEST_COMPUTE_POOL_ID = "lfcp-5ovn9q";

/**
 * E2E test suite for testing the Project Scaffolding functionality.
 * {@see https://github.com/confluentinc/vscode/issues/1840}
 */

test.describe("Project Scaffolding", () => {
  test.beforeEach(async ({ electronApp }) => {
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
  const connectionTypes: Array<[ConnectionType, Tag, number]> = [
    [ConnectionType.Ccloud, Tag.CCloud, DEFAULT_CCLOUD_TOPIC_REPLICATION_FACTOR],
    [ConnectionType.Direct, Tag.Direct, DEFAULT_CCLOUD_TOPIC_REPLICATION_FACTOR],
    [ConnectionType.Local, Tag.Local, 1],
  ];

  test.describe("CCloud connection", { tag: [Tag.CCloud] }, () => {
    test.use({ connectionType: ConnectionType.Ccloud });

    test.beforeEach(async ({ connectionItem }) => {
      // ensure connection tree item has resources available to work with
      await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");
    });

    test(`should apply Flink Table API In Java For Confluent Cloud template from Flink compute pool`, async ({
      page,
    }) => {
      const resourcesView = new ResourcesView(page);
      // First, expand the CCloud env
      await expect(resourcesView.ccloudEnvironments).not.toHaveCount(0);
      await resourcesView.ccloudEnvironments.getByText(TEST_ENV_NAME).click();
      // Then click on a Flink compute pool
      await expect(resourcesView.ccloudFlinkComputePools).not.toHaveCount(0);
      const computePool = new FlinkComputePoolItem(
        page,
        resourcesView.ccloudFlinkComputePools.getByText(TEST_COMPUTE_POOL_NAME),
      );

      // If we start the generate project flow from the right-click context menu
      await computePool.generateProject();
      // and we choose a project template from the quickpick
      const projectQuickpick = new Quickpick(page);
      await projectQuickpick.selectItemByText("Flink Table API In Java For Confluent Cloud");
      // and we submit the form using the pre-filled configuration
      const scaffoldForm = new ProjectScaffoldWebview(page);
      await expect(scaffoldForm.computePoolIdField).not.toBeEmpty();
      await scaffoldForm.submitForm();

      // Then we should see that the project was generated successfully
      await openGeneratedProjectInCurrentWindow(page);
      // and we should see that the configuration file cloud.properties holds the correct values
      const configFileName = "cloud.properties";
      const explorerView = new View(page, "Explorer");
      for (const name of ["src", "resources", configFileName]) {
        const item = explorerView.treeItems.filter({
          hasText: name,
        });
        await expect(item).toBeVisible();
        await item.click();
      }
      const configFileDocument = new TextDocument(page, configFileName);
      await expect(configFileDocument.tab).toBeVisible();
      await expect(configFileDocument.editorContent).toBeVisible();
      await expect(configFileDocument.editorContent).toContainText(
        `client.compute-pool-id=${TEST_COMPUTE_POOL_ID}`,
      );
    });
  });

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

    for (const [connectionType, connectionTag, replicationFactor] of connectionTypes) {
      test.describe(`${connectionType} connection`, { tag: [connectionTag] }, () => {
        // only set by the template-from-topic test
        let topicName: string;

        // tell the `connectionItem` fixture which connection type to set up
        test.use({ connectionType });

        test.beforeEach(async ({ connectionItem }) => {
          // reset topic name between tests
          topicName = "";
          // ensure connection tree item has resources available to work with
          await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");
        });

        test.afterEach(async ({ page }) => {
          if (topicName) {
            // we don't need to use the `connectionItem` fixture since we didn't close down the
            // electron app between switching windows, so the connection should still be usable
            // but we do need to reopen the sidebar since the file explorer view will be open
            await openConfluentSidebar(page);
            const topicsView = new TopicsView(page);
            await topicsView.loadTopics(connectionType, SelectKafkaCluster.FromResourcesView);
            await topicsView.deleteTopic(topicName);
          }
        });

        test(`should apply ${templateDisplayName} template from Kafka topic in Topics view`, async ({
          page,
        }) => {
          topicName = `e2e-project-scaffold-${templateName}`;
          // Given we navigate to a topic in the Topics view
          const topicsView = new TopicsView(page);
          await topicsView.loadTopics(connectionType, SelectKafkaCluster.FromResourcesView);
          await topicsView.createTopic(topicName, 1, replicationFactor);
          const targetTopic = topicsView.topics.filter({ hasText: topicName });
          await expect(targetTopic).not.toHaveCount(0);
          const topicItem = new TopicItem(page, targetTopic.first());
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
