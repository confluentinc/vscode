import { KafkaJS } from "@confluentinc/kafka-javascript";
import { expect } from "@playwright/test";
import { test } from "../baseTest";
import { SelectKafkaCluster, TopicsView } from "../objects/views/TopicsView";
import type { TopicItem } from "../objects/views/viewItems/TopicItem";
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

test.describe("Message Viewer Consumption & Filtering", { tag: [Tag.TopicMessageViewer] }, () => {
  // use LOCAL and DIRECT connections for consumption tests to avoid CCloud auth complexity
  for (const [connectionType, connectionTag] of [
    [ConnectionType.Local, Tag.Local],
    [ConnectionType.Direct, Tag.Direct],
  ] as const) {
    test.describe(`${connectionType} connection`, { tag: [connectionTag] }, () => {
      test.use({
        connectionType,
        topicConfig: {
          name: `e2e-mv-consume-${connectionType}`,
          produce: { numMessages: 10, keyPrefix: "key", valuePrefix: "value" },
        },
      });

      test(
        "should consume and display messages from beginning",
        { tag: [Tag.RequiresTopic] },
        async ({ page, topic: topicName }) => {
          const topicsView = new TopicsView(page);
          await topicsView.loadTopics(connectionType, SelectKafkaCluster.FromResourcesView);

          const topicItem = await topicsView.getTopicItem(topicName);
          const messageViewer = await topicItem.clickViewMessages();

          // wait for messages to appear in the grid
          await messageViewer.waitForMessages(1);

          // verify messages are displayed
          const rowCount = await messageViewer.messageRows.count();
          expect(rowCount).toBeGreaterThanOrEqual(1);
        },
      );

      test(
        "should filter messages via text search",
        { tag: [Tag.RequiresTopic] },
        async ({ page, topic: topicName }) => {
          const topicsView = new TopicsView(page);
          await topicsView.loadTopics(connectionType, SelectKafkaCluster.FromResourcesView);

          const topicItem = await topicsView.getTopicItem(topicName);
          const messageViewer = await topicItem.clickViewMessages();
          await messageViewer.waitForMessages(1);

          const rowCountBefore = await messageViewer.messageRows.count();

          // search for a specific key that should match a subset of messages
          await messageViewer.searchMessages("key-0");

          // verify the filtered row count is less than before
          await expect(async () => {
            const rowCountAfter = await messageViewer.messageRows.count();
            expect(rowCountAfter).toBeLessThan(rowCountBefore);
            expect(rowCountAfter).toBeGreaterThanOrEqual(1);
          }).toPass({ timeout: 10000 });

          // clear search and verify all messages are restored
          await messageViewer.clearSearch();
          await expect(async () => {
            const rowCountRestored = await messageViewer.messageRows.count();
            expect(rowCountRestored).toBe(rowCountBefore);
          }).toPass({ timeout: 10000 });
        },
      );

      test(
        "should pause and resume consumption",
        { tag: [Tag.RequiresTopic] },
        async ({ page, topic: topicName }) => {
          const topicsView = new TopicsView(page);
          await topicsView.loadTopics(connectionType, SelectKafkaCluster.FromResourcesView);

          const topicItem = await topicsView.getTopicItem(topicName);
          const messageViewer = await topicItem.clickViewMessages();
          await messageViewer.waitForMessages(1);

          // the stream toggle button should show "Pause" when running
          await expect(messageViewer.streamToggleButton).toBeVisible();

          // click to pause
          await messageViewer.streamToggleButton.click();
          // button text should change to "Resume"
          await expect(messageViewer.streamToggleButton).toContainText("Resume", {
            timeout: 5000,
          });

          // click to resume
          await messageViewer.streamToggleButton.click();
          // button text should change back to "Pause"
          await expect(messageViewer.streamToggleButton).toContainText("Pause", { timeout: 5000 });
        },
      );
    });
  }
});

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
  const compressionTypes: KafkaJS.CompressionTypes[] = [
    KafkaJS.CompressionTypes.None,
    KafkaJS.CompressionTypes.GZIP,
    KafkaJS.CompressionTypes.Snappy,
    KafkaJS.CompressionTypes.LZ4,
    KafkaJS.CompressionTypes.ZSTD,
  ];

  for (const [connectionType, connectionTag] of connectionTypes) {
    // specify the cluster label to use for all topics created in this suite so we can match it to
    // the API key/secret used for producing messages, but only for CCLOUD connections
    const clusterLabel =
      connectionType === ConnectionType.Ccloud ? process.env.E2E_KAFKA_CLUSTER_NAME! : undefined;

    test.describe(`${connectionType} connection`, { tag: [connectionTag] }, () => {
      for (const compressionType of compressionTypes) {
        test.describe(`${compressionType} compression`, () => {
          // specify the connection type to use with the `connectionItem` fixture, and the topic to
          // create with the `topic` fixture
          test.use({
            connectionType,
            topicConfig: {
              clusterLabel,
              name: `e2e-topic-message-viewer-${compressionType}`,
              produce: { compressionType },
            },
          });

          for (const entrypoint of entrypoints) {
            test(
              `should select a Kafka cluster from the ${entrypoint}, list topics, and open message viewer`,
              { tag: [Tag.RequiresTopic] },
              async ({ page, topic: topicName }) => {
                const topicsView = new TopicsView(page);
                await topicsView.loadTopics(connectionType, entrypoint, clusterLabel);

                // open the message viewer for the topic
                const topicItem: TopicItem = await topicsView.getTopicItem(topicName);
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
  }
});
