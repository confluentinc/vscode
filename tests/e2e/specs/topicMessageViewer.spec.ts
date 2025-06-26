import { expect, Locator } from "@playwright/test";
import { test } from "../baseTest";
import { NotificationToast } from "../objects/notifications/NotificationToast";
import { NotificationToasts } from "../objects/notifications/NotificationToasts";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { QuickpickItem } from "../objects/quickInputs/QuickpickItem";
import { ResourcesView } from "../objects/views/ResourcesView";
import { TopicsView } from "../objects/views/TopicsView";
import { ViewItem } from "../objects/views/ViewItem";
import { DirectConnectionForm } from "../objects/webviews/DirectConnectionFormWebview";
import { MessageViewerWebview } from "../objects/webviews/MessageViewerWebview";
import { CollapsibleState, expand, getCollapsibleState } from "../utils/expansion";
import { openConfluentExtension } from "./utils/confluent";
import { login } from "./utils/confluentCloud";

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

test.describe("Topic Message Viewer: CCLOUD connection", () => {
  let resourcesView: ResourcesView;

  test.beforeEach(async ({ page, electronApp }) => {
    await openConfluentExtension(page);
    resourcesView = new ResourcesView(page);
    await resourcesView.focus();

    // CCloud connection setup:
    await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);
    // make sure the "Confluent Cloud" item in the Resources view is expanded and doesn't show the
    // "(Not Connected)" description
    const ccloudItem: Locator = resourcesView.confluentCloudItem;
    await expect(ccloudItem).toBeVisible();
    await expect(ccloudItem).not.toHaveText("(Not Connected)");
    expect(await getCollapsibleState(ccloudItem)).toBe(CollapsibleState.Expanded);
  });

  test("should select a Kafka cluster from the Resources view, list topics, and open message viewer", async ({
    page,
    electronApp,
  }) => {
    // expand the first (CCloud) environment to show Kafka clusters, Schema Registry, and maybe
    // Flink compute pools
    await expect(resourcesView.ccloudEnvironments).not.toHaveCount(0);
    const firstEnvironment: Locator = resourcesView.ccloudEnvironments.first();
    await expand(firstEnvironment);
    expect(await getCollapsibleState(firstEnvironment)).toBe(CollapsibleState.Expanded);

    // then click on the first (CCloud) Kafka cluster to select it
    await expect(resourcesView.ccloudKafkaClusters).not.toHaveCount(0);
    const firstKafkaCluster: Locator = resourcesView.ccloudKafkaClusters.first();
    await firstKafkaCluster.click();

    // now the Topics view should be expanded and show at least one topic item
    const topicsView = new TopicsView(page);
    await topicsView.focus();
    await expect(topicsView.topics).not.toHaveCount(0);
    const firstTopic = new ViewItem(page, topicsView.topics.first());
    await firstTopic.clickInlineAction("View Messages");

    // the message viewer webview should now be visible in the editor area
    const messageViewer = new MessageViewerWebview(page);
    await expect(messageViewer.messageViewerSettings).toBeVisible();
    await expect(messageViewer.content).toBeVisible();
    await expect(messageViewer.paginationControls).toBeVisible();
  });

  test("should select a Kafka cluster from the Topics view nav action, list topics, and open message viewer", async ({
    page,
    electronApp,
  }) => {
    // instead of selecting a Kafka cluster from the Resources view, we're selecting it from the
    // Topics view nav action
    const topicsView = new TopicsView(page);
    await topicsView.focus();

    // Topics view should show empty state since no cluster is selected yet
    await expect(topicsView.viewsWelcome).toContainText("No Kafka cluster selected");
    await topicsView.clickSelectKafkaCluster();

    // the Kafka cluster quickpick should open
    const kafkaClusterQuickpick = new Quickpick(page);
    await expect(kafkaClusterQuickpick.locator).toBeVisible();

    // select the first Kafka cluster from the quickpick
    const clusters: QuickpickItem[] = await kafkaClusterQuickpick.getItems({
      waitForItems: true,
    });
    expect(clusters.length).toBeGreaterThan(0);
    const firstCluster: QuickpickItem = clusters[0];
    expect(await firstCluster.iconId()).toBe("confluent-kafka-cluster");
    await firstCluster.locator.click();

    // now the Topics view should show at least one topic item
    await expect(topicsView.topics).not.toHaveCount(0);
    const firstTopic = new ViewItem(page, topicsView.topics.first());
    await firstTopic.clickInlineAction("View Messages");

    // the message viewer webview should now be visible in the editor area
    const messageViewer = new MessageViewerWebview(page);
    await expect(messageViewer.messageViewerSettings).toBeVisible();
    await expect(messageViewer.content).toBeVisible();
    await expect(messageViewer.paginationControls).toBeVisible();
  });
});

