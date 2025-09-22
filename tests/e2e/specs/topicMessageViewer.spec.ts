import { expect } from "@playwright/test";
import { test } from "../baseTest";
import { ConnectionType } from "../connectionTypes";
import {
  DEFAULT_CCLOUD_TOPIC_REPLICATION_FACTOR,
  SelectKafkaCluster,
  TopicsView,
} from "../objects/views/TopicsView";
import { TopicItem } from "../objects/views/viewItems/TopicItem";
import { MessageViewerWebview } from "../objects/webviews/MessageViewerWebview";
import { Tag } from "../tags";

/**
 * E2E test suite for testing the Topics view and Message Viewer functionality.
 * {@see https://github.com/confluentinc/vscode/issues/1703}
 *
 * Test flow:
 * 1. Set up connection (CCloud, Direct, or Local)
 * 2. Select a Kafka cluster
 *    a. Pick from the Resources view, or
 *    b. Pick from the Topics view nav action
 * 3. Create a topic
 * 4. Click on the `confluent-new-message` icon (envelope with magnifying glass) to open the topic
 *    message viewer
 * 5. View should open with basic webview components, even if messages aren't (yet) available
 */

test.describe("Topics Listing & Message Viewer", () => {
  let topicName: string = "e2e-topic-message-viewer";

  test.afterEach(async ({ page }) => {
    const topicView = new TopicsView(page);
    await topicView.deleteTopic(topicName);
  });

  // test dimensions:
  const connectionTypes: Array<[ConnectionType, Tag, number]> = [
    [ConnectionType.Ccloud, Tag.CCloud, DEFAULT_CCLOUD_TOPIC_REPLICATION_FACTOR],
    [ConnectionType.Direct, Tag.Direct, DEFAULT_CCLOUD_TOPIC_REPLICATION_FACTOR],
    [ConnectionType.Local, Tag.Local, 1],
  ];
  const entrypoints = [
    SelectKafkaCluster.FromResourcesView,
    SelectKafkaCluster.FromTopicsViewButton,
  ];

  for (const [connectionType, connectionTag, replicationFactor] of connectionTypes) {
    test.describe(`${connectionType} connection`, { tag: [connectionTag] }, () => {
      // tell the `connectionItem` fixture which connection type to set up
      test.use({ connectionType });

      for (const entrypoint of entrypoints) {
        test(`should select a Kafka cluster from the ${entrypoint}, list topics, and open message viewer`, async ({
          page,
          connectionItem,
        }) => {
          // ensure connection has resources available to work with
          await expect(connectionItem.locator).toHaveAttribute("aria-expanded", "true");

          // create a new topic
          const topicsView = new TopicsView(page);
          await topicsView.loadTopics(connectionType, entrypoint);
          await topicsView.createTopic(topicName, 1, replicationFactor);

          // verify it shows up in the Topics view
          let targetTopic = topicsView.topicsWithoutSchemas.filter({ hasText: topicName });
          await targetTopic.scrollIntoViewIfNeeded();
          await expect(targetTopic).toBeVisible();

          // open the message viewer for the topic
          const topic = new TopicItem(page, targetTopic);
          const messageViewer: MessageViewerWebview = await topic.clickViewMessages();

          // the message viewer webview should now be visible in the editor area
          await expect(messageViewer.messageViewerSettings).toBeVisible();
          await expect(messageViewer.content).toBeVisible();
          await expect(messageViewer.paginationControls).toBeVisible();
        });
      }
    });
  }
});
