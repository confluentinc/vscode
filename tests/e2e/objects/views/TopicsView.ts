import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { CCLOUD_KAFKA_CLUSTER_NAME } from "../../test-resources";
import { ConnectionType } from "../../types/connection";
import { InputBox } from "../quickInputs/InputBox";
import { Quickpick } from "../quickInputs/Quickpick";
import { ResourcesView } from "./ResourcesView";
import { SearchableView } from "./View";
import { TopicItem } from "./viewItems/TopicItem";
import { ViewItem } from "./viewItems/ViewItem";

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
export class TopicsView extends SearchableView {
  constructor(page: Page) {
    super(page, /Topics.*Section/);
  }

  /** Click the "Search" nav action in the view title area. */
  async clickSearch(): Promise<void> {
    await this.clickNavAction("Search");
  }

  /** Click the "Create Topic" inline action on the Topics container item. */
  async clickCreateTopic(): Promise<void> {
    const containerItem = new ViewItem(this.page, this.topicsContainer);
    await containerItem.clickInlineAction("Create Topic");
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
    // wait for view-level loading, then confirm the topics container is ready
    await expect(this.progressIndicator).toBeHidden();
    await this.waitForContainerLoaded(this.topicsContainer);
    // TODO: wait for the consumer groups container here once we incorporate them into tests
  }

  /** Get the "Topics" container at the root level of the tree. */
  get topicsContainer(): Locator {
    return this.body.locator("[role='treeitem'][aria-level='1']").filter({ hasText: "Topics" });
  }

  /** Get all topic items in the view (filtered by aria-label to exclude consumer groups). */
  get topics(): Locator {
    return this.body.locator("[role='treeitem'][aria-label^='Kafka Topic:']");
  }

  /** Get a topic item by its label/name. */
  async getTopicItem(topicName: string): Promise<TopicItem> {
    // ensure the topics container has finished loading before searching
    await this.waitForContainerLoaded(this.topicsContainer);
    const item = await this.getItemByLabel(topicName, this.topics);
    return new TopicItem(this.page, item);
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
    return this.body.locator("[role='treeitem'][aria-label^='Schema Subject:']");
  }

  /**
   * Get all schema version items in the view.
   * (One level below {@link subjects subject items}.)
   */
  get schemaVersions(): Locator {
    // we don't use `this.subjects` because these are sibling elements to subjects in the DOM
    return this.body.locator("[role='treeitem'][aria-level='4']");
  }

  /**
   * Once a connection is established, load topics into the view using the specified
   * {@link SelectKafkaCluster entrypoint}.
   *
   * For CCloud, the cluster defaults to the name configured in `test-resources.ts` when no
   * `clusterLabel` is passed, so neither entrypoint lands on whichever cluster renders first.
   * Local and Direct connections are single-cluster, so the label is optional and the first
   * cluster is used.
   */
  async loadTopics(
    connectionType: ConnectionType,
    entrypoint: SelectKafkaCluster,
    clusterLabel?: string,
  ): Promise<void> {
    const effectiveLabel =
      clusterLabel ??
      (connectionType === ConnectionType.Ccloud ? CCLOUD_KAFKA_CLUSTER_NAME : undefined);
    switch (entrypoint) {
      case SelectKafkaCluster.FromResourcesView: {
        const resourcesView = new ResourcesView(this.page);
        const cluster = await resourcesView.getKafkaCluster(connectionType, effectiveLabel);
        await cluster.click();
        break;
      }
      case SelectKafkaCluster.FromTopicsViewButton: {
        await this.clickSelectKafkaCluster();
        const kafkaClusterQuickpick = new Quickpick(this.page);
        await expect(kafkaClusterQuickpick.locator).toBeVisible();
        if (effectiveLabel) {
          // CCloud: pin to the configured cluster name with an exact single-match guard
          await kafkaClusterQuickpick.selectItemByText(effectiveLabel, { exact: true });
        } else {
          // local/direct expose a single cluster, so the first item is unambiguous
          await expect(kafkaClusterQuickpick.items).not.toHaveCount(0);
          await kafkaClusterQuickpick.items.first().click();
        }
        break;
      }
      default:
        throw new Error(`Unsupported entrypoint: ${entrypoint}`);
    }
    await expect(this.header).toHaveAttribute("aria-expanded", "true");
    await expect(this.body).toBeVisible();
    await expect(this.progressIndicator).toBeHidden();
    await this.waitForContainerLoaded(this.topicsContainer);
  }

  /**
   * Create a new topic using the "Create Topic" inline action on the Topics container, filling out
   * the required inputs in the subsequent input boxes.
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

    // wait for view-level loading, then confirm the topics container is ready
    await expect(this.progressIndicator).toBeHidden();
    await this.waitForContainerLoaded(this.topicsContainer);
  }

  /**
   * Delete the specified topic from the view using the "Delete Topic" context menu action on the
   * topic item.
   */
  async deleteTopic(topicName: string): Promise<void> {
    const topicItem = await this.getTopicItem(topicName);
    await topicItem.rightClickContextMenuAction("Delete Topic");

    const deletionConfirmationBox = new InputBox(this.page);
    await expect(deletionConfirmationBox.input).toBeVisible();
    await deletionConfirmationBox.input.fill(topicName);
    await deletionConfirmationBox.confirm();

    // wait for view-level loading, then confirm the topics container is ready
    await expect(this.progressIndicator).toBeHidden();
    await this.waitForContainerLoaded(this.topicsContainer);
  }
}
