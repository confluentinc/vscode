import { Data, type Require as Enforced } from "dataclass";
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { CustomMarkdownString } from "./main";
import { ConnectionId, IResourceBase, isCCloud } from "./resource";

export abstract class SchemaRegistry extends Data implements IResourceBase {
  abstract connectionId: ConnectionId;
  abstract connectionType: ConnectionType;
  iconName: IconNames = IconNames.SCHEMA_REGISTRY;

  id!: Enforced<string>;
  uri!: Enforced<string>;
  // added separately from sidecar responses
  environmentId!: Enforced<string>;
}

export class CCloudSchemaRegistry extends SchemaRegistry {
  readonly connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Ccloud;

  provider!: Enforced<string>;
  region!: Enforced<string>;

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.environmentId}/schema-registry/schemas`;
  }
}

export class DirectSchemaRegistry extends SchemaRegistry {
  readonly connectionId!: Enforced<ConnectionId>;
  readonly connectionType: ConnectionType = ConnectionType.Direct;
  // environmentId should map to the connectionId
}

export class LocalSchemaRegistry extends SchemaRegistry {
  readonly connectionId: ConnectionId = LOCAL_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Local;
  // environmentId should map to the connectionId
}

/** The representation of a {@link SchemaRegistry} as a {@link TreeItem} in the VS Code UI. */
export class SchemaRegistryTreeItem extends TreeItem {
  resource: SchemaRegistry;

  constructor(resource: SchemaRegistry) {
    const label = "Schema Registry";
    super(label, TreeItemCollapsibleState.None);

    // internal properties
    this.resource = resource;
    this.contextValue = `${this.resource.connectionType.toLowerCase()}-schema-registry`;

    // user-facing properties
    this.description = this.resource.id;
    this.iconPath = new ThemeIcon(this.resource.iconName);
    this.tooltip = createSchemaRegistryTooltip(this.resource);

    // set primary click action to select this cluster as the current one, focusing it in the Schemas view
    this.command = {
      command: "confluent.resources.schema-registry.select",
      title: "Set Current Schema Registry",
      arguments: [this.resource],
    };
  }
}

// todo easy peasy make this a method of SchemaRegistry family.
function createSchemaRegistryTooltip(resource: SchemaRegistry): MarkdownString {
  const tooltip = new CustomMarkdownString()
    .appendMarkdown(`#### $(${resource.iconName}) Schema Registry`)
    .appendMarkdown("\n\n---")
    .appendMarkdown(`\n\nID: \`${resource.id}\``)
    .appendMarkdown(`\n\nURI: \`${resource.uri}\``);
  if (isCCloud(resource)) {
    const ccloudSchemaRegistry = resource as CCloudSchemaRegistry;
    tooltip
      .appendMarkdown(`\n\nProvider: \`${ccloudSchemaRegistry.provider}\``)
      .appendMarkdown(`\n\nRegion: \`${ccloudSchemaRegistry.region}\``)
      .appendMarkdown("\n\n---")
      .appendMarkdown(
        `\n\n[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${ccloudSchemaRegistry.ccloudUrl})`,
      );
  }
  return tooltip;
}
