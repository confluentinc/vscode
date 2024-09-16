import * as vscode from "vscode";
import { IconNames } from "../constants";
import { getExtensionContext } from "../context";
import { ccloudConnected, ccloudOrganizationChanged } from "../emitters";
import { ExtensionContextNotSetError } from "../errors";
import {
  CCloudEnvironmentGroup,
  getClustersByCCloudEnvironment,
  getEnvironments,
} from "../graphql/environments";
import { getLocalKafkaClusters } from "../graphql/local";
import { getCurrentOrganization } from "../graphql/organizations";
import { CCloudEnvironment, CCloudEnvironmentTreeItem } from "../models/environment";
import {
  CCloudKafkaCluster,
  KafkaClusterTreeItem,
  LocalKafkaCluster,
} from "../models/kafkaCluster";
import { ContainerTreeItem } from "../models/main";
import { Schema } from "../models/schema";
import { SchemaRegistryCluster, SchemaRegistryClusterTreeItem } from "../models/schemaRegistry";
import { getCCloudConnection } from "../sidecar/connections";
import { getResourceManager } from "../storage/resourceManager";
import { getSchemas } from "./schemas";

const CONFLUENT_ICON = new vscode.ThemeIcon(IconNames.CONFLUENT_LOGO);

/**
 * The types managed by the {@link ResourceViewProvider}, which are converted to their appropriate tree item
 * type via the `getTreeItem()` method.
 */
type ResourceViewProviderData =
  | ContainerTreeItem<CCloudEnvironment>
  | CCloudEnvironment
  | CCloudKafkaCluster
  | SchemaRegistryCluster
  | ContainerTreeItem<LocalKafkaCluster>
  | LocalKafkaCluster;

export class ResourceViewProvider implements vscode.TreeDataProvider<ResourceViewProviderData> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    ResourceViewProviderData | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  private treeView: vscode.TreeView<vscode.TreeItem>;
  /** The {@link CCloudEnvironment} and any associated clusters available from this view provider. */
  public ccloudEnvGroups: CCloudEnvironmentGroup[] = [];

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
      this.refresh();
      // toggle Topics/Schemas views' visibility based on connection status
      vscode.commands.executeCommand(
        "setContext",
        "confluent.ccloudConnectionAvailable",
        connected,
      );
    });
    ccloudOrganizationChanged.event(() => {
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
    } else if (element instanceof SchemaRegistryCluster) {
      return new SchemaRegistryClusterTreeItem(element);
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
        return await loadCCloudEnvironmentChildren(element);
      }
    } else {
      // --- ROOT-LEVEL ITEMS ---
      // NOTE: we end up here when the tree is first loaded
      return await loadResources();
    }

    return resourceItems;
  }
}

/** Get the singleton instance of the {@link ResourceViewProvider} */
export function getResourceViewProvider() {
  return ResourceViewProvider.getInstance();
}

async function loadResources(): Promise<ResourceViewProviderData[]> {
  const resources: ResourceViewProviderData[] = [];

  // the section below will create a "Confluent Cloud" container item that will be either:
  // - an unexpandable item with a "No connection" description where the user can connect to CCloud
  // - a "connected" expandable item with a description of the current connection name and the ability
  //   to add a new connection or switch connections
  if (await getCCloudConnection()) {
    const ccloudEnvironments: CCloudEnvironment[] = await preloadEnvironmentResources();
    const cloudContainerItem = new ContainerTreeItem<CCloudEnvironment>(
      "Confluent Cloud",
      vscode.TreeItemCollapsibleState.Expanded,
      ccloudEnvironments,
    );
    cloudContainerItem.id = "ccloud-container-connected";
    // removes the "Add Connection" action on hover and enables the "Change Organization" action
    cloudContainerItem.contextValue = "resources-ccloud-container-connected";
    const currentOrg = await getCurrentOrganization();
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
 * Preload the {@link CCloudEnvironment}s and their children (Kafka clusters, Schema Registry) into
 * the extension state for general use.
 * @remarks this is called after a successful connection to Confluent Cloud, and is done in order to
 * avoid having to fetch each environment's resources on-demand and speed up topic/schema browsing.
 */
async function preloadEnvironmentResources(): Promise<CCloudEnvironment[]> {
  const envGroups = await getEnvironments();
  // also attach it to the tree view provider for later use
  getResourceViewProvider().ccloudEnvGroups = envGroups;

  const resourceManager = getResourceManager();
  const environments = envGroups.map((envGroup) => envGroup.environment);
  resourceManager.setCCloudEnvironments(environments);

  const kafkaClusters = envGroups.flatMap((envGroup) => envGroup.kafkaClusters);
  resourceManager.setCCloudKafkaClusters(kafkaClusters);

  const promises: Promise<Schema[] | void>[] = [];
  for (const envGroup of envGroups) {
    const schemaRegistry = envGroup.schemaRegistry;
    if (schemaRegistry !== undefined) {
      await resourceManager.setCCloudSchemaRegistryCluster(schemaRegistry);
      promises.push(getSchemas(envGroup.environment, schemaRegistry.id));
    }
  }
  await Promise.all(promises);

  // TODO: add flink compute pools here

  return environments;
}

async function loadCCloudEnvironmentChildren(environment: CCloudEnvironment) {
  const subItems: (CCloudKafkaCluster | SchemaRegistryCluster)[] = [];

  // load Kafka clusters and Schema Registry for the given environment, if they exist
  const envGroup: CCloudEnvironmentGroup | null = await getClustersByCCloudEnvironment(environment);
  if (!envGroup) {
    return subItems;
  }

  subItems.push(...envGroup.kafkaClusters);
  if (envGroup.schemaRegistry) {
    subItems.push(envGroup.schemaRegistry);
  }

  // TODO: add flink compute pools here

  return subItems;
}
