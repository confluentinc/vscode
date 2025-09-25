import {
  Disposable,
  Event,
  EventEmitter,
  TreeDataProvider,
  TreeItem,
  TreeView,
  Uri,
  window,
} from "vscode";
import { getExtensionContext } from "../context/extension";
import { ContextValues, setContextValue } from "../context/values";
import {
  ccloudConnected,
  environmentChanged,
  EnvironmentChangeEvent,
  localKafkaConnected,
  schemaSubjectChanged,
  SchemaVersionChangeEvent,
  schemaVersionsChanged,
  SubjectChangeEvent,
  topicSearchSet,
  topicsViewResourceChanged,
} from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { ResourceLoader } from "../loaders";
import { TopicFetchError } from "../loaders/loaderUtils";
import { Logger } from "../logging";
import { KafkaCluster } from "../models/kafkaCluster";
import { isCCloud, ISearchable, isLocal } from "../models/resource";
import { Schema, SchemaTreeItem, Subject, SubjectTreeItem } from "../models/schema";
import { KafkaTopic, KafkaTopicTreeItem } from "../models/topic";
import { logUsage, UserEvent } from "../telemetry/events";
import { DisposableCollection } from "../utils/disposables";
import { RefreshableTreeViewProvider } from "./baseModels/base";
import { updateCollapsibleStateFromSearch } from "./utils/collapsing";
import { filterItems, itemMatchesSearch, SEARCH_DECORATION_URI_SCHEME } from "./utils/search";

const logger = new Logger("viewProviders.topics");