test.describe("Topic Message Viewer: DIRECT connection", () => {
  let resourcesView: ResourcesView;

  test.beforeEach(async ({ page, electronApp }) => {
    await openConfluentExtension(page);
    resourcesView = new ResourcesView(page);
    await resourcesView.focus();

    // direct connection setup:
    const connectionForm: DirectConnectionForm = await resourcesView.openDirectConnectionForm();
    const connectionName = "Playwright";
    await connectionForm.configureWithApiKeyAndSecret({
      name: connectionName,
      connectionType: "Confluent Cloud",
      kafka: {
        apiKey: process.env.E2E_KAFKA_API_KEY!,
        apiSecret: process.env.E2E_KAFKA_API_SECRET!,
        bootstrapServers: process.env.E2E_KAFKA_BOOTSTRAP_SERVERS!,
      },
    });
    await connectionForm.testConnection();
    await expect(connectionForm.successMessage).toBeVisible();
    await connectionForm.saveConnection();

    // wait for the progress notification to disappear before continuing
    const notificationToasts = new NotificationToasts(page);
    // only wait on the progress notification to resolve if it's visible at all
    const progressNotification: NotificationToast | null = await notificationToasts.findByMessage(
      `Waiting for "${connectionName}" to be usable...`,
    );
    await progressNotification?.waitForProgressCompletion();
    // wait for the Resources view to refresh and show the new direct connection
    await expect(resourcesView.directConnections).not.toHaveCount(0);
    await expect(resourcesView.directConnections.first()).toHaveText(connectionName);
  });

  test("should select a Kafka cluster from the Resources view, list topics, and open message viewer", async ({
    page,
    electronApp,
  }) => {
    // expand the first direct connection to show its Kafka cluster and Schema Registry
    await expect(resourcesView.directConnections).not.toHaveCount(0);
    const firstConnection = resourcesView.directConnections.first();
    await expand(firstConnection);
    expect(await getCollapsibleState(firstConnection)).toBe(CollapsibleState.Expanded);

    // then click on the first (direct) Kafka cluster to select it
    const directKafkaClusters: Locator = resourcesView.directKafkaClusters;
    await expect(directKafkaClusters).not.toHaveCount(0);
    const firstKafkaCluster = directKafkaClusters.first();
    await firstKafkaCluster.click();

    // now the Topics view should be expanded and show at least one topic item
    const topicsView = new TopicsView(page);
    await topicsView.focus();
    await expect(topicsView.topics).not.toHaveCount(0);
    const firstTopic = new ViewItem(page, topicsView.topics.first());
    await firstTopic.clickInlineAction("View Messages");

    // the message viewer webview should now be visible in the editor area
    const messageViewer = new MessageViewerWebview(page);
    await expect(messageViewer.messageViewerSettings).toBeVisible();
    await expect(messageViewer.content).toBeVisible();
    await expect(messageViewer.paginationControls).toBeVisible();
  });

  test("should select a Kafka cluster from the Topics view nav action, list topics, and open message viewer", async ({
    page,
    electronApp,
  }) => {
    // instead of selecting a Kafka cluster from the Resources view, we're selecting it from the
    // Topics view nav action
    const topicsView = new TopicsView(page);
    await topicsView.focus();

    // Topics view should show empty state since no cluster is selected yet
    await expect(topicsView.viewsWelcome).toContainText("No Kafka cluster selected");
    await topicsView.clickSelectKafkaCluster();

    // the Kafka cluster quickpick should open
    const kafkaClusterQuickpick = new Quickpick(page);
    await expect(kafkaClusterQuickpick.locator).toBeVisible();

    // select the first Kafka cluster from the quickpick
    const clusters: QuickpickItem[] = await kafkaClusterQuickpick.getItems({
      waitForItems: true,
    });
    expect(clusters.length).toBeGreaterThan(0);
    const firstCluster: QuickpickItem = clusters[0];
    expect(await firstCluster.iconId()).toBe("confluent-kafka-cluster");
    await firstCluster.locator.click();

    // now the Topics view should show at least one topic item
    await expect(topicsView.topics).not.toHaveCount(0);
    const firstTopic = new ViewItem(page, topicsView.topics.first());
    await firstTopic.clickInlineAction("View Messages");

    // the message viewer webview should now be visible in the editor area
    const messageViewer = new MessageViewerWebview(page);
    await expect(messageViewer.messageViewerSettings).toBeVisible();
    await expect(messageViewer.content).toBeVisible();
    await expect(messageViewer.paginationControls).toBeVisible();
  });
});
