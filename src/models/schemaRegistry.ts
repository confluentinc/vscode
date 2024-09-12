import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";
import { CustomMarkdownString } from "./main";

// Main class representing CCloud Schema Registry clusters, matching key/value pairs returned
// by the `confluent schema-registry cluster describe` command.
export class SchemaRegistryCluster extends Data {
  readonly connectionId = CCLOUD_CONNECTION_ID;

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

// Tree item representing a CCloud Schema Registry cluster
export class SchemaRegistryClusterTreeItem extends vscode.TreeItem {
  resource: SchemaRegistryCluster;

  constructor(resource: SchemaRegistryCluster) {
    const label = "Schema Registry";
    super(label, vscode.TreeItemCollapsibleState.None);

    // internal properties
    this.resource = resource;
    this.contextValue = "ccloud-schema-registry-cluster";

    // user-facing properties
    this.description = this.resource.id;
    this.iconPath = new vscode.ThemeIcon(IconNames.SCHEMA_REGISTRY);
    this.tooltip = createSchemaRegistryClusterTooltip(this.resource);

    // set primary click action to select this cluster as the current one, focusing it in the Schemas view
    this.command = {
      command: "confluent.resources.schema-registry.select",
      title: "Set Current Schema Registry Cluster",
      arguments: [this.resource],
    };
  }
}

function createSchemaRegistryClusterTooltip(
  resource: SchemaRegistryCluster,
): vscode.MarkdownString {
  // TODO(shoup) update for local SR once available
  const tooltip = new CustomMarkdownString()
    .appendMarkdown(`#### $(${IconNames.SCHEMA_REGISTRY}) Confluent Cloud Schema Registry Cluster`)
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
