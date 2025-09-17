import { ElectronApplication, expect, Page } from "@playwright/test";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import { ResourcesView } from "../objects/views/ResourcesView";
import { SelectKafkaCluster, TopicsView } from "../objects/views/TopicsView";
import { TopicItem } from "../objects/views/viewItems/TopicItem";
import {
  FormConnectionType,
  SupportedAuthType,
} from "../objects/webviews/DirectConnectionFormWebview";
import { MessageViewerWebview } from "../objects/webviews/MessageViewerWebview";
import { Tag } from "../tags";
import {
  setupCCloudConnection,
  setupDirectConnection,
  setupLocalConnection,
} from "../utils/connections";
import { openConfluentSidebar } from "../utils/sidebarNavigation";

/**
 * E2E test suite for testing the Topics view and Message Viewer functionality.
 * {@see https://github.com/confluentinc/vscode/issues/1703}
 *
 * Test flow:
 * 1. Set up connection:
 *    a. CCLOUD: Log in to Confluent Cloud from the sidebar auth flow
 *    b. DIRECT: Fill out the Add New Connection form and submit with Kafka connection details
 * 2. Select a Kafka cluster with topics
 *    a. Pick from the Resources view, or
 *    b. Pick from the Topics view nav action
 * 3. Topics view should have at least one topic item listed
 * 4. Click on the `confluent-new-message` icon (envelope with magnifying glass) to open the topic
 *    message viewer
 * 5. View should open with basic webview components, even if messages aren't (yet) available
 */

test.describe("Topics Listing & Message Viewer", () => {
  let resourcesView: ResourcesView;

  test.beforeEach(async ({ page }) => {
    await openConfluentSidebar(page);

    resourcesView = new ResourcesView(page);
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
    [
      ConnectionType.Local,
      Tag.Local,
      async (page) => {
        await setupLocalConnection(page, { kafka: true });
      },
    ],
  ];
  const entrypoints = [
    SelectKafkaCluster.FromResourcesView,
    SelectKafkaCluster.FromTopicsViewButton,
  ];

  for (const [connectionType, connectionTag, connectionSetup] of connectionTypes) {
    test.describe(`${connectionType} Connection`, { tag: [connectionTag] }, () => {
      test.beforeEach(async ({ page, electronApp }) => {
        // set up the connection based on type
        await connectionSetup(page, electronApp);
      });

      for (const entrypoint of entrypoints) {
        test(`should select a Kafka cluster from the ${entrypoint}, list topics, and open message viewer`, async ({
          page,
        }) => {
          const topicsView = new TopicsView(page);
          await topicsView.loadTopics(connectionType, entrypoint);

          // now the Topics view should show at least one topic item
          await expect(topicsView.topics).not.toHaveCount(0);
          const firstTopic = new TopicItem(page, topicsView.topics.first());
          const messageViewer: MessageViewerWebview = await firstTopic.clickViewMessages();

          // the message viewer webview should now be visible in the editor area
          await expect(messageViewer.messageViewerSettings).toBeVisible();
          await expect(messageViewer.content).toBeVisible();
          await expect(messageViewer.paginationControls).toBeVisible();
        });
      }
    });
  }
});
