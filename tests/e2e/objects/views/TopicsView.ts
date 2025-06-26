import { Locator, Page } from "@playwright/test";
import { View } from "./View";

/**
 * Object representing the "Topics"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#tree-views view} in the "Confluent"
 * {@link https://code.visualstudio.com/api/ux-guidelines/views#view-containers view container}.
 */
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

  /** Get all (root-level) topic items in the view. */
  get topics(): Locator {
    return this.body.locator("[role='treeitem'][aria-level='1']");
  }

  /** Get all {@link topics topic items} with schemas in the view. */
  get topicsWithSchemas(): Locator {
    return this.topics.filter({ has: this.page.locator(".codicon-confluent-topic") });
  }

  /** Get all {@link topics topic items} without schemas in the view. */
  get topicsWithoutSchemas(): Locator {
    return this.topics.filter({
      has: this.page.locator(".codicon-confluent-topic-without-schema"),
    });
  }

  /**
   * Get all subject items in the view.
   * (One level below {@link topicsWithSchemas topic items with schemas}.)
   */
  get subjects(): Locator {
    // we don't use `this.topicsWithSchemas` because these are sibling elements to topics in the DOM
    return this.body.locator("[role='treeitem'][aria-level='2']");
  }

  /**
   * Get all schema version items in the view.
   * (One level below {@link subjects subject items}.)
   */
  get schemaVersions(): Locator {
    // we don't use `this.subjects` because these are sibling elements to subjects in the DOM
    return this.body.locator("[role='treeitem'][aria-level='3']");
  }
}
