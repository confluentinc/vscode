import * as Sentry from "@sentry/node";
import * as vscode from "vscode";
import { IconNames } from "../constants";
import { ContextValues, getExtensionContext, setContextValue } from "../context";
import {
  ccloudConnected,
  ccloudOrganizationChanged,
  localKafkaConnected,
  localSchemaRegistryConnected,
} from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { getLocalResources, LocalResourceGroup } from "../graphql/local";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import { CCloudEnvironment, CCloudEnvironmentTreeItem } from "../models/environment";
import {
  CCloudKafkaCluster,
  KafkaClusterTreeItem,
  LocalKafkaCluster,
} from "../models/kafkaCluster";
import { ContainerTreeItem } from "../models/main";
import {
  CCloudSchemaRegistry,
  LocalSchemaRegistry,
  SchemaRegistryTreeItem,
} from "../models/schemaRegistry";
import { hasCCloudAuthSession, updateLocalConnection } from "../sidecar/connections";
import { ResourceLoader } from "../storage/resourceLoader";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("viewProviders.resources");

/**
 * The types managed by the {@link ResourceViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type ResourceViewProviderData =
  | ContainerTreeItem<CCloudEnvironment>
  | CCloudEnvironment
  | CCloudKafkaCluster
  | CCloudSchemaRegistry
  | ContainerTreeItem<LocalKafkaCluster | LocalSchemaRegistry>
  | LocalKafkaCluster
  | LocalSchemaRegistry;

export class ResourceViewProvider implements vscode.TreeDataProvider<ResourceViewProviderData> {
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

    ccloudConnected.event((connected: boolean) => {
      logger.debug("ccloudConnected event fired", { connected });
      // No need to force a deep refresh when the connection status changes because the
      // preloader will have already begun loading resources due to also observing this event.
      this.refresh();
    });

    ccloudOrganizationChanged.event(() => {
      // Force a deep refresh of ccloud resources when the organization changes.
      this.refresh(true);
    });

    localKafkaConnected.event((connected: boolean) => {
      logger.debug("localKafkaConnected event fired", { connected });
      this.refresh();
    });
    localSchemaRegistryConnected.event((connected: boolean) => {
      logger.debug("localSchemaRegistryConnected event fired", { connected });
      this.refresh();
    });
  }

  static getInstance(): ResourceViewProvider {
    if (!ResourceViewProvider.instance) {
      ResourceViewProvider.instance = new ResourceViewProvider();
    }
    return ResourceViewProvider.instance;
  }

  getTreeItem(element: ResourceViewProviderData): vscode.TreeItem {
    if (element instanceof CCloudEnvironment) {
      return new CCloudEnvironmentTreeItem(element);
    } else if (element instanceof LocalKafkaCluster || element instanceof CCloudKafkaCluster) {
      return new KafkaClusterTreeItem(element);
    } else if (element instanceof LocalSchemaRegistry || element instanceof CCloudSchemaRegistry) {
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
      const resources: ResourceViewProviderData[] = await Promise.all([
        loadCCloudResources(this.forceDeepRefresh),
        loadLocalResources(),
      ]);
      if (this.forceDeepRefresh) {
        // Clear this, we've just fulfilled its intent.
        this.forceDeepRefresh = false;
      }
      return resources;
    }

    return resourceItems;
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
    const preloader = ResourceLoader.getInstance();
    // TODO: have this cached in the resource manager via the preloader
    const currentOrg = await getCurrentOrganization();

    let ccloudEnvironments: CCloudEnvironment[] = [];
    try {
      // Ensure all of the preloading is complete before referencing resource manager CCloud resources.
      await preloader.ensureCoarseResourcesLoaded(forceDeepRefresh);
      const resourceManager = getResourceManager();
      ccloudEnvironments = await resourceManager.getCCloudEnvironments();
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
    cloudContainerItem.id = "ccloud-container-connected";
    // removes the "Add Connection" action on hover and enables the "Change Organization" action
    cloudContainerItem.contextValue = "resources-ccloud-container-connected";
    cloudContainerItem.description = currentOrg?.name ?? "";
    cloudContainerItem.children = ccloudEnvironments;
  } else {
    // XXX: if we don't adjust the ID here, we'll see weird collapsibleState behavior
    cloudContainerItem.id = "ccloud-container";
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
  localContainerItem.id = notConnectedId;
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
    localContainerItem.id = connectedId;
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
    // TODO: this should be handled in the preloader once it (and ResourceManager) start handling
    // local resources
    getResourceManager().setLocalKafkaClusters(localKafkaClusters);
    localContainerItem.children = [...localKafkaClusters, ...localSchemaRegistries];
  }

  return localContainerItem;
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

  // Ensure all of the preloading is complete before referencing resource manager ccloud resources.
  await ResourceLoader.getInstance().ensureCoarseResourcesLoaded();

  const rm = getResourceManager();
  // Get the Kafka clusters for this environment. Will at worst be an empty array.
  const kafkaClusters = await rm.getCCloudKafkaClustersForEnvironment(environment.id);
  subItems.push(...kafkaClusters);

  // Schema registry?
  const schemaRegistry: CCloudSchemaRegistry | null = await rm.getCCloudSchemaRegistry(
    environment.id,
  );
  if (schemaRegistry) {
    subItems.push(schemaRegistry);
  }

  // TODO: add flink compute pools here ?
  return subItems;
}
