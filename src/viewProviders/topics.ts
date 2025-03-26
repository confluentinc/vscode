import * as vscode from "vscode";
import { getExtensionContext } from "../context/extension";
import { ContextValues, setContextValue } from "../context/values";
import {
  ccloudConnected,
  currentKafkaClusterChanged,
  environmentChanged,
  EnvironmentChangeEvent,
  localKafkaConnected,
  schemaSubjectChanged,
  SchemaVersionChangeEvent,
  schemaVersionsChanged,
  SubjectChangeEvent,
  topicSearchSet,
} from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { ResourceLoader } from "../loaders";
import { TopicFetchError } from "../loaders/loaderUtils";
import { Logger } from "../logging";
import { Environment } from "../models/environment";
import { KafkaCluster } from "../models/kafkaCluster";
import { isCCloud, ISearchable, isLocal } from "../models/resource";
import { Schema, SchemaTreeItem, Subject, SubjectTreeItem } from "../models/schema";
import { KafkaTopic, KafkaTopicTreeItem } from "../models/topic";
import { logUsage, UserEvent } from "../telemetry/events";
import { updateCollapsibleStateFromSearch } from "./collapsing";
import { filterItems, itemMatchesSearch, SEARCH_DECORATION_URI_SCHEME } from "./search";

const logger = new Logger("viewProviders.topics");

