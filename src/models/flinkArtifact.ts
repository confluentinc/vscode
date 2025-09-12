import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ArtifactV1FlinkArtifactMetadata } from "../clients/flinkArtifacts";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_BASE_PATH, IconNames, UTM_SOURCE_VSCODE } from "../constants";
import { CustomMarkdownString, IdItem } from "./main";
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

  metadata: ArtifactV1FlinkArtifactMetadata;

  documentationLink: string;

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
      | "documentationLink"
      | "metadata"
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
    this.documentationLink = props.documentationLink;

    this.metadata = props.metadata;
  }

  searchableText(): string {
    return `${this.name} ${this.description}`;
  }

  get ccloudUrl(): string {
    return `https://${CCLOUD_BASE_PATH}/environments/${this.environmentId}/artifacts/flink?utm_source=${UTM_SOURCE_VSCODE}`;
  }

  get createdAt(): Date | undefined {
    return this.metadata?.created_at;
  }

  get updatedAt(): Date | undefined {
    return this.metadata?.updated_at;
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

    this.tooltip = createFlinkArtifactToolTip(resource);
  }
}

export function createFlinkArtifactToolTip(resource: FlinkArtifact): CustomMarkdownString {
  const tooltip = new CustomMarkdownString()
    .addHeader("Flink Artifact", IconNames.FLINK_ARTIFACT)
    .addField("ID", resource.id)
    .addField("Description", resource.description)
    .addField("Created At", resource.createdAt?.toLocaleString())
    .addField("Updated At", resource.updatedAt?.toLocaleString());

  if (!resource.documentationLink || resource.documentationLink === "") {
    tooltip.addLink("No documentation link", "");
  } else {
    tooltip.addLink("See Documentation", resource.documentationLink);
  }

  tooltip.addCCloudLink(resource.ccloudUrl);

  return tooltip;
}
