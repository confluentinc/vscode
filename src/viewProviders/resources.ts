import * as vscode from "vscode";
import { ConnectionStatus } from "../clients/sidecar";
import {
  CCLOUD_CONNECTION_ID,
  EXTENSION_VERSION,
  IconNames,
  LOCAL_CONNECTION_ID,
} from "../constants";
import { getExtensionContext } from "../context/extension";
import { ContextValues, setContextValue } from "../context/values";
import { DirectConnectionManager } from "../directConnectManager";
import {
  ccloudConnected,
  ccloudOrganizationChanged,
  connectionStable,
  directConnectionCreated,
  directConnectionsChanged,
  localKafkaConnected,
  localSchemaRegistryConnected,
  resourceSearchSet,
} from "../emitters";
import { ExtensionContextNotSetError, logError } from "../errors";
import { getDirectResources } from "../graphql/direct";
import { getLocalResources } from "../graphql/local";
import { getCurrentOrganization } from "../graphql/organizations";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import {
  CCloudEnvironment,
  DirectEnvironment,
  Environment,
  EnvironmentTreeItem,
  LocalEnvironment,
} from "../models/environment";
import {
  CCloudFlinkComputePool,
  FlinkComputePool,
  FlinkComputePoolTreeItem,
} from "../models/flinkComputePool";
import {
  CCloudKafkaCluster,
  DirectKafkaCluster,
  KafkaCluster,
  KafkaClusterTreeItem,
  LocalKafkaCluster,
} from "../models/kafkaCluster";
import { ContainerTreeItem } from "../models/main";
import {
  ConnectionId,
  ConnectionLabel,
  EnvironmentId,
  isDirect,
  ISearchable,
} from "../models/resource";
import {
  CCloudSchemaRegistry,
  DirectSchemaRegistry,
  LocalSchemaRegistry,
  SchemaRegistry,
  SchemaRegistryTreeItem,
} from "../models/schemaRegistry";
import { showErrorNotificationWithButtons } from "../notifications";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { updateLocalConnection } from "../sidecar/connections/local";
import { ConnectionStateWatcher } from "../sidecar/connections/watcher";
import { DirectConnectionsById, getResourceManager } from "../storage/resourceManager";
import { logUsage, UserEvent } from "../telemetry/events";
import { RefreshableTreeViewProvider } from "./base";
import { updateCollapsibleStateFromSearch } from "./collapsing";
import { filterItems, itemMatchesSearch, SEARCH_DECORATION_URI_SCHEME } from "./search";

const logger = new Logger("viewProviders.resources");

type CCloudResources =
  | CCloudEnvironment
  | CCloudKafkaCluster
  | CCloudSchemaRegistry
  | CCloudFlinkComputePool;
type LocalResources = LocalEnvironment | LocalKafkaCluster | LocalSchemaRegistry;
type DirectResources = DirectEnvironment | DirectKafkaCluster | DirectSchemaRegistry;

