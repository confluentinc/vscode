import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";
import { IdItem } from "./main";
import { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";

export class FlinkUdf implements IResourceBase, IdItem, ISearchable {
  /** What CCloud environment this UDF came from (from the Kafka Cluster) */
  environmentId: EnvironmentId;
  /** What cloud provider hosts the parent Kafka Cluster? */
  provider: string;
  /** What cloud region hosts the parent Kafka Cluster? */
  region: string;
  /** The Flinkable CCloud Kafka Cluster id the UDF belongs to. */
  databaseId: string;

  id: string;
  name: string;
  description: string;

  constructor(
    props: Pick<
      FlinkUdf,
      "environmentId" | "provider" | "region" | "databaseId" | "id" | "name" | "description"
    >,
  ) {
    // From the parent Kafka cluster:
    this.environmentId = props.environmentId;
    this.provider = props.provider;
    this.region = props.region;
    this.databaseId = props.databaseId;

    // From the UDF itself:
    this.id = props.id;
    this.name = props.name;
    this.description = props.description;
  }

  searchableText(): string {
    return `${this.name} ${this.description}`;
  }

  get connectionId(): ConnectionId {
    return CCLOUD_CONNECTION_ID;
  }

  get connectionType(): ConnectionType {
    return ConnectionType.Ccloud;
  }
}

export class FlinkUdfTreeItem extends TreeItem {
  resource: FlinkUdf;

  constructor(resource: FlinkUdf) {
    super(resource.name, TreeItemCollapsibleState.None);

    this.id = resource.id;
    this.resource = resource;
    this.contextValue = `${resource.connectionType.toLowerCase()}-flink-udf`;

    // shoup: update this once https://github.com/confluentinc/vscode/issues/1385 is done
    this.iconPath = new ThemeIcon("code" as IconNames);

    this.description = resource.description;
  }
}
