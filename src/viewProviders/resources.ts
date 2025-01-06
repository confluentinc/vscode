import * as Sentry from "@sentry/node";
import * as vscode from "vscode";
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
  connectionLoading,
  connectionUsable,
  directConnectionsChanged,
  localKafkaConnected,
  localSchemaRegistryConnected,
} from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { getDirectResources } from "../graphql/direct";
import { getLocalResources } from "../graphql/local";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import {
  CCloudEnvironment,
  DirectEnvironment,
  Environment,
  EnvironmentTreeItem,
  LocalEnvironment,
} from "../models/environment";
import {
  CCloudKafkaCluster,
  DirectKafkaCluster,
  KafkaCluster,
  KafkaClusterTreeItem,
  LocalKafkaCluster,
} from "../models/kafkaCluster";
import { ContainerTreeItem } from "../models/main";
import { ConnectionId, ConnectionLabel } from "../models/resource";
import {
  CCloudSchemaRegistry,
  DirectSchemaRegistry,
  LocalSchemaRegistry,
  SchemaRegistry,
  SchemaRegistryTreeItem,
} from "../models/schemaRegistry";
import { hasCCloudAuthSession, updateLocalConnection } from "../sidecar/connections";
import { CCloudResourceLoader } from "../storage/ccloudResourceLoader";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("viewProviders.resources");

type CCloudResources = CCloudEnvironment | CCloudKafkaCluster | CCloudSchemaRegistry;
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

export class ResourceViewProvider implements vscode.TreeDataProvider<ResourceViewProviderData> {
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

