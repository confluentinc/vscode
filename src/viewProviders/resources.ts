import * as Sentry from "@sentry/node";
import * as vscode from "vscode";
import { IconNames } from "../constants";
import { getExtensionContext } from "../context";
import { ccloudConnected, ccloudOrganizationChanged, localKafkaConnected } from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import { getLocalKafkaClusters } from "../graphql/local";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import { CCloudEnvironment, CCloudEnvironmentTreeItem } from "../models/environment";
import {
  CCloudKafkaCluster,
  KafkaClusterTreeItem,
  LocalKafkaCluster,
} from "../models/kafkaCluster";
import { ContainerTreeItem } from "../models/main";
import { CCloudSchemaRegistry, SchemaRegistryTreeItem } from "../models/schemaRegistry";
import { hasCCloudAuthSession } from "../sidecar/connections";
import { CCloudResourcePreloader } from "../storage/ccloudPreloader";
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
  | ContainerTreeItem<LocalKafkaCluster>
  | LocalKafkaCluster;

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
    } else if (element instanceof CCloudSchemaRegistry) {
      // TODO(shoup): update ^ for local SR once available
      return new SchemaRegistryTreeItem(element);
    }
    // should only be left with ContainerTreeItems for Configurations
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
 * Otherwise, the container will be collapsed and show a "No connection" message with an action to
 * connect to CCloud.
 */
async function loadCCloudResources(
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
    const preloader = CCloudResourcePreloader.getInstance();
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
async function loadLocalResources(): Promise<ContainerTreeItem<LocalKafkaCluster>> {
  const localContainerItem = new ContainerTreeItem<LocalKafkaCluster>(
    "Local",
    vscode.TreeItemCollapsibleState.None,
    [],
  );
  localContainerItem.iconPath = new vscode.ThemeIcon(IconNames.LOCAL_RESOURCE_GROUP);
  localContainerItem.description = "";
  localContainerItem.tooltip = new vscode.MarkdownString(
    "Local Kafka clusters discoverable at port `8082` are shown here.",
  );

  const localClusters: LocalKafkaCluster[] = await getLocalKafkaClusters();
  if (localClusters.length > 0) {
    // override the default "child item count" description
    localContainerItem.description = localClusters.map((cluster) => cluster.uri).join(", ");
    // TODO: this should be handled in the preloader once it (and ResourceManager) start handling
    // local resources
    getResourceManager().setLocalKafkaClusters(localClusters);
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
  await CCloudResourcePreloader.getInstance().ensureCoarseResourcesLoaded();

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
