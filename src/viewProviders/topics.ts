import * as vscode from "vscode";
import { toKafkaTopicOperations } from "../authz/types";
import { TopicDataList, TopicV3Api } from "../clients/kafkaRest";
import {
  ccloudConnected,
  currentKafkaClusterChanged,
  currentKafkaClusterTopicsChanged,
} from "../emitters";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { ContainerTreeItem } from "../models/main";
import { Schema, SchemaTreeItem, generateSchemaSubjectGroups } from "../models/schema";
import { SchemaRegistryCluster } from "../models/schemaRegistry";
import { KafkaTopic, KafkaTopicTreeItem } from "../models/topic";
import { getSidecar } from "../sidecar";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("viewProviders.topics");

/**
 * The types managed by the {@link TopicViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type TopicViewProviderData = KafkaTopic | ContainerTreeItem<Schema> | Schema;

export class TopicViewProvider implements vscode.TreeDataProvider<TopicViewProviderData> {
  private _onDidChangeTreeData: vscode.EventEmitter<TopicViewProviderData | undefined | void> =
    new vscode.EventEmitter<TopicViewProviderData | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TopicViewProviderData | undefined | void> =
    this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  private treeView: vscode.TreeView<TopicViewProviderData>;
  /** The parent of the focused Kafka cluster, if it came from CCloud.  */
  public ccloudEnvironment: CCloudEnvironment | null = null;
  /** The focused Kafka cluster; set by clicking a Kafka cluster item in the Resources view. */
  public kafkaCluster: KafkaCluster | null = null;

  constructor() {
    // instead of calling `.registerTreeDataProvider`, we're creating a TreeView to dynamically
    // update the tree view as needed (e.g. displaying the current Kafka cluster name in the title)
    this.treeView = vscode.window.createTreeView("confluent-topics", { treeDataProvider: this });

    ccloudConnected.event((connected: boolean) => {
      logger.debug("ccloudConnected event fired, resetting", connected);
      // any transition of CCloud connection state should reset the tree view
      this.reset();
    });
    currentKafkaClusterChanged.event(async (cluster: KafkaCluster | null) => {
      if (!cluster) {
        vscode.commands.executeCommand("setContext", "confluent.kafkaClusterSelected", false);
        this.reset();
      } else {
        vscode.commands.executeCommand("setContext", "confluent.kafkaClusterSelected", true);
        this.kafkaCluster = cluster;
        // update the tree view title to show the currently-focused Kafka cluster and repopulate the tree
        if (cluster.isLocal) {
          // just show "Local" since we don't have a name for the local cluster(s)
          this.treeView.description = "Local";
        } else {
          const parentEnvironment: CCloudEnvironment | null =
            await getResourceManager().getCCloudEnvironment(
              (this.kafkaCluster as CCloudKafkaCluster).environmentId,
            );
          this.ccloudEnvironment = parentEnvironment;
          this.treeView.description = `${this.ccloudEnvironment?.name ?? "Unknown"} | ${this.kafkaCluster.name}`;
        }
        this.refresh();
      }
    });
    currentKafkaClusterTopicsChanged.event(() => {
      // refresh if a topic is added, removed, or updated
      this.refresh();
    });
  }

  /** Convenience method to revert this view to its original state. */
  reset(): void {
    vscode.commands.executeCommand("setContext", "confluent.kafkaClusterSelected", false);
    this.kafkaCluster = null;
    this.ccloudEnvironment = null;
    this.treeView.description = "";
    this.refresh();
  }

  getTreeItem(element: TopicViewProviderData): vscode.TreeItem | Thenable<vscode.TreeItem> {
    if (element instanceof Schema) {
      return new SchemaTreeItem(element);
    } else if (element instanceof KafkaTopic) {
      return new KafkaTopicTreeItem(element);
    }
    return element;
  }

  async getChildren(element?: TopicViewProviderData): Promise<TopicViewProviderData[]> {
    let topicItems: TopicViewProviderData[] = [];

    if (element) {
      // --- CHILDREN OF TREE BRANCHES ---
      // NOTE: we end up here when expanding a (collapsed) treeItem
      if (element instanceof ContainerTreeItem) {
        // Local / CCloud containers, just return the topic tree items
        return element.children;
      } else if (element instanceof KafkaTopic) {
        return await loadTopicSchemas(element);
      }
    } else {
      // --- ROOT-LEVEL ITEMS ---
      // NOTE: we end up here when the tree is first loaded, and we can use this to load the top-level items
      if (!this.kafkaCluster) {
        // no current cluster, nothing to display
        return topicItems;
      }

      const topics: KafkaTopic[] = await getTopicsForCluster(this.kafkaCluster);
      topicItems.push(...topics);
    }
    return topicItems;
  }
}

