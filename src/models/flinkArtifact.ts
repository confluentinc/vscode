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
  computePoolId!: string;

  name!: string; // display_name
  description!: string;

  provider!: string; // cloud
  region!: string;

  // TODO: add more properties as needed

  constructor(
    props: Pick<
      FlinkArtifact,
      | "connectionId"
      | "connectionType"
      | "environmentId"
      | "computePoolId"
      | "name"
      | "description"
      | "provider"
      | "region"
    >,
  ) {
    this.connectionId = props.connectionId;
    this.connectionType = props.connectionType;
    this.environmentId = props.environmentId;
    this.computePoolId = props.computePoolId;
    this.name = props.name;
    this.provider = props.provider;
    this.region = props.region;
  }

  get id(): string {
    return `${this.connectionId}-${this.computePoolId}-${this.name}`;
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
    this.id = `${resource.connectionId}-${resource.computePoolId}-${resource.name}`;
    this.resource = resource;
    this.contextValue = `${resource.connectionType.toLowerCase()}-flink-artifact`;

    // user-facing properties
    this.iconPath = new ThemeIcon(resource.iconName);
    this.description = resource.description;

    // TODO: add tooltip
  }
}
