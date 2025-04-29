import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { IconNames } from "../constants";
import { IdItem } from "./main";
import { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";

export class FlinkArtifact implements IResourceBase, IdItem, ISearchable {
  connectionId!: ConnectionId;
  connectionType!: ConnectionType;
  iconName: IconNames = IconNames.FLINK_ARTIFACT;

  environmentId!: EnvironmentId;

  id!: string;
  name!: string; // display_name
  description!: string;

  provider!: string; // cloud
  region!: string;

  constructor(
    props: Pick<
      FlinkArtifact,
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
    this.provider = props.provider;
    this.region = props.region;
  }

  searchableText(): string {
    return `${this.name} ${this.description}`;
  }
}

export class FlinkArtifactTreeItem extends TreeItem {
  resource: FlinkArtifact;

  constructor(resource: FlinkArtifact) {
    super(resource.name, TreeItemCollapsibleState.None);

    // internal properties
    this.id = resource.id;
    this.resource = resource;
    this.contextValue = `${resource.connectionType.toLowerCase()}-flink-artifact`;

    // user-facing properties
    this.iconPath = new ThemeIcon(resource.iconName);
    this.description = resource.description;

    // TODO: add tooltip
  }
}
