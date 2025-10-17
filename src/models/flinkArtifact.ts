import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import type { ArtifactV1FlinkArtifactMetadata } from "../clients/flinkArtifacts";
import type { ConnectionType } from "../clients/sidecar";
import { CCLOUD_BASE_PATH, IconNames, UTM_SOURCE_VSCODE } from "../constants";
import type { IdItem } from "./main";
import { CustomMarkdownString } from "./main";
import type { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";

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

    this.metadata = {
      ...props.metadata,
      created_at:
        typeof props.metadata?.created_at === "string"
          ? new Date(props.metadata.created_at)
          : props.metadata?.created_at,
      updated_at:
        typeof props.metadata?.updated_at === "string"
          ? new Date(props.metadata.updated_at)
          : props.metadata?.updated_at,
      deleted_at:
        typeof props.metadata?.deleted_at === "string"
          ? new Date(props.metadata.deleted_at)
          : props.metadata?.deleted_at,
    };
  }

  searchableText(): string {
    const parts = [];
    parts.push(this.id);
    parts.push(this.name);
    parts.push(this.description);

    // All artifacts in a single view will share the same environment, provider, and region, so no need to search on those.

    return parts.join(" ");
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
    .addField(
      "Created At",
      resource.createdAt?.toLocaleString(undefined, { timeZoneName: "short" }),
    )
    .addField(
      "Updated At",
      resource.updatedAt?.toLocaleString(undefined, { timeZoneName: "short" }),
    )
    .addField("Provider", resource.provider)
    .addField("Region", resource.region);

  if (!resource.documentationLink || resource.documentationLink === "") {
    tooltip.addLink("No documentation link", "");
  } else {
    tooltip.addLink("See Documentation", resource.documentationLink);
  }

  tooltip.addCCloudLink(resource.ccloudUrl);

  return tooltip;
}
