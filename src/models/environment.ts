import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
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
  id: Enforced<string> = this.connectionId;

  connectionType?: string;
  kafkaCluster?: DirectKafkaCluster | undefined;
  schemaRegistry?: DirectSchemaRegistry | undefined;

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

// Tree item representing one of the above Environment subclasses
// TODO: update this for LocalEnvironment
export class EnvironmentTreeItem extends vscode.TreeItem {
  resource: CCloudEnvironment | DirectEnvironment;

  constructor(resource: CCloudEnvironment | DirectEnvironment) {
    // If has interior clusters, is collapsed and can be expanded.
    const collapseState = resource.hasClusters
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    super(resource.name, collapseState);

    // internal properties
    this.resource = resource;
    if (this.resource.isCCloud) {
      this.contextValue = "ccloud-environment";
    } else if (this.resource.isDirect) {
      this.contextValue = "direct-environment";
    }

    // user-facing properties
    this.description = this.resource.id;
    // TODO: figure out an icon for Local/Direct?
    this.iconPath = new vscode.ThemeIcon(IconNames.CCLOUD_ENVIRONMENT);
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