  refresh(forceDeepRefresh: boolean = false): void {
    this.forceDeepRefresh = forceDeepRefresh;
    this._onDidChangeTreeData.fire();
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

  getTreeItem(element: ResourceViewProviderData): vscode.TreeItem {
    if (element instanceof Environment) {
      return new EnvironmentTreeItem(element);
    } else if (element instanceof KafkaCluster) {
      return new KafkaClusterTreeItem(element);
    } else if (element instanceof SchemaRegistry) {
      return new SchemaRegistryTreeItem(element);
    }
    // should only be left with ContainerTreeItems
    return element;
  }

  async getChildren(element?: ResourceViewProviderData): Promise<ResourceViewProviderData[]> {
    // if this is the first time we're loading the Resources view items, ensure we've told the sidecar
    // about any direct connections before the GraphQL queries kick off
    if (!this.rehydratedDirectConnections) {
      await DirectConnectionManager.getInstance().rehydrateConnections();
      this.rehydratedDirectConnections = true;
    }

    if (element) {
      // --- CHILDREN OF TREE BRANCHES ---
      // NOTE: we end up here when expanding a (collapsed) treeItem
      if (element instanceof ContainerTreeItem) {
        // expand containers for kafka clusters, schema registry, flink compute pools, etc
        return element.children;
      } else if (element instanceof CCloudEnvironment) {
        return await getCCloudEnvironmentChildren(element);
      } else if (element instanceof DirectEnvironment) {
        const children: DirectResources[] = [];
        if (element.kafkaClusters)
          children.push(...(element.kafkaClusters as DirectKafkaCluster[]));
        if (element.schemaRegistry) children.push(element.schemaRegistry);
        logger.debug(`got ${children.length} direct resources for environment ${element.id}`);
        return children;
      }
    } else {
      // --- ROOT-LEVEL ITEMS ---
      // NOTE: we end up here when the tree is first loaded
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

      if (this.forceDeepRefresh) {
        this.forceDeepRefresh = false;
      }

      if (ccloudContainer) {
        const ccloudEnvs = (ccloudContainer as ContainerTreeItem<CCloudEnvironment>).children;
        ccloudEnvs.forEach((env) => this.environmentsMap.set(env.id, env));
      }
      // TODO: we aren't tracking LocalEnvironments yet, so skip that here
      if (directEnvironments) {
        directEnvironments.forEach((env) => this.environmentsMap.set(env.id, env));
      }

      return [ccloudContainer, localContainer, ...directEnvironments];
    }

    return [];
  }

  /** Set up event listeners for this view provider. */
  setEventListeners(): vscode.Disposable[] {
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

    const directConnectionsChangedSub: vscode.Disposable = directConnectionsChanged.event(() => {
      logger.debug("directConnectionsChanged event fired, refreshing");
      this.refresh();
    });

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

    const connectionLoadingSub: vscode.Disposable = connectionLoading.event((id: ConnectionId) => {
      this.refreshConnection(id, true);
    });

    const connectionUsableSub: vscode.Disposable = connectionUsable.event((id: ConnectionId) => {
      this.refreshConnection(id, false);
    });

    return [
      ccloudConnectedSub,
      ccloudOrganizationChangedSub,
      directConnectionsChangedSub,
      localKafkaConnectedSub,
      localSchemaRegistryConnectedSub,
      connectionLoadingSub,
      connectionUsableSub,
    ];
  }

  async refreshConnection(id: ConnectionId, loading: boolean = false) {
    switch (id) {
      case CCLOUD_CONNECTION_ID:
        throw new Error("Not implemented");
      case LOCAL_CONNECTION_ID:
        throw new Error("Not implemented");
      default: {
        // direct connections are treated as environments, so we can look up the direct "environment"
        // by its connection ID
        const environment = this.environmentsMap.get(id);
        if (environment) {
          if (!loading) {
            // if the connection is usable, we need to refresh the children of the environment
            // to potentially show the Kafka clusters and Schema Registry and update the collapsible
            // state of the item
            const directEnvs = await getDirectResources();
            const directEnv = directEnvs.find((env) => env.id === id);
            if (directEnv) {
              environment.kafkaClusters = directEnv.kafkaClusters;
              environment.schemaRegistry = directEnv.schemaRegistry;
            }
          }
          environment.isLoading = loading;
          // only update this environment in the tree view, not the entire view
          this._onDidChangeTreeData.fire(environment);
        } else {
          logger.debug("could not find direct environment in map to update", { id });
        }
      }
    }
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
      logger.error(msg, e);
      Sentry.captureException(e);
      vscode.window.showErrorMessage(msg, "Open Logs", "File Issue").then(async (action) => {
        if (action === "Open Logs") {
          vscode.commands.executeCommand("confluent.showOutputChannel");
        } else if (action === "File Issue") {
          vscode.commands.executeCommand("confluent.support.issue");
        }
      });
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
  if (localEnvs.length > 0) {
    const connectedId = "local-container-connected";
    // enable the "Stop Local Resources" action
    localContainerItem.contextValue = connectedId;
    // unpack the local resources to more easily update the UI elements
    const localKafkaClusters: LocalKafkaCluster[] = [];
    const localSchemaRegistries: LocalSchemaRegistry[] = [];
    localEnvs.forEach((env: LocalEnvironment) => {
      localKafkaClusters.push(...env.kafkaClusters);
      if (env.schemaRegistry) {
        localSchemaRegistries.push(env.schemaRegistry);
      }
    });
    // update the UI based on whether or not we have local resources available
    await Promise.all([
      setContextValue(ContextValues.localKafkaClusterAvailable, localEnvs.length > 0),
      setContextValue(ContextValues.localSchemaRegistryAvailable, localSchemaRegistries.length > 0),
    ]);
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

  return localContainerItem;
}

export async function loadDirectResources(): Promise<DirectEnvironment[]> {
  // fetch all direct connections and their resources; each connection will be treated the same as a
  // CCloud environment (connection ID and environment ID are the same)
  const directEnvs = await getDirectResources();
  logger.debug(`got ${directEnvs.length} direct environment(s) from GQL query`);
  return directEnvs;
}

/**
 * Return the children of a CCloud environment (the Kafka clusters and Schema Registry).
 * Called when expanding a CCloud environment tree item.
 *
 * Fetches from the cached resources in the resource manager.
 *
 * @param environment: The CCloud environment to get children for
 * @returns
 */
async function getCCloudEnvironmentChildren(environment: CCloudEnvironment) {
  const subItems: (CCloudKafkaCluster | CCloudSchemaRegistry)[] = [];

  const loader = CCloudResourceLoader.getInstance();

  // Get the Kafka clusters for this environment. At worst be an empty array.
  subItems.push(...(await loader.getKafkaClustersForEnvironmentId(environment.id)));

  // Schema registry?
  const schemaRegistry = await loader.getSchemaRegistryForEnvironmentId(environment.id);
  if (schemaRegistry) {
    subItems.push(schemaRegistry);
  }

  // TODO: add flink compute pools here ?
  return subItems;
}
