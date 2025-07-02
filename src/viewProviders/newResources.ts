import {
  Disposable,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
} from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { ccloudConnected, localKafkaConnected, localSchemaRegistryConnected } from "../emitters";
import { CCloudResourceLoader, LocalResourceLoader, ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import {
  CCloudEnvironment,
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
import { BaseViewProvider } from "./base";

type ConcreteEnvironment = CCloudEnvironment | LocalEnvironment | DirectEnvironment;
type ConcreteKafkaCluster = CCloudKafkaCluster | LocalKafkaCluster | DirectKafkaCluster;
type ConcreteSchemaRegistry = CCloudSchemaRegistry | LocalSchemaRegistry | DirectSchemaRegistry;

export class ConnectionRow<ET extends ConcreteEnvironment>
  implements IResourceBase, IdItem, ISearchable
{
  logger: Logger;
  ordering: number = -1; // Will be reset when the connection is stored.
  readonly environments: ET[];

  constructor(
    public readonly loader: ResourceLoader,
    public readonly name: string,
    public readonly iconPath: ThemeIcon,
    public status: string,
    public baseContextValue: string,
  ) {
    this.environments = [];
    this.logger = new Logger(`viewProviders.newResources.ConnectionRow.${this.connectionId}`);
  }

  async refresh(): Promise<void> {
    this.logger.debug("Refreshing");

    const refreshedEnvironments: ET[] = (await this.loader.getEnvironments(true)) as ET[];
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

  get id(): ConnectionId {
    return this.connectionId;
  }

  get connectionType(): ConnectionType {
    return connectionIdToType(this.connectionId);
  }

  get connected(): boolean {
    return this.environments.length > 0;
  }

  getTreeItem(): TreeItem {
    const item = new TreeItem(this.name);
    item.id = this.connectionId;
    item.iconPath = this.iconPath;
    item.description = this.status;
    item.contextValue = `${this.baseContextValue}${this.connected ? "-connected" : ""}`;
    item.collapsibleState =
      this.environments.length === 0
        ? TreeItemCollapsibleState.None
        : TreeItemCollapsibleState.Collapsed;
    return item;
  }

  getChildren(): NewResourceViewProviderData[] {
    this.logger.debug("ConnectionRow getting children", {
      environments: this.environments.length,
    });
    return this.environments;
  }
}

export class CCloudConnectionRow extends ConnectionRow<CCloudEnvironment> {
  constructor() {
    super(
      CCloudResourceLoader.getInstance(),
      "Confluent Cloud",
      new ThemeIcon(IconNames.CCLOUD_ENVIRONMENT),
      "(No Connection)",
      "resources-ccloud-container",
    );
  }
}

export class SingleEnvironmentConnectionRow<
  ET extends ConcreteEnvironment,
  KCT extends LocalKafkaCluster | DirectKafkaCluster,
  SRT extends LocalSchemaRegistry | DirectSchemaRegistry,
> extends ConnectionRow<ET> {
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

  override async refresh(): Promise<void> {
    await super.refresh();
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

export class LocalConnectionRow extends SingleEnvironmentConnectionRow<
  LocalEnvironment,
  LocalKafkaCluster,
  LocalSchemaRegistry
> {
  constructor() {
    super(
      LocalResourceLoader.getInstance(),
      "Local",
      new ThemeIcon(IconNames.LOCAL_RESOURCE_GROUP),
      "(Not Running)",
      "local-container",
    );
  }
}

type NewResourceViewProviderData =
  | ConnectionRow<ConcreteEnvironment>
  | ConcreteEnvironment
  | ConcreteKafkaCluster
  | ConcreteSchemaRegistry
  | CCloudFlinkComputePool;

export class NewResourceViewProvider
  extends BaseViewProvider<NewResourceViewProviderData>
  implements TreeDataProvider<NewResourceViewProviderData>
{
  readonly kind = "new-resources";
  readonly viewId = "new-confluent-resources";
  readonly loggerName = "viewProviders.newResources";

  private readonly connections: Map<ConnectionId, ConnectionRow<ConcreteEnvironment>> = new Map();
  private connectionIndex: number = 0;

  constructor() {
    super();

    // Initialize the default connections.
    for (const connectionRow of [new CCloudConnectionRow(), new LocalConnectionRow()]) {
      this.storeConnection(connectionRow);
    }
  }

  protected async refreshConnection(connectionId: ConnectionId): Promise<void> {
    this.logger.debug("Refreshing connection", { connectionId });

    const connectionRow = this.connections.get(connectionId);
    if (!connectionRow) {
      this.logger.warn("No connection row found for connectionId", { connectionId });
      return;
    }

    await connectionRow.refresh();
    this.logger.debug("Connection row refreshed, signaling row repaint.");
    this.repaint(connectionRow);
  }

  protected setCustomEventListeners(): Disposable[] {
    this.logger.debug("Setting up custom event listeners");

    // CCloud connection observer driving auto-refreshes of the CCloud connection
    // upon ccloud connection state changes.
    const ccloudConnectedSub: Disposable = ccloudConnected.event((connected: boolean) => {
      this.logger.debug("ccloudConnected event fired", { connected });
      void this.refreshConnection(CCLOUD_CONNECTION_ID);
    });

    // Local connection needs two different observers, one for local Kafka and one for local Schema Registry.
    const localKafkaConnectedSub: Disposable = localKafkaConnected.event((connected: boolean) => {
      this.logger.debug("localKafkaConnected event fired", { connected });
      void this.refreshConnection(LOCAL_CONNECTION_ID);
    });
    const localSchemaRegistryConnectedSub: Disposable = localSchemaRegistryConnected.event(
      (connected: boolean) => {
        this.logger.debug("localSchemaRegistryConnected event fired", { connected });
        void this.refreshConnection(LOCAL_CONNECTION_ID);
      },
    );

    return [ccloudConnectedSub, localKafkaConnectedSub, localSchemaRegistryConnectedSub];
  }

  /** Repaint this node in the treeview. */
  private repaint(object: NewResourceViewProviderData | undefined = undefined): void {
    this.logger.debug("Repainting child", {
      object: object ? object.constructor.name : "undefined",
    });
    this._onDidChangeTreeData.fire(object);
  }

  getChildren(element: NewResourceViewProviderData | undefined): NewResourceViewProviderData[] {
    this.logger.debug("Getting children", {
      element: element ? element.constructor.name : "undefined",
    });

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

  storeConnection(connectionRow: ConnectionRow<ConcreteEnvironment>): void {
    connectionRow.ordering = this.connectionIndex++;
    this.connections.set(connectionRow.connectionId, connectionRow);
  }

  private getToplevelChildren(): ConnectionRow<ConcreteEnvironment>[] {
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
