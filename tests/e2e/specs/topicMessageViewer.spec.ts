import { expect } from "@playwright/test";
import { test } from "../baseTest";
import { NotificationToast } from "../objects/notifications/NotificationToast";
import { NotificationToasts } from "../objects/notifications/NotificationToasts";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { QuickpickItem } from "../objects/quickInputs/QuickpickItem";
import { ResourcesView } from "../objects/views/ResourcesView";
import { TopicsView } from "../objects/views/TopicsView";
import { CCloudEnvironmentItem } from "../objects/views/viewItems/CCloudEnvironmentItem";
import { CCloudItem } from "../objects/views/viewItems/CCloudItem";
import { KafkaClusterItem } from "../objects/views/viewItems/KafkaClusterItem";
import { TopicItem } from "../objects/views/viewItems/TopicItem";
import { ViewItem } from "../objects/views/viewItems/ViewItem";
import { DirectConnectionForm } from "../objects/webviews/DirectConnectionFormWebview";
import { MessageViewerWebview } from "../objects/webviews/MessageViewerWebview";
import { expand, isExpandable, isExpanded } from "../utils/expansion";
import { openConfluentExtension } from "./utils/confluent";
import { login } from "./utils/confluentCloud";

/**
 * E2E test suite for testing the Topics view and Message Viewer functionality.
 * {@see https://github.com/confluentinc/vscode/issues/1703}
 *
 * Test flow:
 * 1. Log in to Confluent Cloud from the sidebar auth flow
 * 2. Select a Kafka cluster with topics
 *    a. Pick from the Resources view, or
 *    b. Pick from the Topics view nav action
 * 3. Topics view should have at least one topic item listed
 * 4. Click on the `confluent-new-message` icon (envelope with magnifying glass) to open the topic
 *    message viewer
 * 5. View should open with basic form components, even if messages aren't (yet) available
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
    const ccloudItem: CCloudItem = await resourcesView.getConfluentCloudItem();
    // signed-in state: should not show "(Not Connected)" text and should be expandable
    await expect(ccloudItem.notConnectedText).toBeHidden({ timeout: 500 });
    await expect
      .poll(async () => await isExpandable(ccloudItem.locator), { timeout: 1_000 })
      .toBe(true);
  });

  test("should select a Kafka cluster from the Resources view, list topics, and open message viewer", async ({
    page,
    electronApp,
  }) => {
    // expand the first (CCloud) environment to show Kafka clusters, Schema Registry, and maybe
    // Flink compute pools
    const environments: CCloudEnvironmentItem[] = await resourcesView.getCCloudEnvironmentItems();
    expect(environments.length).toBeGreaterThan(0);
    const firstEnvironment: CCloudEnvironmentItem = environments[0];
    await expand(firstEnvironment.locator);
    await expect
      .poll(async () => await isExpanded(firstEnvironment.locator), { timeout: 1_000 })
      .toBe(true);

    // then click on the first (CCloud) Kafka cluster to select it
    const clusters: KafkaClusterItem[] = await resourcesView.getKafkaClusterItems({
      ccloud: true,
      local: false,
      direct: false,
    });
    expect(clusters.length).toBeGreaterThan(0);
    const firstKafkaCluster: KafkaClusterItem = clusters[0];
    await firstKafkaCluster.locator.click();
    expect(await firstKafkaCluster.isSelected()).toBe(true);

    // now the Topics view should be expanded and show at least one topic item
    const topicsView = new TopicsView(page);
    await topicsView.focus();
    const topics: TopicItem[] = await topicsView.getTopicItems();
    expect(topics.length).toBeGreaterThan(0);
    const firstTopic: TopicItem = topics[0];
    await firstTopic.clickViewMessages();

    // the message viewer webview should now be visible in the editor area
    const messageViewer = new MessageViewerWebview(page);
    await messageViewer.waitForLoadAndValidateState();
    await expect(messageViewer.locator).toBeVisible();
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
    await expect(kafkaClusterQuickpick.locator).toBeVisible({ timeout: 5_000 });

    // select the first Kafka cluster from the quickpick
    const clusters: QuickpickItem[] = await kafkaClusterQuickpick.getItems({
      waitForItems: true,
    });
    expect(clusters.length).toBeGreaterThan(0);
    const firstCluster: QuickpickItem = clusters[0];
    expect(await firstCluster.iconId()).toBe("confluent-kafka-cluster");
    await firstCluster.locator.click();

    // now the Topics view should show at least one topic item
    const topics: TopicItem[] = await topicsView.getTopicItems();
    expect(topics.length).toBeGreaterThan(0);
    const firstTopic: TopicItem = topics[0];
    await firstTopic.clickViewMessages();

    // the message viewer webview should now be visible in the editor area
    const messageViewer = new MessageViewerWebview(page);
    await messageViewer.waitForLoadAndValidateState();
    await expect(messageViewer.locator).toBeVisible();
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
    await expect
      .poll(async () => (await resourcesView.getDirectConnectionItems()).length, {
        timeout: 5_000,
      })
      .toBeGreaterThan(0);
  });

  test("should select a Kafka cluster from the Resources view, list topics, and open message viewer", async ({
    page,
    electronApp,
  }) => {
    // expand the first direct connection to show its Kafka cluster and Schema Registry
    const directConnections: ViewItem[] = await resourcesView.getDirectConnectionItems();
    expect(directConnections.length).toBeGreaterThan(0);
    const firstConnection: ViewItem = directConnections[0];
    await expand(firstConnection.locator);
    await expect
      .poll(async () => await isExpanded(firstConnection.locator), { timeout: 1_000 })
      .toBe(true);

    // then click on the first (direct) Kafka cluster to select it
    const clusters: KafkaClusterItem[] = await resourcesView.getKafkaClusterItems({
      ccloud: false,
      local: false,
      direct: true,
    });
    expect(clusters.length).toBeGreaterThan(0);
    const firstKafkaCluster: KafkaClusterItem = clusters[0];
    await firstKafkaCluster.locator.click();
    expect(await firstKafkaCluster.isSelected()).toBe(true);

    // now the Topics view should be expanded and show at least one topic item
    const topicsView = new TopicsView(page);
    await topicsView.focus();
    const topics: TopicItem[] = await topicsView.getTopicItems();
    expect(topics.length).toBeGreaterThan(0);
    const firstTopic: TopicItem = topics[0];
    await firstTopic.clickViewMessages();

    // the message viewer webview should now be visible in the editor area
    const messageViewer = new MessageViewerWebview(page);
    await messageViewer.waitForLoadAndValidateState();
    await expect(messageViewer.locator).toBeVisible();
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
    await expect(kafkaClusterQuickpick.locator).toBeVisible({ timeout: 5_000 });

    // select the first Kafka cluster from the quickpick
    const clusters: QuickpickItem[] = await kafkaClusterQuickpick.getItems({
      waitForItems: true,
    });
    expect(clusters.length).toBeGreaterThan(0);
    const firstCluster: QuickpickItem = clusters[0];
    expect(await firstCluster.iconId()).toBe("confluent-kafka-cluster");
    await firstCluster.locator.click();

    // now the Topics view should show at least one topic item
    const topics: TopicItem[] = await topicsView.getTopicItems();
    expect(topics.length).toBeGreaterThan(0);
    const firstTopic: TopicItem = topics[0];
    await firstTopic.clickViewMessages();

    // the message viewer webview should now be visible in the editor area
    const messageViewer = new MessageViewerWebview(page);
    await messageViewer.waitForLoadAndValidateState();
    await expect(messageViewer.locator).toBeVisible();
  });
});
