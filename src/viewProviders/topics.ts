import * as vscode from "vscode";
import { toKafkaTopicOperations } from "../authz/types";
import { ResponseError, TopicDataList, TopicV3Api } from "../clients/kafkaRest";
import { ContextValues, getExtensionContext, setContextValue } from "../context";
import { ccloudConnected, currentKafkaClusterChanged, localKafkaConnected } from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { ContainerTreeItem } from "../models/main";
import { Schema, SchemaTreeItem, generateSchemaSubjectGroups } from "../models/schema";
import { CCloudSchemaRegistry, SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic, KafkaTopicTreeItem } from "../models/topic";
import { getSidecar } from "../sidecar";
import { CCloudResourceLoader, ResourceLoader } from "../storage/resourceLoader";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("viewProviders.topics");

/**
 * The types managed by the {@link TopicViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type TopicViewProviderData = KafkaTopic | ContainerTreeItem<Schema> | Schema;

export class TopicViewProvider implements vscode.TreeDataProvider<TopicViewProviderData> {
  /** Disposables belonging to this provider to be added to the extension context during activation,
   * cleaned up on extension deactivation. */
  disposables: vscode.Disposable[] = [];

  private _onDidChangeTreeData: vscode.EventEmitter<TopicViewProviderData | undefined | void> =
    new vscode.EventEmitter<TopicViewProviderData | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TopicViewProviderData | undefined | void> =
    this._onDidChangeTreeData.event;

  private forceDeepRefresh: boolean = false;

  /** Repaint the topics view. When invoked from the 'refresh' button, will force deep reading from sidecar. */
  refresh(forceDeepRefresh: boolean = false, onlyIfViewingClusterId: string | null = null): void {
    if (
      onlyIfViewingClusterId &&
      this.kafkaCluster &&
      this.kafkaCluster.id !== onlyIfViewingClusterId
    ) {
      // If the view is currently focused on a different cluster, no need to refresh
      return;
    }

    this.forceDeepRefresh = forceDeepRefresh;
    this._onDidChangeTreeData.fire();
  }

  private treeView: vscode.TreeView<TopicViewProviderData>;
  /** The focused Kafka cluster; set by clicking a Kafka cluster item in the Resources view. */
  public kafkaCluster: KafkaCluster | null = null;

  private static instance: TopicViewProvider | null = null;
  private constructor() {
    if (!getExtensionContext()) {
      // getChildren() will fail without the extension context
      throw new ExtensionContextNotSetError("TopicViewProvider");
    }
    // instead of calling `.registerTreeDataProvider`, we're creating a TreeView to dynamically
    // update the tree view as needed (e.g. displaying the current Kafka cluster name in the title)
    this.treeView = vscode.window.createTreeView("confluent-topics", { treeDataProvider: this });

    const listeners: vscode.Disposable[] = this.setEventListeners();

    this.disposables.push(this.treeView, ...listeners);
  }

  static getInstance(): TopicViewProvider {
    if (!TopicViewProvider.instance) {
      TopicViewProvider.instance = new TopicViewProvider();
    }
    return TopicViewProvider.instance;
  }

  /** Convenience method to revert this view to its original state. */
  reset(): void {
    setContextValue(ContextValues.kafkaClusterSelected, false);
    this.kafkaCluster = null;
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

      const topics: KafkaTopic[] = await getTopicsForCluster(
        this.kafkaCluster,
        this.forceDeepRefresh,
      );
      topicItems.push(...topics);

      // clear any prior request to deep refresh, allow any subsequent repaint
      // to draw from workspace storage cache.
      this.forceDeepRefresh = false;
    }
    return topicItems;
  }

  /** Set up event listeners for this view provider. */
  setEventListeners(): vscode.Disposable[] {
    const ccloudConnectedSub: vscode.Disposable = ccloudConnected.event((connected: boolean) => {
      if (this.kafkaCluster?.isCCloud) {
        // any transition of CCloud connection state should reset the tree view if we're focused on
        // a CCloud Kafka Cluster
        logger.debug(
          "Resetting topics view due to ccloudConnected event and currently focused on a CCloud cluster",
          { connected },
        );
        this.reset();
      }
    });

    const localKafkaConnectedSub: vscode.Disposable = localKafkaConnected.event(
      (connected: boolean) => {
        if (this.kafkaCluster?.isLocal) {
          // any transition of local resource availability should reset the tree view if we're focused
          // on a local Kafka cluster
          logger.debug(
            "Resetting topics view due to localKafkaConnected event and currently focused on a local cluster",
            { connected },
          );
          this.reset();
        }
      },
    );

    const currentKafkaClusterChangedSub: vscode.Disposable = currentKafkaClusterChanged.event(
      async (cluster: KafkaCluster | null) => {
        if (!cluster) {
          logger.debug("currentKafkaClusterChanged event fired with null cluster, resetting.");
          this.reset();
        } else {
          setContextValue(ContextValues.kafkaClusterSelected, true);
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
            this.treeView.description = `${parentEnvironment?.name ?? "Unknown"} | ${this.kafkaCluster.name}`;
          }
          this.refresh();
        }
      },
    );

    return [ccloudConnectedSub, localKafkaConnectedSub, currentKafkaClusterChangedSub];
  }
}

