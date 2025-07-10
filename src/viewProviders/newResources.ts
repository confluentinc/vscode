import {
  Disposable,
  MarkdownString,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
} from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import {
  ccloudConnected,
  directConnectionsChanged,
  localKafkaConnected,
  localSchemaRegistryConnected,
} from "../emitters";
import { logError } from "../errors";
import {
  CCloudResourceLoader,
  DirectResourceLoader,
  LocalResourceLoader,
  ResourceLoader,
} from "../loaders";
import { Logger } from "../logging";
import {
  CCloudEnvironment,
  createEnvironmentTooltip,
  DirectEnvironment,
  Environment,
  EnvironmentTreeItem,
  LocalEnvironment,
} from "../models/environment";
import { CCloudFlinkComputePool, FlinkComputePoolTreeItem } from "../models/flinkComputePool";
import {
  CCloudKafkaCluster,
  DirectKafkaCluster,
  KafkaCluster,
  KafkaClusterTreeItem,
  LocalKafkaCluster,
} from "../models/kafkaCluster";
import { IdItem } from "../models/main";
import { CCloudOrganization } from "../models/organization";
import {
  ConnectionId,
  connectionIdToType,
  EnvironmentId,
  IResourceBase,
  ISearchable,
  IUpdatableResource,
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
import { BaseViewProvider } from "./base";

type ConcreteEnvironment = CCloudEnvironment | LocalEnvironment | DirectEnvironment;
type ConcreteKafkaCluster = CCloudKafkaCluster | LocalKafkaCluster | DirectKafkaCluster;
type ConcreteSchemaRegistry = CCloudSchemaRegistry | LocalSchemaRegistry | DirectSchemaRegistry;

type ConnectionRowChildren =
  | ConcreteEnvironment
  | ConcreteKafkaCluster
  | ConcreteSchemaRegistry
  | CCloudFlinkComputePool;

export abstract class ConnectionRow<ET extends ConcreteEnvironment, LT extends ResourceLoader>
  implements IResourceBase, IdItem, ISearchable
{
  logger: Logger;
  ordering: number = -1; // Will be reset when the connection is stored.
  readonly environments: ET[];

  constructor(
    public readonly loader: LT,
    public baseContextValue: string,
  ) {
    this.environments = [];
    this.logger = new Logger(`viewProviders.newResources.ConnectionRow.${this.connectionId}`);
  }

  async refresh(deepRefresh: boolean = false): Promise<void> {
    this.logger.debug("Refreshing", { deepRefresh });

    const refreshedEnvironments: ET[] = (await this.loader.getEnvironments(deepRefresh)) as ET[];
    this.logger.debug("Loaded updated environments", {
      environments: refreshedEnvironments.length,
    });

    // In-place merge of updated environments to the existing environments array, keeping
    // object
    mergeUpdates(this.environments, refreshedEnvironments);

    this.logger.debug("Refreshed cache of environments", {
      environments: this.environments.length,
    });
  }

  abstract get name(): string;

  abstract get tooltip(): string | MarkdownString;

  searchableText(): string {
    return this.name;
  }

  clearEnvironments(): void {
    this.environments.length = 0;
  }

  getEnvironment(environmentId: EnvironmentId): ET | undefined {
    return this.environments.find((env) => env.id === environmentId);
  }

  get connectionId(): ConnectionId {
    return this.loader.connectionId;
  }

  abstract get status(): string;
  abstract get iconPath(): ThemeIcon;

  get id(): ConnectionId {
    return this.connectionId;
  }

  get connectionType(): ConnectionType {
    return connectionIdToType(this.connectionId);
  }

  get connected(): boolean {
    return this.environments.length > 0;
  }

  /** Convert this ConnectionRow into a TreeItem. */
  getTreeItem(): TreeItem {
    const item = new TreeItem(this.name);

    item.collapsibleState = this.connected
      ? TreeItemCollapsibleState.Expanded
      : TreeItemCollapsibleState.None;

    const connectedTrailer = this.connected ? "-connected" : "";
    item.contextValue = this.baseContextValue + connectedTrailer;
    // The id must change based on the connection state, so that the tree view will
    // honor auto-expanded state when we have children. Ugh.
    item.id = this.connectionId + connectedTrailer;

    item.iconPath = this.iconPath;
    item.description = this.status;
    item.tooltip = this.tooltip;

    return item;
  }

  abstract getChildren(): ConnectionRowChildren[];
}

export abstract class SingleEnvironmentConnectionRow<
  ET extends ConcreteEnvironment,
  KCT extends LocalKafkaCluster | DirectKafkaCluster,
  SRT extends LocalSchemaRegistry | DirectSchemaRegistry,
  LT extends ResourceLoader = LocalResourceLoader | DirectResourceLoader,
> extends ConnectionRow<ET, LT> {
  /** Get my single environment (if loaded), otherwise undefined. */
  get environment(): ET | undefined {
    if (this.environments.length === 0) {
      return undefined;
    }
    return this.environments[0];
  }

  get kafkaCluster(): KCT | undefined {
    if (this.environments.length === 0) {
      return undefined;
    }
    return this.environments[0].kafkaClusters?.[0] as KCT | undefined;
  }

  get schemaRegistry(): SRT | undefined {
    if (this.environments.length === 0) {
      return undefined;
    }
    return this.environments[0].schemaRegistry as SRT | undefined;
  }

  override async refresh(deepRefresh: boolean = false): Promise<void> {
    await super.refresh(deepRefresh);
    if (this.environments.length > 0) {
      this.logger.debug("SingleEnvironmentConnectionRow children", {
        kafkaCluster: this.kafkaCluster,
        schemaRegistry: this.schemaRegistry,
      });
    }
  }

  getChildren(): (KCT | SRT)[] {
    this.logger.debug(
      "SingleEnvironmentConnectionRow getting children for single environment connection row",
      {
        environments: this.environments.length,
      },
    );

    if (this.environments.length === 0) {
      return [];
    }

    const environment = this.environments[0];

    const children: (KCT | SRT)[] = [];

    if (environment.kafkaClusters) {
      this.logger.debug("Adding Kafka clusters to children", {
        kafkaClusters: environment.kafkaClusters.length,
      });
      children.push(...(environment.kafkaClusters as KCT[]));
    }
    if (environment.schemaRegistry) {
      this.logger.debug("Adding Schema Registry to children");
      children.push(environment.schemaRegistry as SRT);
    }

    this.logger.debug("Returning children", {
      children: children.length,
    });

    return children;
  }
}

// Now the concrete connection row classes.

export class CCloudConnectionRow extends ConnectionRow<CCloudEnvironment, CCloudResourceLoader> {
  ccloudOrganization?: CCloudOrganization;
  constructor() {
    super(CCloudResourceLoader.getInstance(), "resources-ccloud-container");
  }

  get name(): string {
    return "Confluent Cloud";
  }

  get iconPath(): ThemeIcon {
    return new ThemeIcon(IconNames.CONFLUENT_LOGO);
  }

  /**
   * Refresh the ccloud connection row. Handles the organization aspect
   * here, defers to super().refresh() to handle environments.
   */
  override async refresh(deepRefresh: boolean = false): Promise<void> {
    // Also get the current organization from the loader.
    this.logger.debug("Refreshing CCloudConnectionRow", { deepRefresh });

    if (hasCCloudAuthSession()) {
      try {
        // Load organization and the environments concurrently.
        const results = await Promise.all([
          this.loader.getOrganization(),
          super.refresh(deepRefresh), // handles environments.
        ]);
        this.ccloudOrganization = results[0] as CCloudOrganization;
      } catch (e) {
        const msg = `Failed to load Confluent Cloud information for the "${this.ccloudOrganization?.name}" organization.`;
        logError(e, "loading CCloud environments or organization", {
          extra: { functionName: "loadCCloudResources" },
        });
        showErrorNotificationWithButtons(msg);
        this.ccloudOrganization = undefined;
      }
    } else {
      this.logger.debug("No CCloud auth session, skipping organization refresh");
      this.ccloudOrganization = undefined;
    }
  }

  get status(): string {
    return this.connected ? this.ccloudOrganization!.name : "(No connection)";
  }

  get tooltip(): string {
    return "Confluent Cloud";
  }

  getChildren(): CCloudEnvironment[] {
    this.logger.debug("CCloudConnectionRow getting children", {
      environments: this.environments.length,
    });

    return this.environments;
  }
}

export class DirectConnectionRow extends SingleEnvironmentConnectionRow<
  DirectEnvironment,
  DirectKafkaCluster,
  DirectSchemaRegistry,
  DirectResourceLoader
> {
  constructor(loader: DirectResourceLoader) {
    super(loader, "resources-direct-container");
  }

  get iconPath(): ThemeIcon {
    if (this.environment) {
      return new ThemeIcon(this.environment.iconName);
    } else {
      throw new Error("DirectConnectionRow: Environment not yet loaded; cannot get icon path.");
    }
  }

  get name(): string {
    if (this.environment) {
      return this.environment.name;
    } else {
      throw new Error("DirectConnectionRow: Environment not yet loaded; cannot get name.");
    }
  }

  get status(): string {
    return "";
  }

  get tooltip(): MarkdownString {
    if (this.environment) {
      return createEnvironmentTooltip(this.environment);
    } else {
      throw new Error("DirectConnectionRow: Environment not yet loaded; cannot get tooltip.");
    }
  }
}

export class LocalConnectionRow extends SingleEnvironmentConnectionRow<
  LocalEnvironment,
  LocalKafkaCluster,
  LocalSchemaRegistry,
  LocalResourceLoader
> {
  /** Is this the first time refresh() is called,  */
  private needUpdateLocalConnection = true;

  constructor() {
    super(LocalResourceLoader.getInstance(), "local-container");
  }

  get name(): string {
    return "Local";
  }

  get iconPath(): ThemeIcon {
    return new ThemeIcon(IconNames.LOCAL_RESOURCE_GROUP);
  }

  get tooltip(): MarkdownString {
    return new MarkdownString("Local Kafka clusters discoverable at port `8082` are shown here.");
  }

  override async refresh(deepRefresh: boolean = false): Promise<void> {
    this.logger.debug("Refreshing LocalConnectionRow", { deepRefresh });

    if (this.needUpdateLocalConnection) {
      this.logger.debug(
        "Trying to discover local schema registry before loading the local environent.",
      );
      await updateLocalConnection();
      this.needUpdateLocalConnection = false;

      // Now clear to call the loader method to GraphQL query the local environment.
      // in the super.refresh() method.
    }

    await super.refresh(deepRefresh);

    // If we have no environments, we are not connected.
    if (this.environments.length === 0) {
      this.logger.debug("No local environments found, not connected.");
    } else {
      this.logger.debug("Local environments refreshed", {
        environments: this.environments.length,
      });
    }
  }

  get status(): string {
    return this.connected ? this.kafkaCluster!.uri! : "(Not Running)";
  }
}

type NewResourceViewProviderData =
  | ConnectionRow<ConcreteEnvironment, ResourceLoader>
  | ConcreteEnvironment
  | ConcreteKafkaCluster
  | ConcreteSchemaRegistry
  | CCloudFlinkComputePool;

export type AnyConnectionRow = ConnectionRow<ConcreteEnvironment, ResourceLoader>;

export class NewResourceViewProvider
  extends BaseViewProvider<NewResourceViewProviderData>
  implements TreeDataProvider<NewResourceViewProviderData>
{
  readonly kind = "new-resources";
  readonly viewId = "new-confluent-resources";
  readonly loggerName = "viewProviders.newResources";

  private readonly connections: Map<ConnectionId, AnyConnectionRow> = new Map();
  private connectionIndex: number = 0;

  constructor() {
    super();
  }

  public async refreshConnection(
    connectionId: ConnectionId,
    deepRefresh: boolean = false,
  ): Promise<void> {
    this.logger.debug("Refreshing connection", { connectionId, deepRefresh });

    const connectionRow = this.connections.get(connectionId);
    if (!connectionRow) {
      this.logger.warn("No connection row found for connectionId", { connectionId });
      return;
    }

    await connectionRow.refresh(deepRefresh);
    this.logger.debug("Connection row refreshed, signaling row repaint.");
    this.repaint(connectionRow);
  }

  protected setCustomEventListeners(): Disposable[] {
    this.logger.debug("Setting up custom event listeners");

    // CCloud connection observer driving auto-refreshes of the CCloud connection
    // upon ccloud connection state changes.
    const ccloudConnectedSub: Disposable = ccloudConnected.event((connected: boolean) => {
      this.logger.debug("ccloudConnected event fired", { connected });
      void this.refreshConnection(CCLOUD_CONNECTION_ID, true);
    });

    // Local connection needs two different observers, one for local Kafka and one for local Schema Registry.
    const localKafkaConnectedSub: Disposable = localKafkaConnected.event((connected: boolean) => {
      this.logger.debug("localKafkaConnected event fired", { connected });
      void this.refreshConnection(LOCAL_CONNECTION_ID, true);
    });
    const localSchemaRegistryConnectedSub: Disposable = localSchemaRegistryConnected.event(
      (connected: boolean) => {
        this.logger.debug("localSchemaRegistryConnected event fired", { connected });
        void this.refreshConnection(LOCAL_CONNECTION_ID, true);
      },
    );

    // Watch for direct connections changing, call into our handler.
    const directConnectionsChangedSub: Disposable = directConnectionsChanged.event(() => {
      this.logger.debug("directConnectionsChanged event fired");
      void this.synchronizeDirectConnections();
    });

    return [
      ccloudConnectedSub,
      localKafkaConnectedSub,
      localSchemaRegistryConnectedSub,
      directConnectionsChangedSub,
    ];
  }

  private async synchronizeDirectConnections(): Promise<void> {
    this.logger.debug("Synchronizing direct connections");

    // collect current direct connections from this.connections map
    const existingDirectConnections = Array.from(this.connections.values()).filter(
      (row) => row instanceof DirectConnectionRow,
    );

    // ... and the new list of direct loaders. We ought to find one or more diffs between the two.
    const directLoaders = ResourceLoader.directLoaders();

    // TODO move to own method.
    // Find if any new direct connections have been added
    const newDirectLoaders = directLoaders.filter(
      (loader) =>
        !existingDirectConnections.some((row) => row.connectionId === loader.connectionId),
    );

    this.logger.debug("New direct loaders found", {
      newDirectLoaders: newDirectLoaders.length,
    });

    if (newDirectLoaders.length > 0) {
      // For each new direct loader, create a new DirectConnectionRow and store it.
      for (const loader of newDirectLoaders) {
        const connectionRow = new DirectConnectionRow(loader);
        void this.loadAndStoreConnection(connectionRow, false);
      }
    }

    // TODO move to own method.
    // Now check for any direct connections that have been removed.
    const removedDirectLoaders = existingDirectConnections.filter(
      (row) => !directLoaders.some((loader) => loader.connectionId === row.connectionId),
    );

    this.logger.debug("Removed direct loaders found", {
      removedDirectLoaders: removedDirectLoaders.length,
    });
    if (removedDirectLoaders.length > 0) {
      // For each removed direct loader, remove the connection row from the map.
      for (const row of removedDirectLoaders) {
        this.logger.debug("Removing direct connection row", {
          connectionId: row.connectionId,
        });
        this.connections.delete(row.connectionId);
      }
    }

    // Finally, repaint the view to reflect the changes.
    this.logger.debug("Repainting view after synchronizing direct connections");
    this.repaint();
  }

  /** Repaint this node in the treeview. */
  private repaint(object: NewResourceViewProviderData | undefined = undefined): void {
    this.logger.debug("Repainting child", {
      object: object ? object.constructor.name : "undefined",
    });
    this._onDidChangeTreeData.fire(object);
  }

  /**
   * Lazy initialize the connections map with the known connections.
   * This is called when the view is first opened or when there are no connections yet.
   */
  private async lazyInitializeConnections(): Promise<void> {
    this.logger.debug("Lazy initializing connections");

    // Store all of the connections. Will also kick off the initial loading of environments
    // for each connection.
    for (const connectionRow of [new CCloudConnectionRow(), new LocalConnectionRow()]) {
      void this.loadAndStoreConnection(connectionRow, true);
    }

    // Queue up storing of the initial population of direct connections,
    // after each completes refreshing (so we can know what icon type and name to use)
    const directLoaders = ResourceLoader.directLoaders();
    directLoaders.forEach((loader) => {
      void this.loadAndStoreConnection(new DirectConnectionRow(loader), false);
    });
  }

  getChildren(element: NewResourceViewProviderData | undefined): NewResourceViewProviderData[] {
    this.logger.debug("Getting children", {
      element: element ? element.constructor.name : "undefined",
    });

    // if empty map, kick of initialization, but return empty array
    if (this.connections.size === 0) {
      this.logger.debug("No connections found, initializing connections");
      void this.lazyInitializeConnections();
      return [];
    }

    if (!element) {
      return this.getToplevelChildren();
    }

    if (element instanceof ConnectionRow) {
      // Defer to the ConnectionRow implementation to determine direct children.
      return element.getChildren();
    }

    if (element instanceof Environment) {
      this.logger.debug("Getting children for Environment", { environmentId: element.id });
      const children: NewResourceViewProviderData[] = [];
      if (element.kafkaClusters) {
        this.logger.debug("Adding Kafka clusters to children", {
          kafkaClusters: element.kafkaClusters.length,
        });
        children.push(...element.kafkaClusters);
      }
      if (element.schemaRegistry) {
        this.logger.debug("Adding Schema Registry to children");
        children.push(element.schemaRegistry);
      }
      if (element instanceof CCloudEnvironment && element.flinkComputePools) {
        this.logger.debug("Adding Flink Compute Pools to children", {
          flinkComputePools: element.flinkComputePools.length,
        });
        children.push(...element.flinkComputePools);
      }
      return children;
    }

    if (
      element instanceof KafkaCluster ||
      element instanceof SchemaRegistry ||
      element instanceof CCloudFlinkComputePool
    ) {
      // No children for these elements in the resources view.
      this.logger.debug("No children for KafkaCluster, SchemaRegistry, or FlinkComputePool");
      return [];
    }

    throw new Error(`GetChildren(): Unhandled element ${(element as any).constructor.name}`);
  }

  getTreeItem(element: NewResourceViewProviderData): TreeItem {
    if (element instanceof ConnectionRow) {
      return element.getTreeItem();
    } else if (element instanceof Environment) {
      return new EnvironmentTreeItem(element);
    } else if (element instanceof KafkaCluster) {
      return new KafkaClusterTreeItem(element);
    } else if (element instanceof SchemaRegistry) {
      return new SchemaRegistryTreeItem(element);
    } else if (element instanceof CCloudFlinkComputePool) {
      return new FlinkComputePoolTreeItem(element);
    }

    throw new Error(`Unhandled element: ${(element as any).constructor.name}`);
  }

  async loadAndStoreConnection(
    connectionRow: AnyConnectionRow,
    insertBeforeRefresh: boolean,
  ): Promise<void> {
    if (insertBeforeRefresh) {
      this.logger.debug("Storing connection row before initial refresh", {
        connectionId: connectionRow.connectionId,
      });
      this.storeConnection(connectionRow);
    }

    // Kick off the initial fetching for this connection.
    await connectionRow.refresh().then(() => {
      this.logger.debug("New connection row back from initial refresh", {
        connectionId: connectionRow.connectionId,
      });

      if (!insertBeforeRefresh) {
        // If we didn't insert the connection row before the refresh, we need to set the ordering
        // after the refresh is done, so that the ordering is correct.

        this.logger.debug("Storing connection row now that initial refresh has completed", {
          connectionId: connectionRow.connectionId,
        });
        this.storeConnection(connectionRow);
      }

      // Indicate that we have a new happy toplevel child.
      this.repaint();
    });
  }

  private storeConnection(connectionRow: AnyConnectionRow): void {
    connectionRow.ordering = this.connectionIndex++;
    this.connections.set(connectionRow.connectionId, connectionRow);
  }

  private getToplevelChildren(): AnyConnectionRow[] {
    const connections = [...this.connections.values()];
    connections.sort((a, b) => a.ordering - b.ordering);
    return connections;
  }
}

/**
 * Update existing resource array in place with freshly fetched updated resources.
 * Updates the existing array in place, and updates resources within it in-place using
 * the `update` method of the `IUpdatableResource` interface.
 */
export function mergeUpdates(
  existing: IUpdatableResource[],
  updatedResources: IUpdatableResource[],
): void {
  // First, delete any resources in the existing array that are not present in the updated resources.
  const updatedIds = new Set(updatedResources.map((r) => r.id));
  for (let i = existing.length - 1; i >= 0; i--) {
    if (!updatedIds.has(existing[i].id)) {
      existing.splice(i, 1); // Remove the resource from the existing array.
    }
  }

  // Make map of existing resource id to index in existing array.
  const existingMap = new Map<string, number>();
  for (let i = 0; i < existing.length; i++) {
    existingMap.set(existing[i].id, i);
  }

  // Iterate over updated resources and update existing resources in place.
  for (const updatedResource of updatedResources) {
    const existingIndex = existingMap.get(updatedResource.id);
    if (existingIndex !== undefined) {
      // Update existing resource in place.
      existing[existingIndex].update(updatedResource);
    } else {
      // Add new resource to the end of the array.
      existing.push(updatedResource);
    }
  }
}
