import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { ConnectionType } from "../../connectionTypes";
import { InputBox } from "../quickInputs/InputBox";
import { Quickpick } from "../quickInputs/Quickpick";
import { ResourcesView } from "./ResourcesView";
import { View } from "./View";
import { TopicItem } from "./viewItems/TopicItem";

export enum SelectKafkaCluster {
  FromResourcesView = "Kafka cluster action from the Resources view",
  FromTopicsViewButton = "Topics view nav action",
}

export const DEFAULT_CCLOUD_TOPIC_REPLICATION_FACTOR = 3;

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

  /**
   * Once a connection is established, load topics into the view using the specified
   * {@link SelectKafkaCluster entrypoint}.
   *
   * If using the {@link SelectKafkaCluster.FromTopicsViewButton "Select Kafka Cluster" nav action}
   * entrypoint, you can optionally provide a `clusterLabel` to select a specific cluster from the
   * quickpick list. If not provided, the first cluster in the list will be selected.
   */
  async loadTopics(
    connectionType: ConnectionType,
    entrypoint: SelectKafkaCluster,
    clusterLabel?: string | RegExp,
  ): Promise<void> {
    switch (entrypoint) {
      case SelectKafkaCluster.FromResourcesView: {
        const resourcesView = new ResourcesView(this.page);
        const cluster = await resourcesView.getKafkaCluster(connectionType);
        await cluster.click();
        break;
      }
      case SelectKafkaCluster.FromTopicsViewButton: {
        await this.clickSelectKafkaCluster();
        const kafkaClusterQuickpick = new Quickpick(this.page);
        await expect(kafkaClusterQuickpick.locator).toBeVisible();
        await expect(kafkaClusterQuickpick.items).not.toHaveCount(0);
        const clusterItem = clusterLabel
          ? kafkaClusterQuickpick.items.filter({ hasText: clusterLabel }).first()
          : kafkaClusterQuickpick.items.first();
        await clusterItem.click();
        break;
      }
      default:
        throw new Error(`Unsupported entrypoint: ${entrypoint}`);
    }
    await expect(this.header).toHaveAttribute("aria-expanded", "true");
    await expect(this.body).toBeVisible();
  }

  /**
   * Create a new topic using the "Create Topic" nav action in the view title area, filling out the
   * required inputs in the subsequent input boxes.
   *
   * @param topicName The name of the new topic to create.
   * @param numPartitions (Optional) The number of partitions for the new topic. If not provided,
   *   the default value will be used.
   * @param replicationFactor (Optional) The replication factor for the new topic. If not provided,
   *   the default value will be used.
   */
  async createTopic(
    topicName: string,
    numPartitions: number,
    replicationFactor: number,
  ): Promise<void> {
    await this.clickCreateTopic();

    const topicNameInput = new InputBox(this.page);
    await expect(topicNameInput.input).toBeVisible();
    await topicNameInput.input.fill(topicName);
    await topicNameInput.confirm();

    const partitionsInput = new InputBox(this.page);
    await expect(partitionsInput.input).toBeVisible();
    await partitionsInput.input.fill(numPartitions.toString());
    await partitionsInput.confirm();

    const replicationInput = new InputBox(this.page);
    await expect(replicationInput.input).toBeVisible();
    await replicationInput.input.fill(replicationFactor.toString());
    await replicationInput.confirm();
  }

  /**
   * Delete the specified topic from the view using the "Delete Topic" context menu action on the
   * topic item.
   */
  async deleteTopic(topicName: string): Promise<void> {
    const topicLocator: Locator = this.topics.filter({ hasText: topicName });
    await expect(topicLocator).toHaveCount(1);
    const topicItem = new TopicItem(this.page, topicLocator.first());
    await topicItem.locator.scrollIntoViewIfNeeded();
    await expect(topicItem.locator).toBeVisible();
    await topicItem.rightClickContextMenuAction("Delete Topic");

    const deletionConfirmationBox = new InputBox(this.page);
    await expect(deletionConfirmationBox.input).toBeVisible();
    await deletionConfirmationBox.input.fill(topicName);
    await deletionConfirmationBox.confirm();
  }
}