var topicViewProvider = new TopicViewProvider();
/** Get the singleton instance of the {@link TopicViewProvider} */
export function getTopicViewProvider() {
  return topicViewProvider;
}

export async function getTopicsForCluster(cluster: KafkaCluster): Promise<KafkaTopic[]> {
  let environmentId: string | null = null;
  let schemas: Schema[] = [];

  if (cluster instanceof CCloudKafkaCluster) {
    environmentId = cluster.environmentId;
    const resourceManager = getResourceManager();
    const schemaRegistry = await resourceManager.getCCloudSchemaRegistryCluster(environmentId);
    if (schemaRegistry) {
      schemas = await resourceManager.getCCloudSchemasForCluster(schemaRegistry.id);
    }
  }

  const sidecar = await getSidecar();
  const client: TopicV3Api = sidecar.getTopicV3Api(cluster.id, cluster.connectionId);
  const topicsResp: TopicDataList = await client.listKafkaTopics({
    cluster_id: cluster.id,
    includeAuthorizedOperations: true,
  });

  // Promote each from-response-topic to an internal KafkaTopic object
  const topics: KafkaTopic[] = topicsResp.data.map((topic) => {
    const hasMatchingSchema: boolean = schemas.some((schema) =>
      schema.matchesTopicName(topic.topic_name),
    );

    // Promote from string[] to KafkaTopicOperation[]
    const operations = toKafkaTopicOperations(topic.authorized_operations!);

    logger.debug(
      `Topic authz operations for ${topic.topic_name} (ccloud topic: ${cluster instanceof CCloudKafkaCluster}):`,
      operations,
    );

    return KafkaTopic.create({
      name: topic.topic_name,
      is_internal: topic.is_internal,
      replication_factor: topic.replication_factor,
      partition_count: topic.partitions_count,
      partitions: topic.partitions,
      configs: topic.configs,
      clusterId: cluster.id,
      environmentId: environmentId,
      hasSchema: hasMatchingSchema,
      operations: operations,
    });
  });
  if (cluster instanceof CCloudKafkaCluster) {
    await getResourceManager().setCCloudTopics(topics);
  } else {
    await getResourceManager().setLocalTopics(topics);
  }
  return topics;
}

/**
 * Load the schemas for a given topic from extension state by using the `TopicNameStrategy` to match
 * schema subjects with the topic name.
 * @param topic The Kafka topic to load schemas for.
 * @returns An array of {@link ContainerTreeItem} objects representing the topic's schemas, grouped
 * by subject as {@link ContainerTreeItem}s, with the {@link Schema}s in version-descending order.
 * @see https://developer.confluent.io/courses/schema-registry/schema-subjects/#subject-name-strategies
 */
export async function loadTopicSchemas(topic: KafkaTopic): Promise<ContainerTreeItem<Schema>[]> {
  const schemas = await getSchemasForTopicEnv(topic);
  return generateSchemaSubjectGroups(schemas, topic.name);
}

/**
 * Get the schemas associated with a given Kafka topic.
 * @param topic The Kafka topic to get schemas for.
 * @returns An array of {@link Schema} objects representing the schemas associated with the topic.
 */
export async function getSchemasForTopicEnv(topic: KafkaTopic): Promise<Schema[]> {
  if (topic.isLocalTopic()) {
    logger.warn("Attempt to get schemas for local topic", topic);
    // TODO: update this once we're able to associate schemas with local topics
    return [];
  }
  // look up the associated SR cluster based on the topic's environment, then pull the schemas
  const resourceManager = getResourceManager();

  const schemaRegistry: SchemaRegistryCluster | null =
    await resourceManager.getCCloudSchemaRegistryCluster(topic.environmentId!);
  if (!schemaRegistry) {
    logger.warn("No Schema Registry cluster found for topic", topic);
    return [];
  }

  const schemas: Schema[] =
    (await getResourceManager().getCCloudSchemasForCluster(schemaRegistry.id)) || [];
  if (schemas.length === 0) {
    logger.warn("No schemas found for topic", topic);
    return [];
  }

  return schemas;
}
