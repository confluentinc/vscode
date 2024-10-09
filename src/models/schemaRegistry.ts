import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";
import { CustomMarkdownString } from "./main";

export class CCloudSchemaRegistry extends Data {
  readonly connectionId = CCLOUD_CONNECTION_ID;
  readonly isLocal: boolean = false;
  readonly isCCloud: boolean = true;

  id!: Enforced<string>;
  provider!: Enforced<string>;
  region!: Enforced<string>;
  uri!: Enforced<string>;
  // added separately from sidecar responses
  environmentId!: Enforced<string>;

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.environmentId}/schema-registry/schemas`;
  }
}

// TODO(shoup): add LocalSchemaRegistry once available
export type SchemaRegistry = CCloudSchemaRegistry;

// Tree item representing a Schema Registry in the Resources view
export class SchemaRegistryTreeItem extends vscode.TreeItem {
  resource: SchemaRegistry;

  constructor(resource: SchemaRegistry) {
    const label = "Schema Registry";
    super(label, vscode.TreeItemCollapsibleState.None);

    // internal properties
    this.resource = resource;
    // TODO(shoup): update context value once local SR is available
    this.contextValue = "ccloud-schema-registry";

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

function createSchemaRegistryTooltip(resource: CCloudSchemaRegistry): vscode.MarkdownString {
  // TODO(shoup) update for local SR once available
  const tooltip = new CustomMarkdownString()
    .appendMarkdown(`#### $(${IconNames.SCHEMA_REGISTRY}) Confluent Cloud Schema Registry`)
    .appendMarkdown("\n\n---\n\n")
    .appendMarkdown(`ID: \`${resource.id}\`\n\n`)
    .appendMarkdown(`Provider: \`${resource.provider}\`\n\n`)
    .appendMarkdown(`Region: \`${resource.region}\`\n\n`)
    .appendMarkdown(`URI: \`${resource.uri}\``)
    .appendMarkdown("\n\n---\n\n")
    .appendMarkdown(
      `[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${resource.ccloudUrl})`,
    );
  return tooltip;
}
