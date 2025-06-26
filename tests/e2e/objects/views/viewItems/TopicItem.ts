import { Locator, Page } from "@playwright/test";
import { ViewItem } from "./ViewItem";

/**
 * Object representing a Kafka topic item in the Topics {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}.
 * This provides the following inline actions:
 * - the "View Messages" action to open the message viewer
 * - the "Send Messages" action to produce a message (or multiple) from a document
 */
export class TopicItem extends ViewItem {
  constructor(page: Page, locator: Locator) {
    super(page, locator);
  }

  /** Get the topic name from the item text (tree item `label` and `description`). */
  async getTopicName(): Promise<string> {
    const text: string | null = await this.locator.textContent();
    if (!text) {
      throw new Error("Topic item text is empty");
    }
    return text.trim();
  }

  /** Click the "View Messages" action on the topic item. */
  async clickViewMessages(): Promise<void> {
    await this.clickInlineAction("View Messages");
  }

  /** Click the "Send Messages" action on the topic item. */
  async clickSendMessages(): Promise<void> {
    await this.clickInlineAction("Send Message(s) to Topic");
  }

  /** Whether or not this topic item is associated with a schema subject. */
  async hasSchema(): Promise<boolean> {
    const iconId: string = await this.getIconId();
    return !iconId.includes("without-schema");
  }
}
