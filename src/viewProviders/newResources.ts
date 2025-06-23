import { Disposable, TreeDataProvider, TreeItem } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCloudEnvironment, DirectEnvironment, LocalEnvironment } from "../models/environment";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster, DirectKafkaCluster, LocalKafkaCluster } from "../models/kafkaCluster";
import { IdItem } from "../models/main";
import { ConnectionId, IResourceBase, ISearchable } from "../models/resource";
import {
  CCloudSchemaRegistry,
  DirectSchemaRegistry,
  LocalSchemaRegistry,
} from "../models/schemaRegistry";
import { BaseViewProvider } from "./base";

type CCloudResources =
  | CCloudEnvironment
  | CCloudKafkaCluster
  | CCloudSchemaRegistry
  | CCloudFlinkComputePool;
type LocalResources = LocalEnvironment | LocalKafkaCluster | LocalSchemaRegistry;
type DirectResources = DirectEnvironment | DirectKafkaCluster | DirectSchemaRegistry;

class ConnectionRow implements IResourceBase, IdItem, ISearchable {
  id!: string;

  searchableText(): string {
    return this.name;
  }

  constructor(
    public readonly connectionId: ConnectionId,
    public readonly connectionType: ConnectionType,
    public readonly name: string,
  ) {
    this.id = connectionId;
  }

  getTreeItem(): TreeItem {
    const item = new TreeItem(this.name);
    item.id = this.connectionId;
    item.contextValue = `connection.${this.connectionType}`;
    return item;
  }
}

type NewResourceViewProviderData =
  | ConnectionRow
  | CCloudResources
  | LocalResources
  | DirectResources;

export class NewResourceViewProvider
  extends BaseViewProvider<NewResourceViewProviderData>
  implements TreeDataProvider<NewResourceViewProviderData>
{
  readonly kind = "new-resources";
  readonly viewId = "new-confluent-resources";
  readonly loggerName = "viewProviders.newResources";

  data: Map<string, NewResourceViewProviderData> = new Map();

  protected setCustomEventListeners(): Disposable[] {
    // No custom event listeners yet.
    return [];
  }

  /** Repaint this node in the treeview. */
  private repaint(object: NewResourceViewProviderData | undefined = undefined): void {
    this._onDidChangeTreeData.fire(object);
  }

  getChildren(): NewResourceViewProviderData[] {
    return [];
  }

  getTreeItem(): TreeItem {
    return new TreeItem("New Resources", 1);
  }
}
