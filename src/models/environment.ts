import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { DirectKafkaCluster } from "./kafkaCluster";
import { CustomMarkdownString } from "./main";
import { DirectSchemaRegistry } from "./schemaRegistry";

/**
 * Base class for an environment, which is a distinct collection of resources, primarily Kafka
 * clusters, possible Schema Registry, and perhaps more things in the future such as Flink clusters.
 */
export abstract class Environment extends Data {
  abstract connectionId: string | undefined;
  abstract readonly isCCloud: boolean;
  abstract readonly isDirect: boolean;
  abstract readonly isLocal: boolean;

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
  readonly isCCloud: boolean = true;
  readonly isDirect: boolean = false;
  readonly isLocal: boolean = false;

  streamGovernancePackage!: Enforced<string>;
  hasClusters!: Enforced<boolean>;

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.id}/clusters`;
  }
}

/** Representation of a "direct" connection to a Kafka cluster and/or Schema Registry */
export class DirectEnvironment extends Environment {
  readonly isCCloud: boolean = false;
  readonly isDirect: boolean = true;
  readonly isLocal: boolean = false;

  connectionId!: Enforced<string>; // dynamically assigned at connection creation time
  connectionType!: Enforced<ConnectionType>;
  kafkaCluster?: DirectKafkaCluster | undefined;
  schemaRegistry?: DirectSchemaRegistry | undefined;
  id: Enforced<string> = this.connectionId;

  get hasClusters(): boolean {
    return !!(this.kafkaCluster || this.schemaRegistry);
  }
}

/** Class representing the local / Docker resource group. */
export class LocalEnvironment extends Environment {
  readonly connectionId: string = LOCAL_CONNECTION_ID;
  readonly isCCloud: boolean = false;
  readonly isDirect: boolean = false;
  readonly isLocal: boolean = true;

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

export class DirectEnvironmentTreeItem extends vscode.TreeItem {
  resource: DirectEnvironment;

  constructor(resource: DirectEnvironment) {
    // If has interior clusters, is collapsed and can be expanded.
    const collapseState = resource.hasClusters
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    super(resource.name, collapseState);

    // internal properties
    this.resource = resource;
    this.contextValue = "direct-environment";

    // user-facing properties
    this.description = this.resource.id;
    // TODO: change icons based on connection type
    this.iconPath = new vscode.ThemeIcon(IconNames.CONFLUENT_LOGO);
    this.tooltip = createEnvironmentTooltip(this.resource);
  }
}

function createEnvironmentTooltip(
  resource: CCloudEnvironment | DirectEnvironment,
): vscode.MarkdownString {
  const tooltip = new CustomMarkdownString();
  if (resource.isCCloud) {
    const ccloudEnv = resource as CCloudEnvironment;
    tooltip
      .appendMarkdown(`#### $(${IconNames.CCLOUD_ENVIRONMENT}) Confluent Cloud Environment`)
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(`ID: \`${ccloudEnv.id}\`\n\n`)
      .appendMarkdown(`Name: \`${ccloudEnv.name}\`\n\n`)
      .appendMarkdown(`Stream Governance Package: \`${ccloudEnv.streamGovernancePackage}\``)
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(
        `[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${ccloudEnv.ccloudUrl})`,
      );
  } else if (resource.isDirect) {
    const directEnv = resource as DirectEnvironment;
    tooltip
      .appendMarkdown(`#### $(${IconNames.CONFLUENT_LOGO}) Direct Connection`)
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(`ID: \`${directEnv.id}\`\n\n`)
      .appendMarkdown(`Name: \`${directEnv.name}\``);
  }
  return tooltip;
}
