import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";
import { CustomMarkdownString } from "./main";

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
    this.description = this.resource.id;

    this.iconPath = new vscode.ThemeIcon(IconNames.CCLOUD_ENVIRONMENT);

    this.tooltip = new CustomMarkdownString()
      .appendMarkdown(`Name: \`${this.resource.name}\`\n\n`)
      .appendMarkdown(`ID: \`${this.resource.id}\`\n\n`)
      .appendMarkdown(
        `Stream Governance Package: \`${this.resource.stream_governance_package}\`\n\n`,
      )
      .appendMarkdown("---\n\n")
      .appendMarkdown(`[Open in Confluent Cloud](${this.resource.ccloudUrl})`);
  }
}
