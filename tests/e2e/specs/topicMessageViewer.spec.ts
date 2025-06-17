import { expect, test } from "vscode-test-playwright";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { QuickpickItem } from "../objects/quickInputs/QuickpickItem";
import { ResourcesView } from "../objects/views/ResourcesView";
import { TopicsView } from "../objects/views/TopicsView";
import { CCloudEnvironmentItem } from "../objects/views/viewItems/CCloudEnvironmentItem";
import { CCloudItem } from "../objects/views/viewItems/CCloudItem";
import { KafkaClusterItem } from "../objects/views/viewItems/KafkaClusterItem";
import { TopicItem } from "../objects/views/viewItems/TopicItem";
import { MessageViewerWebview } from "../objects/webviews/MessageViewerWebview";
import { openConfluentExtension } from "./utils/confluent";
import { login } from "./utils/confluentCloud";

/**
 * E2E test suite for testing the Topics view and Message Viewer functionality.
 * Based on issue #1703: https://github.com/confluentinc/vscode/issues/1703
 */
test.describe("Topic Message Viewer E2E Test", () => {
  test.beforeEach(async ({ page }) => {
    await openConfluentExtension(page);
  });

  /**
   * Test flow:
   * 1. Log in to Confluent Cloud from the sidebar auth flow
   * 2. Select a Kafka cluster with topics
   *    a. Pick from the Resources view, or
   *    b. Pick from the Topics view nav action
   * 3. Topics view should have at least one topic item listed (which will close issue #722)
   * 4. Click on the `confluent-new-message` icon (envelope with magnifying glass) to open the topic message viewer
   * 5. View should open with basic form components, even if messages aren't (yet) available
   */
  test("should list topics and open message viewer", async ({ page, electronApp }) => {
    await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);

    // make sure the "Confluent Cloud" item in the Resources view is expanded and doesn't show the
    // "(Not Connected)" description
    const resourcesView = ResourcesView.from(page);
    await resourcesView.focus();
    expect(await resourcesView.isExpanded()).toBe(true);
    const ccloudItem: CCloudItem = await resourcesView.getConfluentCloudItem();
    await expect
      .poll(async () => await ccloudItem.showsSignedInState(), { timeout: 1_000 })
      .toBe(true);

    // expand the first (CCloud) environment to show Kafka clusters, Schema Registry, and maybe
    // Flink compute pools
    const environments: CCloudEnvironmentItem[] = await resourcesView.getCCloudEnvironmentItems();
    expect(environments.length).toBeGreaterThan(0);
    const firstEnvironment: CCloudEnvironmentItem = environments[0];
    await firstEnvironment.expand();
    await expect
      .poll(async () => await firstEnvironment.isExpanded(), { timeout: 1_000 })
      .toBe(true);

    // then click on the first (CCloud) Kafka cluster to select it
    const clusters: KafkaClusterItem[] = await resourcesView.getKafkaClusterItems();
    expect(clusters.length).toBeGreaterThan(0);
    const firstKafkaCluster: KafkaClusterItem = clusters[0];
    await firstKafkaCluster.click();
    expect(await firstKafkaCluster.isSelected()).toBe(true);

    // now the Topics view should be expanded and show at least one topic item
    const topicsView = TopicsView.from(page);
    await topicsView.focus();
    expect(await topicsView.isExpanded()).toBe(true);

    const topics: TopicItem[] = await topicsView.getTopicItems();
    expect(topics.length).toBeGreaterThan(0);
    const firstTopic: TopicItem = topics[0];
    await firstTopic.clickViewMessages();

    // the message viewer webview should now be visible in the editor area
    const messageViewer = new MessageViewerWebview(page);
    await messageViewer.waitForLoad();
    await expect(messageViewer.locator).toBeVisible({ timeout: 10_000 });
    // it should also show some of the top-level controls and be in a loading, error,
    // or got-some-messages state
    await expect(messageViewer.consumeModeDropdown).toBeVisible();
    await expect(messageViewer.messagesLimitDropdown).toBeVisible();
    await expect(messageViewer.messageSearchField).toBeVisible();
    const [isLoading, hasMessages, hasError] = await Promise.all([
      messageViewer.isLoadingMessages(),
      messageViewer.hasMessages(),
      messageViewer.hasError(),
    ]);
    expect(isLoading || hasMessages || hasError).toBe(true);
  });

  test("should select a Kafka cluster from the Topics view nav action and open message viewer", async ({
    page,
    electronApp,
  }) => {
    await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);

    // make sure the "Confluent Cloud" item in the Resources view is expanded and doesn't show the
    // "(Not Connected)" description
    const resourcesView = ResourcesView.from(page);
    await resourcesView.focus();
    expect(await resourcesView.isExpanded()).toBe(true);
    const ccloudItem: CCloudItem = await resourcesView.getConfluentCloudItem();
    await expect
      .poll(async () => await ccloudItem.showsSignedInState(), { timeout: 1_000 })
      .toBe(true);

    // instead of selecting a Kafka cluster from the Resources view, we're selecting it from the
    // Topics view nav action
    const topicsView = TopicsView.from(page);
    await topicsView.focus();
    expect(await topicsView.isExpanded()).toBe(true);

    // Topics view should show empty state since no cluster is selected yet
    await expect(topicsView.viewsWelcome).toContainText("No Kafka cluster selected");
    await topicsView.clickSelectKafkaCluster();

    // the Kafka cluster quickpick should open
    const kafkaClusterQuickpick = new Quickpick(page);
    await expect(kafkaClusterQuickpick.locator).toBeVisible({ timeout: 10_000 });

    // select the first Kafka cluster from the quickpick
    const clusters: QuickpickItem[] = await kafkaClusterQuickpick.getItems({
      waitForItems: true,
    });
    expect(clusters.length).toBeGreaterThan(0);
    const firstCluster: QuickpickItem = clusters[0];
    await expect(firstCluster.icon).toHaveAttribute("class", /confluent-kafka-cluster/);
    await firstCluster.click();

    // now the Topics view should show at least one topic item
    const topics: TopicItem[] = await topicsView.getTopicItems();
    expect(topics.length).toBeGreaterThan(0);
    const firstTopic: TopicItem = topics[0];
    await firstTopic.clickViewMessages();

    // the message viewer webview should now be visible in the editor area
    const messageViewer = new MessageViewerWebview(page);
    await messageViewer.waitForLoad();
    await expect(messageViewer.locator).toBeVisible({ timeout: 10_000 });
    // it should also show some of the top-level controls and be in a loading, error,
    // or got-some-messages state
    await expect(messageViewer.consumeModeDropdown).toBeVisible();
    await expect(messageViewer.messagesLimitDropdown).toBeVisible();
    await expect(messageViewer.messageSearchField).toBeVisible();
    const [isLoading, hasMessages, hasError] = await Promise.all([
      messageViewer.isLoadingMessages(),
      messageViewer.hasMessages(),
      messageViewer.hasError(),
    ]);
    expect(isLoading || hasMessages || hasError).toBe(true);
  });
});
