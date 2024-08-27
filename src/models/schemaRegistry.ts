import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";

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

    this.resource = resource;
    this.description = this.resource.id;

    // TODO: update based on product+design feedback
    this.tooltip = JSON.stringify(this.resource, null, 2);

    this.contextValue = "ccloud-schema-registry-cluster";

    this.iconPath = new vscode.ThemeIcon(IconNames.SCHEMA_REGISTRY);

    this.command = {
      command: "confluent.resources.schema-registry.select",
      title: "Set Current Schema Registry Cluster",
      arguments: [this.resource],
    };
  }
}
