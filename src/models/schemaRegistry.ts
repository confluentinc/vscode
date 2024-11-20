import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { CustomMarkdownString } from "./main";

export abstract class SchemaRegistry extends Data {
  abstract readonly connectionId: string;
  abstract readonly isLocal: boolean;
  abstract readonly isCCloud: boolean;

  id!: Enforced<string>;
  uri!: Enforced<string>;

  toString(): string {
    return `(SR ${this.id} from connection ${this.connectionId})`;
  }
}

export class LocalSchemaRegistry extends SchemaRegistry {
  readonly connectionId = LOCAL_CONNECTION_ID;
  readonly isLocal: boolean = true;
  readonly isCCloud: boolean = false;
}

export class CCloudSchemaRegistry extends SchemaRegistry {
  readonly connectionId = CCLOUD_CONNECTION_ID;
  readonly isLocal: boolean = false;
  readonly isCCloud: boolean = true;

  provider!: Enforced<string>;
  region!: Enforced<string>;
  // added separately from sidecar responses
  environmentId!: Enforced<string>;

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.environmentId}/schema-registry/schemas`;
  }
}

// Tree item representing a Schema Registry in the Resources view
export class SchemaRegistryTreeItem extends vscode.TreeItem {
  resource: SchemaRegistry;

  constructor(resource: SchemaRegistry) {
    const label = "Schema Registry";
    super(label, vscode.TreeItemCollapsibleState.None);

    // internal properties
    this.resource = resource;
    this.contextValue = this.resource.isLocal ? "local-schema-registry" : "ccloud-schema-registry";

    // user-facing properties
    this.description = this.resource.id;
    this.iconPath = new vscode.ThemeIcon(IconNames.SCHEMA_REGISTRY);
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
function createSchemaRegistryTooltip(resource: SchemaRegistry): vscode.MarkdownString {
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
    const localSchemaRegistry = resource as LocalSchemaRegistry;
    tooltip
      .appendMarkdown(`#### $(${IconNames.SCHEMA_REGISTRY}) Local Schema Registry`)
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(`ID: \`${localSchemaRegistry.id}\`\n\n`)
      .appendMarkdown(`URI: \`${localSchemaRegistry.uri}\``);
  }
  return tooltip;
}
