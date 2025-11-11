import { expect } from "@playwright/test";
import { test } from "../baseTest";
import { SelectKafkaCluster, TopicsView } from "../objects/views/TopicsView";
import { TopicItem } from "../objects/views/viewItems/TopicItem";
import type { MessageViewerWebview } from "../objects/webviews/MessageViewerWebview";
import { Tag } from "../tags";
import { ConnectionType } from "../types/connection";

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

test.describe("Topics Listing & Message Viewer", { tag: [Tag.TopicMessageViewer] }, () => {
  // test dimensions:
  const connectionTypes: Array<[ConnectionType, Tag]> = [
    [ConnectionType.Ccloud, Tag.CCloud],
    [ConnectionType.Direct, Tag.Direct],
    [ConnectionType.Local, Tag.Local],
  ];
  const entrypoints = [
    SelectKafkaCluster.FromResourcesView,
    SelectKafkaCluster.FromTopicsViewButton,
  ];

  for (const [connectionType, connectionTag] of connectionTypes) {
    test.describe(`${connectionType} connection`, { tag: [connectionTag] }, () => {
      // specify the connection type to use with the `connectionItem` fixture, and the topic to
      // create with the `topic` fixture
      test.use({
        connectionType,
        topicConfig: { name: "e2e-topic-message-viewer" },
      });

      for (const entrypoint of entrypoints) {
        test(
          `should select a Kafka cluster from the ${entrypoint}, list topics, and open message viewer`,
          { tag: [Tag.RequiresTopic] },
          async ({ page, topic: topicName }) => {
            const topicsView = new TopicsView(page);
            await topicsView.loadTopics(connectionType, entrypoint);

            // verify it shows up in the Topics view
            let targetTopic = topicsView.topicsWithoutSchemas.filter({ hasText: topicName });
            await targetTopic.scrollIntoViewIfNeeded();
            await expect(targetTopic).toBeVisible();

            // open the message viewer for the topic
            const topicItem = new TopicItem(page, targetTopic);
            const messageViewer: MessageViewerWebview = await topicItem.clickViewMessages();

            // the message viewer webview should now be visible in the editor area
            await expect(messageViewer.messageViewerSettings).toBeVisible();
            await expect(messageViewer.content).toBeVisible();
            await expect(messageViewer.paginationControls).toBeVisible();
          },
        );
      }
    });
  }
});
