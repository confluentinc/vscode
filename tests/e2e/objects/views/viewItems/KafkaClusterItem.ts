import { Locator, Page } from "@playwright/test";
import { ViewItem } from "./ViewItem";

/**
 * Object representing a Kafka cluster item in the Resources {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view}.
 */
export class KafkaClusterItem extends ViewItem {
  constructor(page: Page, locator: Locator) {
    super(page, locator);
  }

  /** Get the Kafka cluster name and id from the item text (tree item `label` and `description`). */
  async getClusterName(): Promise<string> {
    const text: string | null = await this.locator.textContent();
    if (!text) {
      throw new Error("Kafka cluster item text is empty");
    }
    return text.trim();
  }

  /** Whether or not this represents a Kafka cluster under the "Local" tree item. */
  async isLocal(): Promise<boolean> {
    const [text, level]: [string, number] = await Promise.all([
      this.getClusterName(),
      this.getLevel(),
    ]);
    // shoup: this will need to change if/when we support other local Docker images
    const localLabel = "confluent-local";
    // the local Kafka cluster item is always below the "Local" root level item (level 2)
    return level === 2 && text.includes(localLabel);
  }

  /** Whether or not this represents a Kafka cluster under a direct connection tree item. */
  async isDirect(): Promise<boolean> {
    const [text, level]: [string, number] = await Promise.all([
      this.getClusterName(),
      this.getLevel(),
    ]);
    // the direct Kafka cluster item is always below a direct connection root level item (level 2)
    return level === 2 && text.includes("Kafka Cluster");
  }

  /** Whether or not this represents a Kafka cluster under a CCloud environment tree item. */
  async isCCloud(): Promise<boolean> {
    const [isLocal, isDirect, level]: [boolean, boolean, number] = await Promise.all([
      this.isLocal(),
      this.isDirect(),
      this.getLevel(),
    ]);
    // the CCloud Kafka cluster item is always below a CCloud environment item, which is below the
    // "Confluent Cloud" root level item (level 3)
    return level === 3 && !isLocal && !isDirect;
  }
}
