import {
  Disposable,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
} from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { localKafkaConnected, localSchemaRegistryConnected } from "../emitters";
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

  async refresh(deepRefresh: boolean = false): Promise<void> {
    this.logger.debug("Refreshing");

    const environments: ET[] = (await this.loader.getEnvironments(deepRefresh)) as ET[];
    // TODO: merge in place, don't replace.
    this.environments.length = 0;
    for (const environment of environments) {
      this.environments.push(environment);
    }
    this.logger.debug("Refreshed", {
      environments: this.environments.length,
    });
  }

  searchableText(): string {
    return this.name;
  }

  clearEnvironments(): void {
    this.environments.length = 0;
  }

  addEnvironment(environment: ET): void {
    this.environments.push(environment);
  }

  getEnvironment(environmentId: EnvironmentId): ET | undefined {
    return this.environments.find((env) => env.id === environmentId);
  }

  get connectionId(): ConnectionId {
    return this.loader.connectionId;
  }

  get id(): string {
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

export class SingleEnvironmentConnectionRow<
  ET extends ConcreteEnvironment,
  KCT extends LocalKafkaCluster | DirectKafkaCluster,
  SRT extends LocalSchemaRegistry | DirectSchemaRegistry,
> extends ConnectionRow<ET> {
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
      children.push(...(environment.kafkaClusters as KCT[]));
    }
    if (environment.schemaRegistry) {
      children.push(environment.schemaRegistry as SRT);
    }

    this.logger.debug("Returning children", {
      children: children.length,
    });
    return children;
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
    for (const connectionRow of [
      new SingleEnvironmentConnectionRow<
        CCloudEnvironment,
        CCloudKafkaCluster,
        CCloudSchemaRegistry
      >(
        CCloudResourceLoader.getInstance(),
        "Confluent Cloud",
        new ThemeIcon(IconNames.CONFLUENT_LOGO),
        "(No Connection)",
        "resources-ccloud-container",
      ),
      new SingleEnvironmentConnectionRow<LocalEnvironment, LocalKafkaCluster, LocalSchemaRegistry>(
        LocalResourceLoader.getInstance(),
        "Local",
        new ThemeIcon(IconNames.LOCAL_RESOURCE_GROUP),
        "(Not Running)",
        "local-container",
      ),
    ]) {
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
    this.repaint(connectionRow);
  }

  protected setCustomEventListeners(): Disposable[] {
    this.logger.debug("Setting up custom event listeners");
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

    return [localKafkaConnectedSub, localSchemaRegistryConnectedSub];
  }

  /** Repaint this node in the treeview. */
  private repaint(object: NewResourceViewProviderData | undefined = undefined): void {
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
      return element.getChildren();
    }
    throw new Error(`Unhandled element: ${element.constructor.name}`);
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
