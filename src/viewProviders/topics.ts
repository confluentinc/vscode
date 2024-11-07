import * as vscode from "vscode";
import { toKafkaTopicOperations } from "../authz/types";
import { ResponseError, TopicDataList, TopicV3Api } from "../clients/kafkaRest";
import { ContextValues, getContextValue, getExtensionContext, setContextValue } from "../context";
import { ccloudConnected, currentKafkaClusterChanged, localKafkaConnected } from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { getLocalResources } from "../graphql/local";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudKafkaCluster, KafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import { ContainerTreeItem } from "../models/main";
import { Schema, SchemaTreeItem, generateSchemaSubjectGroups } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic, KafkaTopicTreeItem } from "../models/topic";
import { getSidecar } from "../sidecar";
import { ResourceLoader } from "../storage/resourceLoader";
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

    ccloudConnected.event((connected: boolean) => {
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
    localKafkaConnected.event((connected: boolean) => {
      if (this.kafkaCluster?.isLocal) {
        // any transition of local resource availability should reset the tree view if we're focused
        // on a local Kafka cluster
        logger.debug(
          "Resetting topics view due to localKafkaConnected event and currently focused on a local cluster",
          { connected },
        );
        this.reset();
      }
    });
    currentKafkaClusterChanged.event(async (cluster: KafkaCluster | null) => {
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
    });
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
  const resourceManager = getResourceManager();

  if (cluster instanceof CCloudKafkaCluster) {
    // Ensure all of the needed ccloud preloading is complete before referencing
    // resource manager ccloud resources, namely the schema registry and its schemas.

    const preloader = ResourceLoader.getInstance();

    // Honor forceRefresh, in case they, say, _just_ created the schema registry.
    await preloader.ensureCoarseResourcesLoaded(forceRefresh);

    // Get the schema registry id for the cluster's environment
    const schemaRegistry = await resourceManager.getCCloudSchemaRegistry(cluster.environmentId);

    if (schemaRegistry) {
      // Ensure the schemas are loaded for the schema registry, honoring the forceRefresh flag.
      await preloader.ensureSchemasLoaded(schemaRegistry.id, forceRefresh);
    }
  }

  let cachedTopics = await resourceManager.getTopicsForCluster(cluster);
  if (cachedTopics !== undefined && !forceRefresh) {
    // Cache hit.
    logger.debug(`Returning ${cachedTopics.length} cached topics for cluster ${cluster.id}`);
    return cachedTopics;
  }

  // Otherwise make a deep fetch, cache in resource manager, and return.
  let environmentId: string | null = null;
  let schemas: Schema[] | undefined = [];

  let schemaRegistry: SchemaRegistry | null = null;
  if (cluster instanceof CCloudKafkaCluster) {
    environmentId = cluster.environmentId;
    schemaRegistry = await resourceManager.getCCloudSchemaRegistry(environmentId);
  } else if (
    cluster instanceof LocalKafkaCluster &&
    getContextValue(ContextValues.localSchemaRegistryAvailable)
  ) {
    schemaRegistry = await getLocalSchemaRegistryFromClusterId(cluster.id);
  }

  if (schemaRegistry) {
    schemas = await resourceManager.getSchemasForRegistry(schemaRegistry.id);
    if (schemas === undefined) {
      logger.error("Wacky: schema registry known, but unknown schemas (should be empty array)", {
        schemaRegistry,
      });
      // promote unknown to empty array as work around to what should never happen.
      schemas = [];
    }
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
    const hasMatchingSchema: boolean = schemas!.some((schema) =>
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
  await resourceManager.setTopicsForCluster(cluster, topics);

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
  const resourceManager = getResourceManager();

  // look up the associated Schema Registry based on the topic's Kafka cluster / CCloud env,
  // then pull the schemas
  let schemaRegistry: SchemaRegistry | null = null;
  if (topic.isLocalTopic()) {
    schemaRegistry = await getLocalSchemaRegistryFromClusterId(topic.clusterId);
  } else if (topic.environmentId) {
    // CCloud topic
    schemaRegistry = await resourceManager.getCCloudSchemaRegistry(topic.environmentId);
  }

  if (!schemaRegistry) {
    logger.warn("No Schema Registry found for topic", topic);
    return [];
  }

  const schemas: Schema[] = (await resourceManager.getSchemasForRegistry(schemaRegistry.id)) || [];
  if (schemas.length === 0) {
    logger.warn("No schemas found for topic", topic);
    return [];
  }

  return schemas;
}

export async function getLocalSchemaRegistryFromClusterId(
  clusterId: string,
): Promise<SchemaRegistry | null> {
  const localResources = await getLocalResources();
  // look up the local resource group where this Kafka cluster exists
  const localResourceGroup = localResources.find((group) =>
    group.kafkaClusters.some((kc) => kc.id === clusterId),
  );
  return localResourceGroup?.schemaRegistry || null;
}