/**
 * The types managed by the {@link ResourceViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type ResourceViewProviderData =
  | ContainerTreeItem<CCloudEnvironment>
  | CCloudResources
  | ContainerTreeItem<LocalKafkaCluster | LocalSchemaRegistry>
  | LocalResources
  | DirectResources;

export class ResourceViewProvider
  implements vscode.TreeDataProvider<ResourceViewProviderData>, RefreshableTreeViewProvider
{
  readonly kind: string = "resources";
  /** Disposables belonging to this provider to be added to the extension context during activation,
   * cleaned up on extension deactivation. */
  disposables: vscode.Disposable[] = [];

  private _onDidChangeTreeData = new vscode.EventEmitter<
    ResourceViewProviderData | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Did the user use the 'refresh' button / command to force a deep refresh of the tree? */
  private forceDeepRefresh: boolean = false;
  /** Have we informed the sidecar of any direct connections saved in secret storage? */
  private rehydratedDirectConnections: boolean = false;

  /**
   * {@link Environment}s managed by this provider, stored by their environment IDs.
   *
   * (For local/direct connection resources, these keys are the same values as their `connectionId`s.)
   */
  environmentsMap: Map<string, CCloudEnvironment | LocalEnvironment | DirectEnvironment> =
    new Map();

  private possiblyLoadingConnectionIds: Set<ConnectionId> = new Set();

  // env id -> preannounced loading state coming from sidecar websocket
  // events to us via connectionUsable emitter.
  private cachedLoadingStates: Map<string, boolean> = new Map();

  /** String to filter items returned by `getChildren`, if provided. */
  itemSearchString: string | null = null;
  /** Count of how many times the user has set a search string */
  searchStringSetCount: number = 0;
  /** Items directly matching the {@linkcode itemSearchString}, if provided. */
  searchMatches: Set<ResourceViewProviderData> = new Set();
  /** Count of all items returned from `getChildren()`. */
  totalItemCount: number = 0;

  refresh(forceDeepRefresh: boolean = false): void {
    this.forceDeepRefresh = forceDeepRefresh;
    this._onDidChangeTreeData.fire();
    // update the UI for any added/removed direct environments
    this.updateEnvironmentContextValues();
  }

  private treeView: vscode.TreeView<vscode.TreeItem>;
  private static instance: ResourceViewProvider | null = null;

  private constructor() {
    if (!getExtensionContext()) {
      // getChildren() will fail without the extension context
      throw new ExtensionContextNotSetError("ResourceViewProvider");
    }

    // instead of calling `.registerTreeDataProvider`, we're creating a TreeView to dynamically
    // update the tree view as needed (e.g. displaying the current connection label in the title)
    this.treeView = vscode.window.createTreeView("confluent-resources", { treeDataProvider: this });

    const listeners = this.setEventListeners();

    // dispose of the tree view and listeners when the extension is deactivated
    this.disposables.push(this.treeView, ...listeners);
  }

  static getInstance(): ResourceViewProvider {
    if (!ResourceViewProvider.instance) {
      ResourceViewProvider.instance = new ResourceViewProvider();
    }
    return ResourceViewProvider.instance;
  }

  async getTreeItem(element: ResourceViewProviderData): Promise<vscode.TreeItem> {
    let treeItem: vscode.TreeItem;
    if (element instanceof Environment) {
      if (isDirect(element)) {
        // update contextValues for all known direct environments, not just the one that was updated
        await this.updateEnvironmentContextValues();
      }
      treeItem = new EnvironmentTreeItem(element);
    } else if (element instanceof KafkaCluster) {
      treeItem = new KafkaClusterTreeItem(element);
    } else if (element instanceof SchemaRegistry) {
      treeItem = new SchemaRegistryTreeItem(element);
    } else if (element instanceof FlinkComputePool) {
      treeItem = new FlinkComputePoolTreeItem(element);
    } else {
      // should only be left with ContainerTreeItems
      treeItem = element;
    }

    if (this.itemSearchString) {
      if (itemMatchesSearch(element, this.itemSearchString)) {
        // special URI scheme to decorate the tree item with a dot to the right of the label,
        // and color the label, description, and decoration so it stands out in the tree view
        treeItem.resourceUri = vscode.Uri.parse(`${SEARCH_DECORATION_URI_SCHEME}:/${element.id}`);
      }
      treeItem = updateCollapsibleStateFromSearch(element, treeItem, this.itemSearchString);
    }

    return treeItem;
  }

  async getChildren(element?: ResourceViewProviderData): Promise<ResourceViewProviderData[]> {
    // if this is the first time we're loading the Resources view items, ensure we've told the sidecar
    // about any direct connections before the GraphQL queries kick off
    if (!this.rehydratedDirectConnections) {
      await DirectConnectionManager.getInstance().rehydrateConnections();
      this.rehydratedDirectConnections = true;
    }

    let children: ResourceViewProviderData[] = [];

    if (element) {
      // --- CHILDREN OF TREE BRANCHES ---
      // NOTE: we end up here when expanding a (collapsed) treeItem
      if (element instanceof ContainerTreeItem) {
        // expand containers for kafka clusters, schema registry, flink compute pools, etc
        children = element.children;
      } else if (element instanceof Environment) {
        children = element.children as ResourceViewProviderData[];
      }
    } else {
      // start loading the root-level items
      const resourcePromises: [
        Promise<ContainerTreeItem<CCloudEnvironment>>,
        Promise<ContainerTreeItem<LocalKafkaCluster | LocalSchemaRegistry>>,
        Promise<DirectEnvironment[]>,
      ] = [loadCCloudResources(this.forceDeepRefresh), loadLocalResources(), loadDirectResources()];

      const [ccloudContainer, localContainer, directEnvironments]: [
        ContainerTreeItem<CCloudEnvironment>,
        ContainerTreeItem<LocalKafkaCluster | LocalSchemaRegistry>,
        DirectEnvironment[],
      ] = await Promise.all(resourcePromises);

      this.assignIsLoading(directEnvironments);

      children = [ccloudContainer, localContainer, ...directEnvironments];

      if (this.forceDeepRefresh) {
        // reset the flag after the initial deep refresh
        this.forceDeepRefresh = false;
      }

      // store instances of the environments for any per-item updates that need to happen later
      if (ccloudContainer) {
        const ccloudEnvs = (ccloudContainer as ContainerTreeItem<CCloudEnvironment>).children;
        ccloudEnvs.forEach((env) => this.environmentsMap.set(env.id, env));
      }
      // TODO: we aren't tracking LocalEnvironments yet, so skip that here
      if (directEnvironments) {
        const watcher = ConnectionStateWatcher.getInstance();
        directEnvironments.forEach((env) => {
          // if we have a cached loading state for this environment
          // (due to websocket events coming in before the graphql query completes),
          // update the environment's isLoading state before adding it to the map
          const cachedLoading = this.cachedLoadingStates.get(env.id);
          if (cachedLoading !== undefined) {
            env.isLoading = cachedLoading;
            this.cachedLoadingStates.delete(env.id);
          }
          // if our ConnectionStatusWatcher was either rehydrated with connection info from the
          // list-connections (HTTP) endpoint or has received a websocket event for this connection,
          // update the environment with the latest status (e.g. `FAILED` state reasons)
          const latestStatus: ConnectionStatus | undefined = watcher.getLatestConnectionEvent(
            env.connectionId,
          )?.connection.status;
          if (latestStatus) {
            env = this.updateEnvironmentFromConnectionStatus(env, latestStatus);
          }
          this.environmentsMap.set(env.id, env);
        });
      }
    }

    this.totalItemCount += children.length;
    if (this.itemSearchString) {
      // if the parent item matches the search string, return all children so the user can expand
      // and see them all, even if just the parent item matched and shows the highlight(s)
      const parentMatched = element && itemMatchesSearch(element, this.itemSearchString);
      if (!parentMatched) {
        // filter the children based on the search string
        children = filterItems(
          [...children] as ISearchable[],
          this.itemSearchString,
        ) as ResourceViewProviderData[];
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
        view: "Resources",
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
    const newlyCreatedConnectionSub: vscode.Disposable = directConnectionCreated.event(
      (connectionId: ConnectionId) => {
        logger.debug(
          "resourcesView: directConnectionCreated event fired, marking as newly created",
          { connectionId },
        );
        this.possiblyLoadingConnectionIds.add(connectionId);
      },
    );
    const ccloudConnectedSub: vscode.Disposable = ccloudConnected.event((connected: boolean) => {
      logger.debug("ccloudConnected event fired", { connected });
      // No need to force a deep refresh when the connection status changes because the
      // preloader will have already begun loading resources due to also observing this event.
      this.refresh();
    });

    const ccloudOrganizationChangedSub: vscode.Disposable = ccloudOrganizationChanged.event(() => {
      // Force a deep refresh of ccloud resources when the organization changes.
      this.refresh(true);
    });

    const directConnectionsChangedSub: vscode.Disposable = directConnectionsChanged.event(
      async () => {
        logger.debug("directConnectionsChanged event fired, refreshing");
        // remove any unused environments from the environmentsMap before refreshing the tree so
        // contextValue changes are accurately reflected in the UI
        await this.removeUnusedEnvironments();
        this.refresh();
      },
    );

    const localKafkaConnectedSub: vscode.Disposable = localKafkaConnected.event(
      (connected: boolean) => {
        logger.debug("localKafkaConnected event fired", { connected });
        this.refresh();
      },
    );

    const localSchemaRegistryConnectedSub: vscode.Disposable = localSchemaRegistryConnected.event(
      (connected: boolean) => {
        logger.debug("localSchemaRegistryConnected event fired", { connected });
        this.refresh();
      },
    );

    const connectionUsableSub: vscode.Disposable = connectionStable.event((id: ConnectionId) => {
      logger.debug("connectionStable event fired", { id });
      // if is stable, then is definitely not loading anymore.
      this.possiblyLoadingConnectionIds.delete(id);
      this.refreshConnection(id, false);
    });

    const resourceSearchSetSub: vscode.Disposable = resourceSearchSet.event(
      (searchString: string | null) => {
        logger.debug("resourceSearchSet event fired, refreshing", { searchString });
        // mainly captures the last state of the search internals to see if search was adjusted after
        // a previous search was used, or if this is the first time search is being used
        if (searchString !== null) {
          // used to group search events without sending the search string itself
          this.searchStringSetCount++;
        }
        logUsage(UserEvent.ViewSearchAction, {
          status: `search string ${searchString ? "set" : "cleared"}`,
          view: "Resources",
          searchStringSetCount: this.searchStringSetCount,
          hadExistingSearchString: this.itemSearchString !== null,
          lastFilteredItemCount: this.searchMatches.size,
          lastTotalItemCount: this.totalItemCount,
        });
        this.setSearch(searchString);
        this.refresh();
      },
    );

    return [
      newlyCreatedConnectionSub,
      ccloudConnectedSub,
      ccloudOrganizationChangedSub,
      directConnectionsChangedSub,
      localKafkaConnectedSub,
      localSchemaRegistryConnectedSub,
      connectionUsableSub,
      resourceSearchSetSub,
    ];
  }

  async refreshConnection(id: ConnectionId, loading: boolean = false) {
    switch (id) {
      case CCLOUD_CONNECTION_ID:
        logger.debug("refreshConnection() ccloud: Not implemented");
        break;
      case LOCAL_CONNECTION_ID:
        logger.debug("refreshConnection() local: Not implemented");
        break;
      default: {
        // direct connections are treated as environments, so we can look up the direct "environment"
        // by its connection ID
        let environment = this.environmentsMap.get(id) as DirectEnvironment | undefined;
        if (environment) {
          logger.debug(`refreshing direct environment id="${id}" with loading state: ${loading}`);
          if (!loading) {
            // if the connection is usable, we need to refresh the children of the environment
            // to potentially show the Kafka clusters and Schema Registry and update the collapsible
            // state of the item
            const directEnvs = await getDirectResources();
            const directEnv = directEnvs.find((env) => env.id === (id as unknown as EnvironmentId));
            if (directEnv) {
              environment.kafkaClusters = directEnv.kafkaClusters;
              environment.schemaRegistry = directEnv.schemaRegistry;
            }
            // we also need to check for any `FAILED` states' error messages for the Kafka and/or
            // Schema Registry configs based on the last websocket event
            const lastStatus: ConnectionStatus | undefined =
              ConnectionStateWatcher.getInstance().getLatestConnectionEvent(id)?.connection.status;
            if (lastStatus) {
              environment = this.updateEnvironmentFromConnectionStatus(environment, lastStatus);
            }
          }
          environment.isLoading = loading;
          // only update this environment in the tree view, not the entire view
          this._onDidChangeTreeData.fire(environment);
        } else {
          logger.debug("could not find direct environment in map to update. Caching for later.", {
            id,
            loading,
          });
          this.cachedLoadingStates.set(id, loading);
        }
      }
    }
  }

  /** Update a {@linkcode DirectEnvironment} with the latest connection status from the sidecar.
   * Used to surface error messages for specific configs through the UI. */
  updateEnvironmentFromConnectionStatus(
    env: DirectEnvironment,
    status: ConnectionStatus,
  ): DirectEnvironment {
    if (!isDirect(env)) {
      return env;
    }
    logger.debug("updating environment with last status from connection state watcher", {
      id: env.id,
    });
    // if either of these are undefined, we clear any error text that will be seen in the tooltips;
    // otherwise we display the error message(s) in the tooltip
    env.kafkaConnectionFailed = status.kafka_cluster?.errors?.sign_in?.message;
    env.schemaRegistryConnectionFailed = status.schema_registry?.errors?.sign_in?.message;
    return env;
  }

  /** Update the context values for the current environment's resource availability. This is used
   * to change the empty state of our primary resource views and toggle actions in the UI. */
  async updateEnvironmentContextValues() {
    const envs: Environment[] = Array.from(this.environmentsMap.values());
    // currently just updating for direct environments, but if we start updating individual CCloud
    // or local environments, we can update those context values here as well
    const directEnvs: DirectEnvironment[] = envs.filter(
      (env): env is DirectEnvironment => env instanceof DirectEnvironment,
    );
    await Promise.all([
      setContextValue(
        ContextValues.directKafkaClusterAvailable,
        directEnvs.some((env) => env.kafkaClusters.length > 0),
      ),
      setContextValue(
        ContextValues.directSchemaRegistryAvailable,
        directEnvs.some((env) => !!env.schemaRegistry),
      ),
    ]);
  }

  /** Remove any environments from {@linkcode environmentsMap} that are no longer present in storage. */
  async removeUnusedEnvironments() {
    // only handling direct environments for now
    const specs: DirectConnectionsById = await getResourceManager().getDirectConnections();
    const currentIds: string[] = Array.from(this.environmentsMap.keys());
    currentIds.forEach((id) => {
      // environment ID and connection ID are the same for direct connections
      if (!specs.has(id as ConnectionId)) {
        logger.debug(`removing direct environment "${id}" from map`);
        this.environmentsMap.delete(id);
      }
    });
  }

  /** Update internal state when the search string is set or unset. */
  setSearch(searchString: string | null): void {
    // set/unset the filter so any calls to getChildren() will filter appropriately
    this.itemSearchString = searchString;
    // set context value to toggle between "search" and "clear search" actions
    setContextValue(ContextValues.resourceSearchApplied, searchString !== null);
    // clear from any previous search filter
    this.searchMatches = new Set();
    this.totalItemCount = 0;
  }

  /**
   * Assign the loading state to all direct environments.
   * Takes note as to which connections should be considered
   * "loading" from the {@link possiblyLoadingConnectionIds} set, and
   * possibly reassigns the environment's isLoading accordingly.
   * */
  assignIsLoading(directEnvs: DirectEnvironment[]): void {
    directEnvs.forEach((env) => {
      const isNewlyCreated = this.possiblyLoadingConnectionIds.has(env.connectionId);

      if (isNewlyCreated) {
        // Connection is new, so we want to show the spinny icon. Leave env.isLoading as is.
        // Remove the connection ID from the set so we will clean any isLoading in future repaints.
        this.possiblyLoadingConnectionIds.delete(env.connectionId);

        logger.debug(`assignIsLoading() leaving isLoading=true for direct environment ${env.id}`, {
          connectionId: env.connectionId,
        });
      } else {
        // Environment objects w/o clusters are default to isLoading = true, which makes the spinny icon.
        // Only want the spinning icon for actual new connections which should then get followup
        // websocket events marking them as no longer loading.
        env.isLoading = false;
        logger.debug(`assignIsLoading() setting isLoading=false for direct environment ${env.id}`, {
          connectionId: env.connectionId,
        });
      }
    });
  }
}

/**
 * Load the Confluent Cloud container and child resources based on CCloud connection status.
 *
 * If the user has an active CCloud connection, the container will be expanded to show the
 * CCloud environments and their sub-resources. The description will also change to show the
 * current organization name.
 *
 * Otherwise, the container will not be expandable and show a "No connection" message with an action to
 * connect to CCloud.
 */
export async function loadCCloudResources(
  forceDeepRefresh: boolean = false,
): Promise<ContainerTreeItem<CCloudEnvironment>> {
  // empty container item for the Confluent Cloud resources to start, whose `.id` will change
  // depending on the user's CCloud connection status to adjust the collapsible state and actions
  const cloudContainerItem = new ContainerTreeItem<CCloudEnvironment>(
    ConnectionLabel.CCLOUD,
    vscode.TreeItemCollapsibleState.None,
    [],
  );
  cloudContainerItem.iconPath = new vscode.ThemeIcon(IconNames.CONFLUENT_LOGO);
  cloudContainerItem.id = `ccloud-${EXTENSION_VERSION}`;

  if (hasCCloudAuthSession()) {
    const loader = CCloudResourceLoader.getInstance();
    // TODO: have this cached in the resource manager via the loader
    const currentOrg = await getCurrentOrganization();

    const ccloudEnvironments: CCloudEnvironment[] = [];
    try {
      const ccloudEnvs = await loader.getEnvironments(forceDeepRefresh);
      logger.debug(`got ${ccloudEnvs.length} CCloud environment(s) from loader`);
      ccloudEnvironments.push(...ccloudEnvs);
    } catch (e) {
      // if we fail to load CCloud environments, we need to get as much information as possible as to
      // what went wrong since the user is effectively locked out of the CCloud resources for this org
      const msg = `Failed to load Confluent Cloud environments for the "${currentOrg?.name}" organization.`;
      logError(e, "loading CCloud environments", {
        extra: { functionName: "loadCCloudResources" },
      });
      showErrorNotificationWithButtons(msg);
    }

    cloudContainerItem.collapsibleState =
      ccloudEnvironments.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None;
    // removes the "Add Connection" action on hover and enables the "Change Organization" action
    cloudContainerItem.contextValue = "resources-ccloud-container-connected";
    cloudContainerItem.description = currentOrg?.name ?? "";
    cloudContainerItem.children = ccloudEnvironments;
    // XXX: adjust the ID to ensure the collapsible state is correctly updated in the UI
    cloudContainerItem.id = `ccloud-connected-${EXTENSION_VERSION}`;
  } else {
    // enables the "Add Connection" action to be displayed on hover
    cloudContainerItem.contextValue = "resources-ccloud-container";
    cloudContainerItem.description = "(No connection)";
  }

  return cloudContainerItem;
}

// TODO(shoup): update this comment + underlying logic once we have local resource management actions
/**
 * Load the local resources into a container tree item.
 *
 * @returns A container tree item with the local Kafka clusters as children
 */
export async function loadLocalResources(): Promise<
  ContainerTreeItem<LocalKafkaCluster | LocalSchemaRegistry>
> {
  const localContainerItem = new ContainerTreeItem<LocalKafkaCluster | LocalSchemaRegistry>(
    ConnectionLabel.LOCAL,
    vscode.TreeItemCollapsibleState.None,
    [],
  );
  localContainerItem.iconPath = new vscode.ThemeIcon(IconNames.LOCAL_RESOURCE_GROUP);

  const notConnectedId = "local-container";
  localContainerItem.id = `local-${EXTENSION_VERSION}`;
  // enable the "Launch Local Resources" action
  localContainerItem.contextValue = notConnectedId;

  localContainerItem.description = "(Not running)";
  localContainerItem.tooltip = new vscode.MarkdownString(
    "Local Kafka clusters discoverable at port `8082` are shown here.",
  );

  // before we try listing any resources (for possibly the first time), we need to check if any
  // supported Schema Registry containers are running, then grab their REST proxy port to send to
  // the sidecar for discovery before the GraphQL query kicks off
  await updateLocalConnection();

  const localEnvs: LocalEnvironment[] = await getLocalResources();
  logger.debug(`got ${localEnvs.length} local environment(s) from GQL query`);

  const localKafkaClusters: LocalKafkaCluster[] = [];
  const localSchemaRegistries: LocalSchemaRegistry[] = [];
  if (localEnvs.length > 0) {
    const connectedId = "local-container-connected";
    // enable the "Stop Local Resources" action
    localContainerItem.contextValue = connectedId;
    // unpack the local resources to more easily update the UI elements
    localEnvs.forEach((env: LocalEnvironment) => {
      localKafkaClusters.push(...env.kafkaClusters);
      if (env.schemaRegistry) {
        localSchemaRegistries.push(env.schemaRegistry);
      }
    });
    // XXX: adjust the ID to ensure the collapsible state is correctly updated in the UI
    localContainerItem.id = `local-connected-${EXTENSION_VERSION}`;
    localContainerItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    // override the default "child item count" description
    localContainerItem.description = localKafkaClusters.map((cluster) => cluster.uri).join(", ");
    // TODO: this should be handled in the loader once it (and ResourceManager) start handling
    // local resources
    getResourceManager().setLocalKafkaClusters(localKafkaClusters);
    localContainerItem.children = [...localKafkaClusters, ...localSchemaRegistries];
  }

  // update the UI based on whether or not we have local resources available
  await Promise.all([
    setContextValue(ContextValues.localKafkaClusterAvailable, localKafkaClusters.length > 0),
    setContextValue(ContextValues.localSchemaRegistryAvailable, localSchemaRegistries.length > 0),
  ]);

  return localContainerItem;
}

export async function loadDirectResources(): Promise<DirectEnvironment[]> {
  // fetch all direct connections and their resources; each connection will be treated the same as a
  // CCloud environment (connection ID and environment ID are the same)
  const directEnvs = await getDirectResources();
  logger.debug(`got ${directEnvs.length} direct environment(s) from GQL query`);
  return directEnvs;
}
