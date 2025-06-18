import { expect } from "@playwright/test";
import { test } from "../baseTest";
import { Quickpick } from "../objects/quickInputs/Quickpick";
import { QuickpickItem } from "../objects/quickInputs/QuickpickItem";
import { ResourcesView } from "../objects/views/ResourcesView";
import { TopicsView } from "../objects/views/TopicsView";
import { CCloudEnvironmentItem } from "../objects/views/viewItems/CCloudEnvironmentItem";
import { CCloudItem } from "../objects/views/viewItems/CCloudItem";
import { KafkaClusterItem } from "../objects/views/viewItems/KafkaClusterItem";
import { TopicItem } from "../objects/views/viewItems/TopicItem";
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

// shoup: add DIRECT connection handling after it gets the page object modeling implemented
for (const connectionType of ["CCLOUD"]) {
  test.describe.only("Topic Message Viewer", () => {
    let resourcesView: ResourcesView;

    test.beforeEach(async ({ page, electronApp }) => {
      await openConfluentExtension(page);

      if (connectionType === "CCLOUD") {
        await login(page, electronApp, process.env.E2E_USERNAME!, process.env.E2E_PASSWORD!);

        // make sure the "Confluent Cloud" item in the Resources view is expanded and doesn't show the
        // "(Not Connected)" description
        resourcesView = new ResourcesView(page);
        await resourcesView.focus();

        const ccloudItem: CCloudItem = await resourcesView.getConfluentCloudItem();
        // signed-in state: should not show "(Not Connected)" text and should be expandable
        await expect(ccloudItem.notConnectedText).toBeHidden({ timeout: 500 });
        await expect
          .poll(async () => await isExpandable(ccloudItem.locator), { timeout: 1_000 })
          .toBe(true);
      } else if (connectionType === "DIRECT") {
        // shoup: set up direct connection here
      }
      // handle LOCAL connection later
    });

    test(`${connectionType}: should select a Kafka cluster from the Resources view, list topics, and open message viewer`, async ({
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
      const clusters: KafkaClusterItem[] = await resourcesView.getKafkaClusterItems();
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

    test(`${connectionType}: should select a Kafka cluster from the Topics view nav action, list topics, and open message viewer`, async ({
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
}
