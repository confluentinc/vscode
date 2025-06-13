import { Page } from "@playwright/test";
import { View } from "./View";
import { TopicItem } from "./viewItems/TopicItem";
import { ViewItem } from "./viewItems/ViewItem";

/** Object representing the "Topics" {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view} in the "Confluent" {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container}. */
export class TopicsView extends View {
  // private to use `TopicsView.from(page)` instead of `new TopicsView(page)` since we aren't
  // creating a "new" topics view object, just accessing it from the existing page
  private constructor(page: Page) {
    super(page, /Topics - .* \| .* Section/);
  }

  /** Get the Topics view for the given {@link Page page} */
  static from(page: Page): TopicsView {
    return new TopicsView(page);
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
    const topicPromises: Promise<ViewItem[]>[] = [];
    if (options?.withSchemas !== false) {
      // gather all topics with schemas unless explicitly disabled
      topicPromises.push(this.getItems({ iconId: "confluent-topic", waitForItems: true }));
    }
    if (options?.withoutSchemas !== false) {
      // gather all topics without schemas unless explicitly disabled
      topicPromises.push(
        this.getItems({ iconId: "confluent-topic-without-schema", waitForItems: true }),
      );
    }
    const items: ViewItem[] = (await Promise.all(topicPromises)).flat();
    return items.map((item) => new TopicItem(this.page, item.locator));
  }

  /**
   * Get all (schema) subject {@link ViewItem tree items}.
   * (This requires at least one Kafka topic tree item to be expanded.)
   */
  async getSubjectItems(): Promise<ViewItem[]> {
    return await this.getItems({
      iconId: "confluent-subject",
      waitForItems: true,
    });
  }
}