/**
 * The types managed by the {@link TopicViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type TopicViewProviderData = KafkaTopic | Subject | Schema;

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

  /** String to filter items returned by `getChildren`, if provided. */
  itemSearchString: string | null = null;
  /** Count of how many times the user has set a search string */
  searchStringSetCount: number = 0;
  /** Items directly matching the {@linkcode itemSearchString}, if provided. */
  searchMatches: Set<TopicViewProviderData> = new Set();
  /** Count of all items returned from `getChildren()`. */
  totalItemCount: number = 0;

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
    this.setSearch(null);
    this.refresh();
  }

  getTreeItem(element: TopicViewProviderData): vscode.TreeItem {
    let treeItem: vscode.TreeItem;
    if (element instanceof KafkaTopic) {
      treeItem = new KafkaTopicTreeItem(element);
    } else if (element instanceof Subject) {
      treeItem = new SubjectTreeItem(element);
    } else {
      // must be individual Schema.
      treeItem = new SchemaTreeItem(element);
    }

    if (this.itemSearchString) {
      if (itemMatchesSearch(element, this.itemSearchString)) {
        // special URI scheme to decorate the tree item with a dot to the right of the label,
        // and color the label, description, and decoration so it stands out in the tree view
        treeItem.resourceUri = vscode.Uri.parse(
          `${SEARCH_DECORATION_URI_SCHEME}:/${element.searchableText()}`,
        );
      }
      treeItem = updateCollapsibleStateFromSearch(element, treeItem, this.itemSearchString);
    }

    return treeItem;
  }

  async getChildren(element?: TopicViewProviderData): Promise<TopicViewProviderData[]> {
    let children: TopicViewProviderData[] = [];

    if (element) {
      // --- CHILDREN OF TREE BRANCHES ---
      // NOTE: we end up here when expanding a (collapsed) treeItem
      if (element instanceof KafkaTopic) {
        // return schema-subject containers in form of Subject[] each carrying Schema[]s.
        const loader = ResourceLoader.getInstance(element.connectionId);
        children = await loader.getTopicSubjectGroups(element);
      } else if (element instanceof Subject) {
        // Subject carrying schemas as from loadTopicSchemas, return schema versions for the topic
        children = element.schemas!;
      }
    } else {
      // --- ROOT-LEVEL ITEMS ---
      // NOTE: we end up here when the tree is first loaded, and we can use this to load the top-level items
      if (this.kafkaCluster) {
        children = await getTopicsForCluster(this.kafkaCluster, this.forceDeepRefresh);
        // clear any prior request to deep refresh, allow any subsequent repaint
        // to draw from workspace storage cache.
        this.forceDeepRefresh = false;
      }
    }

    this.totalItemCount += children.length;
    // filter the children based on the search string, if provided
    if (this.itemSearchString) {
      // if the parent item matches the search string, return all children so the user can expand
      // and see them all, even if just the parent item matched and shows the highlight(s)
      const parentMatched = element && itemMatchesSearch(element, this.itemSearchString);
      if (!parentMatched) {
        // filter the children based on the search string
        children = filterItems(
          [...children] as ISearchable[],
          this.itemSearchString,
        ) as TopicViewProviderData[];
      }
      // aggregate all elements that directly match the search string (not just how many were
      // returned in the tree view since children of directly-matching parents will be included)
      const matchingChildren = children.filter((child) =>
        itemMatchesSearch(child, this.itemSearchString!),
      );
      matchingChildren.forEach((child) => this.searchMatches.add(child));
      // update the tree view message to show how many results were found to match the search string
      // NOTE: this can't be done in `getTreeItem()` because if we don't return children here, it
      // will never be called and the message won't update
      const plural = this.totalItemCount > 1 ? "s" : "";
      if (this.searchMatches.size > 0) {
        this.treeView.message = `Showing ${this.searchMatches.size} of ${this.totalItemCount} result${plural} for "${this.itemSearchString}"`;
      } else {
        // let empty state take over
        this.treeView.message = undefined;
      }
      logUsage(UserEvent.ViewSearchAction, {
        status: "view results filtered",
        view: "Topics",
        fromItemExpansion: element !== undefined,
        searchStringSetCount: this.searchStringSetCount,
        filteredItemCount: this.searchMatches.size,
        totalItemCount: this.totalItemCount,
      });
    } else {
      this.treeView.message = undefined;
    }

    return children;
  }

  /** Set up event listeners for this view provider. */
  setEventListeners(): vscode.Disposable[] {
    const environmentChangedSub: vscode.Disposable = environmentChanged.event(
      async (envEvent: EnvironmentChangeEvent) => {
        if (this.kafkaCluster && this.kafkaCluster.environmentId === envEvent.id) {
          if (!envEvent.wasDeleted) {
            logger.debug(
              "environmentChanged event fired with matching Kafka cluster env ID, updating view description",
              {
                envEvent,
              },
            );
            await this.updateTreeViewDescription();
            this.refresh();
          } else {
            logger.debug(
              "environmentChanged deletion event fired with matching Kafka cluster env ID, resetting view",
              {
                envEvent,
              },
            );
            this.reset();
          }
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
        logger.debug(
          `currentKafkaClusterChanged event fired, ${cluster ? "refreshing" : "resetting"}.`,
          { cluster },
        );
        this.setSearch(null); // reset search when cluster changes
        if (!cluster) {
          this.reset();
        } else {
          setContextValue(ContextValues.kafkaClusterSelected, true);
          this.kafkaCluster = cluster;
          await this.updateTreeViewDescription();
          this.refresh();
        }
      },
    );

    const topicSearchSetSub: vscode.Disposable = topicSearchSet.event(
      (searchString: string | null) => {
        logger.debug("topicSearchSet event fired, refreshing", { searchString });
        // mainly captures the last state of the search internals to see if search was adjusted after
        // a previous search was used, or if this is the first time search is being used
        if (searchString !== null) {
          // used to group search events without sending the search string itself
          this.searchStringSetCount++;
        }
        logUsage(UserEvent.ViewSearchAction, {
          status: `search string ${searchString ? "set" : "cleared"}`,
          view: "Topics",
          searchStringSetCount: this.searchStringSetCount,
          hadExistingSearchString: this.itemSearchString !== null,
          lastFilteredItemCount: this.searchMatches.size,
          lastTotalItemCount: this.totalItemCount,
        });
        this.setSearch(searchString);
        this.refresh();
      },
    );

    const subjectChangeHandler = (event: SubjectChangeEvent | SchemaVersionChangeEvent) => {
      const [subject, change] = [event.subject, event.change];

      if (this.kafkaCluster?.environmentId === subject.environmentId) {
        logger.debug(
          `A schema subject ${change} in the environment being viewed, refreshing toplevel`,
          {
            subject: subject.name,
          },
        );

        // Toplevel repaint.
        this.refresh();
      }
    };

    // A schema subject was added or removed.
    const schemaSubjectChangedSub: vscode.Disposable =
      schemaSubjectChanged.event(subjectChangeHandler);

    // A schema version was added or removed.
    const schemaVersionsChangedSub: vscode.Disposable =
      schemaVersionsChanged.event(subjectChangeHandler);

    return [
      environmentChangedSub,
      ccloudConnectedSub,
      localKafkaConnectedSub,
      currentKafkaClusterChangedSub,
      topicSearchSetSub,
      schemaSubjectChangedSub,
      schemaVersionsChangedSub,
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

  /** Update internal state when the search string is set or unset. */
  setSearch(searchString: string | null): void {
    // set/unset the filter so any calls to getChildren() will filter appropriately
    this.itemSearchString = searchString;
    // set context value to toggle between "search" and "clear search" actions
    setContextValue(ContextValues.topicSearchApplied, searchString !== null);
    // clear from any previous search filter
    this.searchMatches = new Set();
    this.totalItemCount = 0;
  }

  /** Are we currently viewing a CCloud-based Kafka cluster? */
  isFocusedOnCCloud(): boolean {
    return this.kafkaCluster !== null && isCCloud(this.kafkaCluster);
  }
}

/** Get the singleton instance of the {@link TopicViewProvider} */
export function getTopicViewProvider() {
  return TopicViewProvider.getInstance();
}

/**
 * Determine the topics offered from this cluster. If topics are already known
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
