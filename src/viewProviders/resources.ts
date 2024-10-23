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

const CONFLUENT_ICON = new vscode.ThemeIcon(IconNames.CONFLUENT_LOGO);

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
      const toplevelItems = await loadResources(this.forceDeepRefresh);
      if (this.forceDeepRefresh) {
        // Clear this, we've just fulfilled its intent.
        this.forceDeepRefresh = false;
      }
      return toplevelItems;
    }

    return resourceItems;
  }
}

/** Get the singleton instance of the {@link ResourceViewProvider} */
export function getResourceViewProvider() {
  return ResourceViewProvider.getInstance();
}

async function loadResources(
  forceDeepRefresh: boolean = false,
): Promise<ResourceViewProviderData[]> {
  const resources: ResourceViewProviderData[] = [];

  // the section below will create a "Confluent Cloud" container item that will be either:
  // - an unexpandable item with a "No connection" description where the user can connect to CCloud
  // - a "connected" expandable item with a description of the current connection name and the ability
  //   to add a new connection or switch connections
  if (hasCCloudAuthSession()) {
    const preloader = CCloudResourcePreloader.getInstance();
    // TODO: have this cached in the resource manager  via the preloader
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

    const collapsibleState =
      ccloudEnvironments.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None;
    const cloudContainerItem = new ContainerTreeItem<CCloudEnvironment>(
      "Confluent Cloud",
      collapsibleState,
      ccloudEnvironments,
    );
    cloudContainerItem.id = "ccloud-container-connected";
    // removes the "Add Connection" action on hover and enables the "Change Organization" action
    cloudContainerItem.contextValue = "resources-ccloud-container-connected";
    cloudContainerItem.description = currentOrg?.name ?? "";
    cloudContainerItem.iconPath = CONFLUENT_ICON;
    resources.push(cloudContainerItem);
  } else {
    // the user doesn't have a current CCloud connection, just show the placeholder with action to connect
    const emptyCloudContainerItem = new ContainerTreeItem(
      "Confluent Cloud",
      vscode.TreeItemCollapsibleState.None,
      [],
    );
    emptyCloudContainerItem.id = "ccloud-container";
    // enables the "Add Connection" action to be displayed on hover
    emptyCloudContainerItem.contextValue = "resources-ccloud-container";
    emptyCloudContainerItem.description = "(No connection)";
    emptyCloudContainerItem.iconPath = CONFLUENT_ICON;
    resources.push(emptyCloudContainerItem);
  }

  // also load local Kafka clusters for display alongside CCloud environments
  const localClusters: LocalKafkaCluster[] = await getLocalKafkaClusters();
  if (localClusters.length > 0) {
    const localContainerItem = new ContainerTreeItem(
      "Local",
      vscode.TreeItemCollapsibleState.Expanded,
      localClusters,
    );
    // override the default "child item count" description
    localContainerItem.description = localClusters.map((cluster) => cluster.uri).join(", ");
    resources.push(localContainerItem);

    // store the local clusters in the resource manager for later use
    // (XXX somewhat asymetric with when CCloud environments get cached,
    ///  which get stored in the resource manager within the preloadEnvironmentResources() call above)
    getResourceManager().setLocalKafkaClusters(localClusters);
  }

  return resources;
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
