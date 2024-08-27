import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";

// Main class representing CCloud environments, matching key/value pairs returned
// by the `confluent environment list` command.
export class CCloudEnvironment extends Data {
  readonly connectionId: string = CCLOUD_CONNECTION_ID;

  id!: Enforced<string>;
  name!: Enforced<string>;
  stream_governance_package!: Enforced<string>;

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.id}/clusters`;
  }
}

// Tree item representing a CCloud environment on top an instance of CloudEnvironment
export class CCloudEnvironmentTreeItem extends vscode.TreeItem {
  resource: CCloudEnvironment;

  constructor(resource: CCloudEnvironment) {
    super(resource.name, vscode.TreeItemCollapsibleState.Collapsed);

    this.resource = resource;

    this.contextValue = "ccloud-environment";
    this.tooltip = JSON.stringify(this.resource, null, 2);
    this.description = this.resource.id;

    this.iconPath = new vscode.ThemeIcon(IconNames.CCLOUD_ENVIRONMENT);
  }
}
