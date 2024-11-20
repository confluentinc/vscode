import * as Sentry from "@sentry/node";
import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { IconNames } from "../constants";
import { getExtensionContext } from "../context/extension";
import { ContextValues, setContextValue } from "../context/values";
import {
  ccloudConnected,
  ccloudOrganizationChanged,
  localKafkaConnected,
  localSchemaRegistryConnected,
} from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { getDirectResources } from "../graphql/direct";
import { getLocalResources, LocalResourceGroup } from "../graphql/local";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import { CCloudEnvironment, DirectEnvironment, EnvironmentTreeItem } from "../models/environment";
import {
  CCloudKafkaCluster,
  DirectKafkaCluster,
  KafkaClusterTreeItem,
  LocalKafkaCluster,
} from "../models/kafkaCluster";
import { ContainerTreeItem } from "../models/main";
import {
  CCloudSchemaRegistry,
  DirectSchemaRegistry,
  LocalSchemaRegistry,
  SchemaRegistryTreeItem,
} from "../models/schemaRegistry";
import { ENABLE_DIRECT_CONNECTIONS } from "../preferences/constants";
import { hasCCloudAuthSession, updateLocalConnection } from "../sidecar/connections";
import { CCloudResourceLoader } from "../storage/ccloudResourceLoader";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("viewProviders.resources");

type CCloudResources = CCloudEnvironment | CCloudKafkaCluster | CCloudSchemaRegistry;
// TODO: add LocalEnvironment here?
type LocalResources = LocalKafkaCluster | LocalSchemaRegistry;
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
  | ContainerTreeItem<DirectEnvironment>
  | DirectResources;

export class ResourceViewProvider implements vscode.TreeDataProvider<ResourceViewProviderData> {
  /** Disposables belonging to this provider to be added to the extension context during activation,
   * cleaned up on extension deactivation. */
  disposables: vscode.Disposable[] = [];

  private _onDidChangeTreeData = new vscode.EventEmitter<
    ResourceViewProviderData | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Did the user use the 'refresh' button / command to force a deep refresh of the tree?
  private forceDeepRefresh: boolean = false;

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
    if (element instanceof CCloudEnvironment || element instanceof DirectEnvironment) {
      return new EnvironmentTreeItem(element);
    } else if (
      element instanceof LocalKafkaCluster ||
      element instanceof CCloudKafkaCluster ||
      element instanceof DirectKafkaCluster
    ) {
      return new KafkaClusterTreeItem(element);
    } else if (
      element instanceof LocalSchemaRegistry ||
      element instanceof CCloudSchemaRegistry ||
      element instanceof DirectSchemaRegistry
    ) {
      return new SchemaRegistryTreeItem(element);
    }
    // should only be left with ContainerTreeItems
    return element;
  }

  async getChildren(element?: ResourceViewProviderData): Promise<ResourceViewProviderData[]> {
    const resourceItems: ResourceViewProviderData[] = [];

    if (element) {
      // --- CHILDREN OF TREE BRANCHES ---
      // NOTE: we end up here when expanding a (collapsed) treeItem
      if (element instanceof ContainerTreeItem) {
        // expand containers for kafka clusters, schema registry, flink compute pools, etc
        return element.children;
      } else if (element instanceof CCloudEnvironment) {
        return await getCCloudEnvironmentChildren(element);
      }
    } else {
      // --- ROOT-LEVEL ITEMS ---
      // NOTE: we end up here when the tree is first loaded
      const resources: ResourceViewProviderData[] = [];

      // EXPERIMENTAL: check if direct connections are enabled in extension settings
      const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration();
      const directConnectionsEnabled: boolean = config.get(ENABLE_DIRECT_CONNECTIONS, false);
      if (directConnectionsEnabled) {
        resources.push(
          ...(await Promise.all([
            loadCCloudResources(this.forceDeepRefresh),
            loadLocalResources(),
            loadDirectConnectResources(),
          ])),
        );
      } else {
        resources.push(
          ...(await Promise.all([
            loadCCloudResources(this.forceDeepRefresh),
            loadLocalResources(),
          ])),
        );
      }

      if (this.forceDeepRefresh) {
        // Clear this, we've just fulfilled its intent.
        this.forceDeepRefresh = false;
      }
      return resources;
    }

    return resourceItems;
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

    return [
      ccloudConnectedSub,
      ccloudOrganizationChangedSub,
      localKafkaConnectedSub,
      localSchemaRegistryConnectedSub,
    ];
  }
}

