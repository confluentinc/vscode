import {
  Disposable,
  MarkdownString,
  ThemeColor,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
} from "vscode";
import { ConnectionStatus, ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import {
  ccloudConnected,
  connectionDisconnected,
  connectionStable,
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
import { ConnectionStateWatcher } from "../sidecar/connections/watcher";
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

  /**
   * Refresh this connection row, which will fetch the latest environments and resources
   * for this connection.
   *
   * @param deepRefresh Passed to the loader's `getEnvironments` method to indicate whether
   *                    to perform a deep refresh (e.g. re-fetch all resources) or a shallow refresh
   *                    (e.g. use cached resources).
   */
  async refresh(deepRefresh = true): Promise<void> {
    this.logger.debug("Refreshing", { deepRefresh });

    const refreshedEnvironments: ET[] = await this.getEnvironments(deepRefresh);

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

  /** Drive getting the environment(s) from the ResourceLoader. */
  async getEnvironments(deepRefresh: boolean = false): Promise<ET[]> {
    this.logger.debug("Getting environments", { deepRefresh });
    return (await this.loader.getEnvironments(deepRefresh)) as ET[];
  }

  abstract get name(): string;

  abstract get tooltip(): string | MarkdownString;

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

  abstract get connected(): boolean;

  /**
   * Return the immediate children of this connection row:
   *  * Kafka cluster and / or schema registry if is a single env row,
   *  * environment(s) if is the logged-in ccloud row
   **/
  abstract getChildren(): ConnectionRowChildren[];

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

  /** Degenerate implementation for now, we don't yet handle the search aspect. */
  searchableText(): string {
    return this.name;
  }
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

  override get connected(): boolean {
    // connected if we have at least one environment AND that env
    // has either Kafka cluster or a Schema Registry visible.
    return (
      this.environments.length > 0 &&
      (this.kafkaCluster !== undefined || this.schemaRegistry !== undefined)
    );
  }

  getChildren(): (KCT | SRT)[] {
    if (this.environments.length === 0) {
      return [];
    }

    const environment = this.environments[0];

    const children: (KCT | SRT)[] = [];

    if (environment.kafkaClusters.length > 0) {
      children.push(...(environment.kafkaClusters as KCT[]));
    }
    if (environment.schemaRegistry) {
      children.push(environment.schemaRegistry as SRT);
    }

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

  get connected(): boolean {
    return this.environments.length > 0;
  }

  get status(): string {
    return this.connected ? this.ccloudOrganization!.name : "(No connection)";
  }

  get tooltip(): string {
    return "Confluent Cloud";
  }

  /**
   * Refresh the ccloud connection row. Handles the organization aspect
   * here, defers to super().refresh() to handle environments.
   */
  override async refresh(deepRefresh: boolean): Promise<void> {
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
        void showErrorNotificationWithButtons(msg);

        this.environments.length = 0;
        this.ccloudOrganization = undefined;
      }
    } else {
      this.logger.debug(
        "No CCloud auth session, skipping organization refresh; setting values to undefined.",
      );
      this.ccloudOrganization = undefined;
      this.environments.length = 0; // Clear environments if no auth session.
    }
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

  override async getEnvironments(deepRefresh: boolean = false): Promise<DirectEnvironment[]> {
    const environments = await this.loader.getEnvironments(deepRefresh);

    if (environments.length > 0) {
      // Augment with information from websocket events, if available.
      // Taken from old resources view updateEnvironmentFromConnectionStatus().
      const watcher = ConnectionStateWatcher.getInstance();
      const latestStatus: ConnectionStatus | undefined = watcher.getLatestConnectionEvent(
        this.connectionId,
      )?.connection.status;
      if (latestStatus) {
        const env = environments[0];
        env.kafkaConnectionFailed = latestStatus.kafka_cluster?.errors?.sign_in?.message;
        env.schemaRegistryConnectionFailed = latestStatus.schema_registry?.errors?.sign_in?.message;
      }
    }

    return environments;
  }

  get iconPath(): ThemeIcon {
    if (this.environment) {
      // Are we connected to all of the components we expect?
      const { missingKafka, missingSR } = this.environment.checkForMissingResources();
      if (missingKafka || missingSR) {
        return new ThemeIcon("warning", new ThemeColor("problemsErrorIcon.foreground"));
      }
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
  /**
   * Is this the first time refresh() is called?
   *
   * If so, then be sure to try to discern if there's a local
   * Schema Registry running at all, then to update the local connection
   * (and sidecar).
   */
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

  override async refresh(deepRefresh: boolean): Promise<void> {
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
  readonly kind = "resources";
  readonly viewId = "confluent-resources";
  readonly loggerName = "viewProviders.newResources";

  private readonly connections: Map<ConnectionId, AnyConnectionRow> = new Map();
  private connectionIndex: number = 0;

  public async refreshConnection(connectionId: ConnectionId, deepRefresh = true): Promise<void> {
    await this.withProgress("Refreshing connection ...", async () => {
      this.logger.debug("Refreshing connection", { connectionId });

      const connectionRow = this.connections.get(connectionId);
      if (!connectionRow) {
        this.logger.warn("No connection row found for connectionId", { connectionId });
        return;
      }

      // Always do a deep refresh of this connection.
      await connectionRow.refresh(deepRefresh);

      this.logger.debug("Connection row refreshed, signaling row repaint.");
      this.repaint(connectionRow);
    });
  }

  protected setCustomEventListeners(): Disposable[] {
    this.logger.debug("Setting up custom event listeners");

    // CCloud connection observer driving auto-refreshes of the CCloud connection
    // upon ccloud connection state changes.
    const ccloudConnectedSub: Disposable = ccloudConnected.event(
      this.ccloudConnectedEventHandler.bind(this),
    );

    // Local connection needs two different observers, one for local Kafka and one for local Schema Registry.
    const localKafkaConnectedSub: Disposable = localKafkaConnected.event(
      this.localConnectedEventHandler.bind(this),
    );

    const localSchemaRegistryConnectedSub: Disposable = localSchemaRegistryConnected.event(
      this.localConnectedEventHandler.bind(this),
    );

    // Watch for direct connections being added/removed, call to reconcile all direct connections.
    const directConnectionsChangedSub: Disposable = directConnectionsChanged.event(
      this.reconcileDirectConnections.bind(this),
    );

    // Watch for (direct) connections going 'stable', which will happen
    // when they get created and settled. Refresh the event-provided connection id.
    const connectionUsableSub: Disposable = connectionStable.event(
      this.refreshConnection.bind(this),
    );

    // watch for (direct) connections going disconnected (but not deleted)
    // (will happen, say, if sidecar can no longer get at direct connection Kafka cluster)
    // Refresh the event-provided connection id.
    const connectionDisconnectedSub: Disposable = connectionDisconnected.event(
      this.refreshConnection.bind(this),
    );

    return [
      ccloudConnectedSub,
      localKafkaConnectedSub,
      localSchemaRegistryConnectedSub,
      directConnectionsChangedSub,
      connectionUsableSub,
      connectionDisconnectedSub,
    ];
  }

  async ccloudConnectedEventHandler(): Promise<void> {
    // Refresh the CCloud connection row when the ccloudConnected event is fired,
    // regardless of if edging to connected or disconnected state.
    await this.refreshConnection(CCLOUD_CONNECTION_ID, true);
  }

  async localConnectedEventHandler(): Promise<void> {
    // Refresh the local connection row when either local Kafka or local Schema Registry
    // connection state changes.
    await this.refreshConnection(LOCAL_CONNECTION_ID, true);
  }

  /**
   * Reconcile the direct connections within this.connections with authoritative
   * list from ResourceLoader.directLoaders().
   * This will either insert or remove DirectConnectionRow instances
   * from this.connections map, and then repaint the view to reflect the changes.
   */
  private async reconcileDirectConnections(): Promise<void> {
    await this.withProgress("Synchronizing direct connections ...", async () => {
      this.logger.debug("Synchronizing direct connections");

      // The new list of direct loaders.
      const directLoaders = ResourceLoader.directLoaders();

      // collect current direct connections from this.connections map
      const existingDirectConnections = Array.from(this.connections.values()).filter(
        (row) => row instanceof DirectConnectionRow,
      );

      // We nay collect more than one async operation to perform while within
      // the withProgress() call, so we can show a single throbber while
      // we perform all of the operations.
      const loadAndStorePromises: Promise<void>[] = [];

      // Find if any new direct connections have been added. Will need to make
      // new DirectConnectionRow instances for them, add into map, ... .
      const newDirectLoaders = directLoaders.filter(
        (loader) =>
          !existingDirectConnections.some((row) => row.connectionId === loader.connectionId),
      );

      this.logger.debug("New direct loaders found", {
        newDirectLoaders: newDirectLoaders.length,
      });

      if (newDirectLoaders.length > 0) {
        // For each new direct loader, create a new DirectConnectionRow and queue up to
        // load its coarse resources and store it.
        for (const loader of newDirectLoaders) {
          const connectionRow = new DirectConnectionRow(loader);
          loadAndStorePromises.push(this.loadAndStoreConnection(connectionRow, false));
        }
      }

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

      if (loadAndStorePromises.length > 0) {
        this.logger.debug("Waiting for direct connection load/store promises to complete");
        await Promise.all(loadAndStorePromises);
      }

      // Finally, repaint the view to reflect the changes.
      this.logger.debug("Repainting view after reconciling direct connections");
      this.repaint();
    });
  }

  /** Repaint this node in the treeview. Pass nothing if wanting a toplevel repaint.*/
  private repaint(object: NewResourceViewProviderData | undefined = undefined): void {
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

    if (!element) {
      if (this.connections.size === 0) {
        // kicks off async initialization task. When done,
        // it will signal to repaint the view.
        this.lazyInitializeConnections();

        // but we have no children at this time.
        return [];
      }

      // otherwise we have some connection rows, so return them.
      return this.getToplevelChildren();
    }

    if (element instanceof ConnectionRow) {
      // Defer to the ConnectionRow implementation to determine direct children.

      // LocalConnectionRow and DirectConnectionRow handle 'eliding' their
      // environments and return Kafka clusters and schema registries directly.
      // Only CCloudConnectionRow returns (ccloud) environments.
      return element.getChildren();
    }

    if (element instanceof CCloudEnvironment) {
      return element.children as ConnectionRowChildren[];
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
    /** The row to insert */
    connectionRow: AnyConnectionRow,
    insertBeforeRefresh: boolean,
  ): Promise<void> {
    if (insertBeforeRefresh) {
      // Codepath for local, ccloud rows whose core treeitem attributes
      // (name, etc.) are known before the initial refresh.
      this.logger.debug("Storing connection row before initial refresh", {
        connectionId: connectionRow.connectionId,
      });
      this.storeConnection(connectionRow);
    }

    // Kick off the initial fetching for this connection.
    await connectionRow.refresh(false).then(() => {
      this.logger.debug("New connection row back from initial refresh", {
        connectionId: connectionRow.connectionId,
      });

      if (!insertBeforeRefresh) {
        // Codepath for direct connections, where we don't know the name, icon, etc.
        // until after the initial refresh (and if we tried to make a TreeItem
        // before the refresh, an error would be raised).
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
