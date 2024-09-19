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
  streamGovernancePackage!: Enforced<string>;
  /** Has at least one Kafka or Schema Registry Cluster */
  hasClusters!: Enforced<boolean>;

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.id}/clusters`;
  }
}

// Tree item representing a CCloud environment on top an instance of CloudEnvironment
export class CCloudEnvironmentTreeItem extends vscode.TreeItem {
  resource: CCloudEnvironment;

  constructor(resource: CCloudEnvironment) {
    // If has interior clusters, is collapsed and can be expanded.
    const collapseState = resource.hasClusters
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    super(resource.name, collapseState);

    // internal properties
    this.resource = resource;
    this.contextValue = "ccloud-environment";

    // user-facing properties
    this.description = this.resource.id;
    this.iconPath = new vscode.ThemeIcon(IconNames.CCLOUD_ENVIRONMENT);
    this.tooltip = createEnvironmentTooltip(this.resource);
  }
}

function createEnvironmentTooltip(resource: CCloudEnvironment): vscode.MarkdownString {
  const tooltip = new CustomMarkdownString()
    .appendMarkdown(`#### $(${IconNames.CCLOUD_ENVIRONMENT}) Confluent Cloud Environment`)
    .appendMarkdown("\n\n---\n\n")
    .appendMarkdown(`ID: \`${resource.id}\`\n\n`)
    .appendMarkdown(`Name: \`${resource.name}\`\n\n`)
    .appendMarkdown(`Stream Governance Package: \`${resource.streamGovernancePackage}\``)
    .appendMarkdown("\n\n---\n\n")
    .appendMarkdown(
      `[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${resource.ccloudUrl})`,
    );
  return tooltip;
}