/** Get the singleton instance of the {@link ResourceViewProvider} */
export function getResourceViewProvider() {
  return ResourceViewProvider.getInstance();
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
    "Confluent Cloud",
    vscode.TreeItemCollapsibleState.None,
    [],
  );
  cloudContainerItem.iconPath = new vscode.ThemeIcon(IconNames.CONFLUENT_LOGO);

  if (hasCCloudAuthSession()) {
    const loader = CCloudResourceLoader.getInstance();
    // TODO: have this cached in the resource manager via the loader
    const currentOrg = await getCurrentOrganization();

    const ccloudEnvironments: CCloudEnvironment[] = [];
    try {
      ccloudEnvironments.push(...(await loader.getEnvironments(forceDeepRefresh)));
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
    // XXX: if we don't adjust the ID here, we'll see weird collapsibleState behavior
    cloudContainerItem.id = randomUUID();
    // removes the "Add Connection" action on hover and enables the "Change Organization" action
    cloudContainerItem.contextValue = "resources-ccloud-container-connected";
    cloudContainerItem.description = currentOrg?.name ?? "";
    cloudContainerItem.children = ccloudEnvironments;
  } else {
    // XXX: if we don't adjust the ID here, we'll see weird collapsibleState behavior
    cloudContainerItem.id = randomUUID();
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
    "Local",
    vscode.TreeItemCollapsibleState.None,
    [],
  );
  localContainerItem.iconPath = new vscode.ThemeIcon(IconNames.LOCAL_RESOURCE_GROUP);

  const notConnectedId = "local-container";
  // XXX: if we don't adjust the ID, we'll see weird collapsibleState behavior
  localContainerItem.id = randomUUID();
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

  const localResources: LocalResourceGroup[] = await getLocalResources();
  if (localResources.length > 0) {
    const connectedId = "local-container-connected";
    // XXX: if we don't adjust the ID, we'll see weird collapsibleState behavior
    localContainerItem.id = randomUUID();
    // enable the "Stop Local Resources" action
    localContainerItem.contextValue = connectedId;
    // unpack the local resources to more easily update the UI elements
    const localKafkaClusters: LocalKafkaCluster[] = [];
    const localSchemaRegistries: LocalSchemaRegistry[] = [];
    localResources.forEach((group) => {
      localKafkaClusters.push(...group.kafkaClusters);
      if (group.schemaRegistry) {
        localSchemaRegistries.push(group.schemaRegistry);
      }
    });
    // update the UI based on whether or not we have local resources available
    await Promise.all([
      setContextValue(ContextValues.localKafkaClusterAvailable, localResources.length > 0),
      setContextValue(ContextValues.localSchemaRegistryAvailable, localSchemaRegistries.length > 0),
    ]);
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

export async function loadDirectConnectResources(): Promise<ContainerTreeItem<DirectEnvironment>> {
  const directContainerItem = new ContainerTreeItem<DirectEnvironment>(
    "Other",
    vscode.TreeItemCollapsibleState.None,
    [],
  );
  directContainerItem.iconPath = new vscode.ThemeIcon(IconNames.CONNECTION);

  // XXX: if we don't adjust the ID, we'll see weird collapsibleState behavior
  directContainerItem.id = randomUUID();

  // top-level container before each direct "environment" (connection)
  directContainerItem.contextValue = "resources-direct-container";
  directContainerItem.description = "(No connections)";

  // fetch all direct connections and their resources; each connection will be treated the same as a
  // CCloud environment (connection ID and environment ID are the same)
  directContainerItem.children = await getDirectResources();
  if (directContainerItem.children.length > 0) {
    directContainerItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
  }

  return directContainerItem;
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