/**
 * The types managed by the {@link TopicViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type TopicViewProviderData = KafkaTopic | Subject | Schema;

export class TopicViewProvider
  extends DisposableCollection
  implements TreeDataProvider<TopicViewProviderData>, RefreshableTreeViewProvider
{
  readonly kind = "topics";

  private _onDidChangeTreeData: EventEmitter<TopicViewProviderData | undefined | void> =
    new EventEmitter<TopicViewProviderData | undefined | void>();
  readonly onDidChangeTreeData: Event<TopicViewProviderData | undefined | void> =
    this._onDidChangeTreeData.event;

  private forceDeepRefresh: boolean = false;

  /** Repaint the topics view. When invoked from the 'refresh' button, will force deep reading from sidecar. */
  refresh(
    forceDeepRefresh: boolean = false,
    onlyIfMatching: KafkaCluster | KafkaTopic | null = null,
  ): void {
    let matching: boolean;
    if (onlyIfMatching instanceof KafkaTopic) {
      matching = this.kafkaCluster ? this.kafkaCluster.contains(onlyIfMatching) : false;
    } else if (onlyIfMatching instanceof KafkaCluster) {
      matching = this.kafkaCluster ? this.kafkaCluster.equals(onlyIfMatching) : false;
    } else {
      matching = true; // null means always refresh
    }

    // If not focused on any cluster, or if the view is currently focused on a
    // different cluster than matches onlyIfMatching, no need to refresh
    if (!this.kafkaCluster || !matching) {
      return;
    }

    this.forceDeepRefresh = forceDeepRefresh;
    this._onDidChangeTreeData.fire();
  }

  private treeView: TreeView<TopicViewProviderData>;
  /** The focused Kafka cluster; set by clicking a Kafka cluster item in the Resources view. Includes Environment ID*/
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
    super();
    if (!getExtensionContext()) {
      // getChildren() will fail without the extension context
      throw new ExtensionContextNotSetError("TopicViewProvider");
    }
    // instead of calling `.registerTreeDataProvider`, we're creating a TreeView to dynamically
    // update the tree view as needed (e.g. displaying the current Kafka cluster name in the title)
    this.treeView = window.createTreeView("confluent-topics", { treeDataProvider: this });

    const listeners: Disposable[] = this.setEventListeners();

    this.disposables.push(this.treeView, this._onDidChangeTreeData, ...listeners);
  }

  // To be replaced by upcoming base class @shoup.
  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  static getInstance(): TopicViewProvider {
    if (!TopicViewProvider.instance) {
      TopicViewProvider.instance = new TopicViewProvider();
    }
    return TopicViewProvider.instance;
  }

  /** Convenience method to revert this view to its original state. */
  async reset(): Promise<void> {
    this.kafkaCluster = null;
    this.treeView.description = "";

    await Promise.all([
      setContextValue(ContextValues.kafkaClusterSelected, false),
      this.setSearch(null),
    ]);

    this.refresh();
  }

  getTreeItem(element: TopicViewProviderData): TreeItem {
    let treeItem: TreeItem;
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
        treeItem.resourceUri = Uri.parse(
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
        const loader = ResourceLoader.getInstance(this.kafkaCluster.connectionId);
        try {
          children = await loader.getTopicsForCluster(this.kafkaCluster, this.forceDeepRefresh);
          // clear any prior request to deep refresh, allow any subsequent repaint
          // to draw from workspace storage cache.
          this.forceDeepRefresh = false;
        } catch (err) {
          logger.error("Error fetching topics for cluster", this.kafkaCluster, err);
          if (err instanceof TopicFetchError) {
            window.showErrorMessage(
              `Failed to list topics for cluster "${this.kafkaCluster.name}": ${err.message}`,
            );
          }
        }
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
      if (this.searchMatches.size > 0) {
        this.treeView.message = `Showing ${this.searchMatches.size} of ${this.totalItemCount} for "${this.itemSearchString}"`;
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
  setEventListeners(): Disposable[] {
    return [
      environmentChanged.event(this.environmentChangedHandler.bind(this)),
      ccloudConnected.event(this.ccloudConnectedHandler.bind(this)),
      localKafkaConnected.event(this.localKafkaConnectedHandler.bind(this)),
      topicsViewResourceChanged.event(this.currentKafkaClusterChangedHandler.bind(this)),
      topicSearchSet.event(this.topicSearchSetHandler.bind(this)),
      schemaSubjectChanged.event(this.subjectChangeHandler.bind(this)),
      schemaVersionsChanged.event(this.subjectChangeHandler.bind(this)),
    ];
  }

  async environmentChangedHandler(envEvent: EnvironmentChangeEvent): Promise<void> {
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
        await this.reset();
      }
    }
  }

  async ccloudConnectedHandler(connected: boolean): Promise<void> {
    if (this.kafkaCluster && isCCloud(this.kafkaCluster)) {
      // any transition of CCloud connection state should reset the tree view if we're focused on
      // a CCloud Kafka Cluster
      logger.debug(
        "Resetting topics view due to ccloudConnected event and currently focused on a CCloud cluster",
        { connected },
      );
      await this.reset();
    }
  }

  async localKafkaConnectedHandler(connected: boolean): Promise<void> {
    if (this.kafkaCluster && isLocal(this.kafkaCluster)) {
      // any transition of local resource availability should reset the tree view if we're focused
      // on a local Kafka cluster
      logger.debug(
        "Resetting topics view due to localKafkaConnected event and currently focused on a local cluster",
        { connected },
      );
      await this.reset();
    }
  }

  async currentKafkaClusterChangedHandler(cluster: KafkaCluster | null): Promise<void> {
    if (!cluster && Boolean(this.kafkaCluster)) {
      // Edging from a focused Kafka cluster to no cluster selected.
      logger.debug("currentKafkaClusterChanged event fired with null cluster, resetting view", {
        currentCluster: this.kafkaCluster,
      });

      // will set kafkaCluster to null, among other things.
      await this.reset();
    } else if (
      cluster &&
      (!this.kafkaCluster || (this.kafkaCluster && !this.kafkaCluster.equals(cluster)))
    ) {
      // Edging from no focused cluster to a cluster, or from one focused Kafka cluster to another.
      logger.debug("currentKafkaClusterChanged event fired with new cluster, updating view", {
        currentCluster: this.kafkaCluster,
        newCluster: cluster,
      });

      this.kafkaCluster = cluster;

      await Promise.all([
        this.updateTreeViewDescription(),
        setContextValue(ContextValues.kafkaClusterSelected, true),
        this.setSearch(null), // reset search when cluster changes
      ]);

      this.refresh();
    }

    // Otherwise was setting to the same cluster, or setting to null when already null, so do nothing.
  }

  async topicSearchSetHandler(searchString: string | null): Promise<void> {
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

    await Promise.all([this.setSearch(searchString), this.refresh()]);
  }

  subjectChangeHandler(event: SubjectChangeEvent | SchemaVersionChangeEvent): void {
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
  async setSearch(searchString: string | null): Promise<void> {
    // set/unset the filter so any calls to getChildren() will filter appropriately
    this.itemSearchString = searchString;

    // clear from any previous search filter
    this.searchMatches = new Set();
    this.totalItemCount = 0;

    // set context value to toggle between "search" and "clear search" actions
    await setContextValue(ContextValues.topicSearchApplied, searchString !== null);
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