/** Get the singleton instance of the {@link TopicViewProvider} */
export function getTopicViewProvider() {
  return TopicViewProvider.getInstance();
}

/** Determine the topics offered from this cluster. If topics are already known
 * from a prior sidecar fetch, return those, otherwise deep fetch from sidecar.
 */
export async function getTopicsForCluster(
  cluster: KafkaCluster,
  forceRefresh: boolean = false,
): Promise<KafkaTopic[]> {
  // XXX JLR respell a lot of this to use the ResourceLoader API only,
  // https://github.com/confluentinc/vscode/issues/570

  const loader = ResourceLoader.getInstance(cluster.connectionId);

  if (loader instanceof CCloudResourceLoader) {
    // Honor forceRefresh, in case they, say, _just_ created the schema registry.
    await (loader as CCloudResourceLoader).ensureCoarseResourcesLoaded(forceRefresh);
  }

  // Otherwise make a deep fetch, cache in resource manager, and return.
  let environmentId: string | null = null;
  let schemaRegistry: SchemaRegistry | undefined;

  const allRegistries = await loader.getSchemaRegistries();
  if (cluster.isLocal && allRegistries.length === 1) {
    // if local topic, then would be the only registry.
    schemaRegistry = allRegistries[0];
  } else if (cluster.isCCloud) {
    environmentId = (cluster as CCloudKafkaCluster).environmentId;
    // CCloud topic, find the one associated with the topic's environment
    schemaRegistry = allRegistries.find(
      (sr) => (sr as CCloudSchemaRegistry).environmentId === environmentId,
    );
  }

  let schemas: Schema[] = [];
  if (schemaRegistry) {
    schemas = await loader.getSchemasForRegistry(schemaRegistry, forceRefresh);
  }

  // TODO(james): implement topic loading via ResourceLoader
  const resourceManager = getResourceManager();
  let cachedTopics = await resourceManager.getTopicsForCluster(cluster);
  if (cachedTopics !== undefined && !forceRefresh) {
    // Cache hit.
    logger.debug(`Returning ${cachedTopics.length} cached topics for cluster ${cluster.id}`);
    return cachedTopics;
  }

  const sidecar = await getSidecar();
  const client: TopicV3Api = sidecar.getTopicV3Api(cluster.id, cluster.connectionId);
  let topicsResp: TopicDataList;

  try {
    topicsResp = await client.listKafkaTopics({
      cluster_id: cluster.id,
      includeAuthorizedOperations: true,
    });
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await error.response.json();

      vscode.window.showErrorMessage(
        `Failed to list topics for cluster "${cluster.name}": ${JSON.stringify(body)}`,
      );
    } else {
      logger.error("Failed to list Kafka topics: ", error);
    }
    // short circuit return, do NOT cache result on error. Ensure we try again on next refresh.
    return [];
  }

  // Promote each from-response TopicData representation in topicsResp to an internal KafkaTopic object
  const topics: KafkaTopic[] = topicsResp.data.map((topic) => {
    const hasMatchingSchema: boolean = schemas.some((schema) =>
      schema.matchesTopicName(topic.topic_name),
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
      operations: toKafkaTopicOperations(topic.authorized_operations!),
    });
  });

  logger.debug(`Deep fetched ${topics.length} topics for cluster ${cluster.id}`);
  return topics;
}

/**
 * Load the schemas related to the given topic from extension state by using either `TopicNameStrategy`
 * or `TopicRecordNameStrategy` to match schema subjects with the topic's name.
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
  const loader = ResourceLoader.getInstance(topic.connectionId);

  const allRegistries = await loader.getSchemaRegistries();

  let schemaRegistry: SchemaRegistry | undefined;

  // if local topic, then would be the only registry.
  if (topic.isLocalTopic() && allRegistries.length === 1) {
    schemaRegistry = allRegistries[0];
  } else if (!topic.isLocalTopic()) {
    // CCloud topic, find the one associated with the topic's environment
    schemaRegistry = allRegistries.find(
      (sr) => (sr as CCloudSchemaRegistry).environmentId === topic.environmentId,
    );
  }

  // look up the associated Schema Registry based on the topic's Kafka cluster / CCloud env,
  // then pull the schemas

  if (!schemaRegistry) {
    logger.warn("No Schema Registry found for topic", topic);
    return [];
  }

  const schemas: Schema[] = await loader.getSchemasForRegistry(schemaRegistry);
  if (schemas.length === 0) {
    logger.warn("No schemas found for topic", topic);
    return [];
  }

  return schemas;
}
