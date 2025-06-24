import { Page } from "@playwright/test";
import { View } from "./View";
import { TopicItem } from "./viewItems/TopicItem";
import { ViewItem } from "./viewItems/ViewItem";

/** Object representing the "Topics" {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view} in the "Confluent" {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container}. */
export class TopicsView extends View {
  constructor(page: Page) {
    super(page, /Topics.*Section/);
  }

  /** Click the "Search" nav action in the view title area. */
  async clickSearch(): Promise<void> {
    await this.clickNavAction("Search");
  }

  /** Click the "Create Topic" nav action in the view title area. */
  async clickCreateTopic(): Promise<void> {
    await this.clickNavAction("Create Topic");
  }

  /**
   * Click the "Select Kafka Cluster" nav action in the view title area, which will show a
   * quickpick with a list of Kafka cluster items.
   */
  async clickSelectKafkaCluster(): Promise<void> {
    await this.clickNavAction("Select Kafka Cluster");
  }

  /** Click the "Refresh" nav action in the view title area. */
  async clickRefresh(): Promise<void> {
    await this.clickNavAction("Refresh");
  }

  /**
   * Click the "More Actions..." nav action in the view title area, which will open a right-click
   * context menu.
   */
  async clickMoreActions(): Promise<void> {
    await this.clickNavAction("More Actions...");
  }

  /**
   * Get all Kafka topic {@link TopicItem tree items}, optionally filtering to include/exclude
   * topics with and/or without schemas.
   * - `withSchemas`: include topics with schemas (default: `true`)
   * - `withoutSchemas`: include topics without schemas (default: `true`)
   */
  async getTopicItems(options?: {
    withSchemas?: boolean;
    withoutSchemas?: boolean;
  }): Promise<TopicItem[]> {
    // topics are at the root level, then subjects, then schema versions
    const topics: ViewItem[] = await this.getItems({ level: 1, waitForItems: true });

    const withSchemas: boolean = options?.withSchemas ?? true;
    const withoutSchemas: boolean = options?.withoutSchemas ?? true;
    if (!withSchemas && !withoutSchemas) {
      throw new Error("At least one of 'withSchemas' or 'withoutSchemas' must be true.");
    }
    if (withSchemas && withoutSchemas) {
      // return all topics if no filtering is applied
      return topics.map((item) => new TopicItem(this.page, item.locator));
    }

    const filteredTopics: TopicItem[] = [];
    for (const item of topics) {
      const topicItem = new TopicItem(this.page, item.locator);
      const hasSchema: boolean = await topicItem.hasSchema();
      if ((withSchemas && hasSchema) || (withoutSchemas && !hasSchema)) {
        filteredTopics.push(topicItem);
      }
    }
    return filteredTopics;
  }
}
