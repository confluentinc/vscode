import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { IconNames } from "../constants";
import { IdItem } from "./main";
import { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";

export class FlinkUdf implements IResourceBase, IdItem, ISearchable {
  connectionId!: ConnectionId;
  connectionType!: ConnectionType;
  // shoup: update this once https://github.com/confluentinc/vscode/issues/1385 is done
  iconName: IconNames = "code" as IconNames;

  environmentId!: EnvironmentId;

  id!: string;
  name!: string;
  description!: string;

  provider!: string; // cloud
  region!: string;

  constructor(
    props: Pick<
      FlinkUdf,
      | "connectionId"
      | "connectionType"
      | "environmentId"
      | "id"
      | "name"
      | "description"
      | "provider"
      | "region"
    >,
  ) {
    this.connectionId = props.connectionId;
    this.connectionType = props.connectionType;
    this.environmentId = props.environmentId;
    this.id = props.id;
    this.name = props.name;
    this.description = props.description;
  }

  searchableText(): string {
    return `${this.name} ${this.description}`;
  }
}

export class FlinkUdfTreeItem extends TreeItem {
  resource: FlinkUdf;

  constructor(resource: FlinkUdf) {
    super(resource.name, TreeItemCollapsibleState.None);

    this.id = resource.id;
    this.resource = resource;
    this.contextValue = `${resource.connectionType.toLowerCase()}-flink-udf`;

    this.iconPath = new ThemeIcon(resource.iconName);
    this.description = resource.description;
  }
}
