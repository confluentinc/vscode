import { type Require as Enforced } from "dataclass";
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { CustomMarkdownString } from "./main";
import { ResourceBase } from "./resource";

export abstract class SchemaRegistry extends ResourceBase {
  iconName: IconNames = IconNames.SCHEMA_REGISTRY;

  id!: Enforced<string>;
  uri!: Enforced<string>;
}

export class CCloudSchemaRegistry extends SchemaRegistry {
  readonly connectionId = CCLOUD_CONNECTION_ID;
  readonly connectionType: ConnectionType = "CCLOUD";

  provider!: Enforced<string>;
  region!: Enforced<string>;
  // added separately from sidecar responses
  environmentId!: Enforced<string>;

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.environmentId}/schema-registry/schemas`;
  }
}

export class DirectSchemaRegistry extends SchemaRegistry {
  // `connectionId` dynamically assigned at connection creation time
  readonly connectionType: ConnectionType = "DIRECT";
  // added separately from sidecar responses; will be the same value as the connectionId
  environmentId!: Enforced<string>;
}

export class LocalSchemaRegistry extends SchemaRegistry {
  readonly connectionId = LOCAL_CONNECTION_ID;
  readonly connectionType: ConnectionType = "LOCAL";
}

/** The representation of a {@link SchemaRegistry} as a {@link TreeItem} in the VS Code UI. */
export class SchemaRegistryTreeItem extends TreeItem {
  resource: SchemaRegistry;

  constructor(resource: SchemaRegistry) {
    const label = "Schema Registry";
    super(label, TreeItemCollapsibleState.None);

    // internal properties
    this.resource = resource;
    this.contextValue = `${this.resource.contextPrefix}-schema-registry`;

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
  const tooltip = new CustomMarkdownString();
  if (resource.isCCloud) {
    const ccloudSchemaRegistry = resource as CCloudSchemaRegistry;
    tooltip
      .appendMarkdown(`#### $(${IconNames.SCHEMA_REGISTRY}) Confluent Cloud Schema Registry`)
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(`ID: \`${ccloudSchemaRegistry.id}\`\n\n`)
      .appendMarkdown(`Provider: \`${ccloudSchemaRegistry.provider}\`\n\n`)
      .appendMarkdown(`Region: \`${ccloudSchemaRegistry.region}\`\n\n`)
      .appendMarkdown(`URI: \`${ccloudSchemaRegistry.uri}\``)
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(
        `[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${ccloudSchemaRegistry.ccloudUrl})`,
      );
  } else {
    const localPrefix = resource.isLocal ? "Local " : "";
    tooltip
      .appendMarkdown(`#### $(${IconNames.SCHEMA_REGISTRY}) ${localPrefix}Schema Registry`)
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(`ID: \`${resource.id}\`\n\n`)
      .appendMarkdown(`URI: \`${resource.uri}\``);
  }
  return tooltip;
}
