import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { CustomMarkdownString } from "./main";

/**
 * Base class between local and ccloud environments, and possibly
 * direct connections in the future.
 *
 * An environment is a distinct collection of resources, namely
 * Kafka clusters, a possible Schema Registry, and perhaps more
 * things in the future such as Flink clusters.
 *
 */
export abstract class Environment extends Data {
  abstract readonly isLocal: boolean;
  abstract readonly isCCloud: boolean;

  id!: Enforced<string>;
  name!: Enforced<string>;

  /**
   * Has at least one Kafka cluster or Schema Registry.
   *
   * CCloud environemts may have neither (yet), but we still want to show
   * them in the tree.
   */
  abstract hasClusters: boolean;

  // It would seem natural for the Environment to have a list of clusters,
  // optional schema registry, and so on, but this hasn't grown to be
  // the case yet.
}

/** Representation of a group of resources in CCLoud */
export class CCloudEnvironment extends Environment {
  readonly connectionId: string = CCLOUD_CONNECTION_ID;
  readonly isLocal: boolean = false;
  readonly isCCloud: boolean = true;

  streamGovernancePackage!: Enforced<string>;
  hasClusters!: Enforced<boolean>;

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.id}/clusters`;
  }
}

/** Class representing the local / Docker resource group. */
export class LocalEnvironment extends Environment {
  readonly connectionId: string = LOCAL_CONNECTION_ID;
  readonly isLocal: boolean = true;
  readonly isCCloud: boolean = false;

  // If we have a local connection, we have at least one Kafka cluster.
  readonly hasClusters: boolean = true;
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
