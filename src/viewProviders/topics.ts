import * as vscode from "vscode";
import { getExtensionContext } from "../context/extension";
import { ContextValues, setContextValue } from "../context/values";
import {
  ccloudConnected,
  currentKafkaClusterChanged,
  environmentChanged,
  localKafkaConnected,
} from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { KafkaCluster } from "../models/kafkaCluster";
import { ContainerTreeItem } from "../models/main";
import { isCCloud, isLocal } from "../models/resource";
import { Schema, SchemaTreeItem, generateSchemaSubjectGroups } from "../models/schema";
import { KafkaTopic, KafkaTopicTreeItem } from "../models/topic";
import { ResourceLoader, TopicFetchError } from "../storage/resourceLoader";

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
  /** The parent of the focused Kafka cluster.  */
  public environment: Environment | null = null;
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
    const environmentChangedSub: vscode.Disposable = environmentChanged.event(
      async (envId: string) => {
        if (this.kafkaCluster && this.kafkaCluster.environmentId === envId) {
          logger.debug(
            "environmentChanged event fired with matching Kafka cluster env ID, updating view description",
            {
              envId,
            },
          );
          await this.updateTreeViewDescription();
          this.refresh();
        }
      },
    );

    const ccloudConnectedSub: vscode.Disposable = ccloudConnected.event((connected: boolean) => {
      if (this.kafkaCluster && isCCloud(this.kafkaCluster)) {
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
        if (this.kafkaCluster && isLocal(this.kafkaCluster)) {
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
          await this.updateTreeViewDescription();
          this.refresh();
        }
      },
    );

    return [
      environmentChangedSub,
      ccloudConnectedSub,
      localKafkaConnectedSub,
      currentKafkaClusterChangedSub,
    ];
  }

  /** Update the tree view description to show the currently-focused Kafka cluster's parent env
   * name and the Kafka cluster name. */
  async updateTreeViewDescription(): Promise<void> {
    const cluster = this.kafkaCluster;
    if (!cluster) {
      return;
    }
    const loader = ResourceLoader.getInstance(cluster.connectionId);
    const envs = await loader.getEnvironments();
    const parentEnv = envs.find((env) => env.id === cluster.environmentId);
    this.environment = parentEnv ?? null;
    if (parentEnv) {
      this.treeView.description = `${parentEnv.name} | ${cluster.name}`;
    } else {
      logger.warn("couldn't find parent environment for Kafka cluster", {
        cluster,
      });
      this.treeView.description = cluster.name;
    }
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
  const loader = ResourceLoader.getInstance(cluster.connectionId);

  try {
    return loader.getTopicsForCluster(cluster, forceRefresh);
  } catch (err) {
    logger.error("Error fetching topics for cluster", cluster, err);
    if (err instanceof TopicFetchError) {
      vscode.window.showErrorMessage(
        `Failed to list topics for cluster "${cluster.name}": ${err.message}`,
      );
    }
    return [];
  }
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
  const loader = ResourceLoader.getInstance(topic.connectionId);

  const schemas = await loader.getSchemasForEnvironmentId(topic.environmentId);
  const subjects = await loader.getSubjects(topic.environmentId);

  if (subjects.length !== schemas.length) {
    logger.warn(`Mismatch between subjects (${subjects.length}) and schemas ${schemas.length}`);
  } else {
    logger.debug(`Loaded ${subjects.length} subjects for environment ${topic.environmentId}`);
  }

  return generateSchemaSubjectGroups(schemas, topic.name);
}
