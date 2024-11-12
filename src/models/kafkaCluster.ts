import { Data, type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { CustomMarkdownString } from "./main";

/** Base class for all KafkaClusters, be they local or be they CCloud */
export abstract class KafkaCluster extends Data {
  abstract readonly connectionId: string;
  abstract readonly isLocal: boolean;
  abstract readonly isCCloud: boolean;

  abstract name: string;

  id!: Enforced<string>;
  bootstrapServers!: Enforced<string>;
  uri!: Enforced<string>;
}

/** A local Kafka cluster */
export class LocalKafkaCluster extends KafkaCluster {
  readonly connectionId: string = LOCAL_CONNECTION_ID;
  readonly isLocal: boolean = true;
  readonly isCCloud: boolean = false;

  // this is solely for display purposes so we don't have to check whether a resource is either a
  // LocalKafkaCluster or CCloudKafkaCluster when generating a label for a tree/quickpick/etc item
  readonly name: string = "Local";
}

/** A CCloud Kafka cluster */
export class CCloudKafkaCluster extends KafkaCluster {
  readonly connectionId: string = CCLOUD_CONNECTION_ID;
  readonly isLocal: boolean = false;
  readonly isCCloud: boolean = true;

  name!: Enforced<string>;
  provider!: Enforced<string>;
  region!: Enforced<string>;
  // added separately from sidecar responses
  environmentId!: Enforced<string>;

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.environmentId}/clusters/${this.id}`;
  }
}

// Main class controlling the representation of a Kafka cluster as a tree item.
export class KafkaClusterTreeItem extends vscode.TreeItem {
  resource: KafkaCluster;

  constructor(resource: KafkaCluster) {
    super(resource.name, vscode.TreeItemCollapsibleState.None);

    // internal properties
    this.resource = resource;
    // currently only used to determine whether or not we can show the rename command
    this.contextValue = this.resource.isLocal ? "local-kafka-cluster" : "ccloud-kafka-cluster";

    // user-facing properties
    this.description = `${this.resource.id}`;
    this.iconPath = new vscode.ThemeIcon(IconNames.KAFKA_CLUSTER);
    this.tooltip = createKafkaClusterTooltip(this.resource);

    // set primary click action to select this cluster as the current one, focusing it in the Topics view
    this.command = {
      command: "confluent.resources.kafka-cluster.select",
      title: "Set Current Kafka Cluster",
      arguments: [this.resource],
    };
  }
}

// todo make this a method of KafkaCluster family.
function createKafkaClusterTooltip(resource: KafkaCluster): vscode.MarkdownString {
  const tooltip = new CustomMarkdownString();
  if (resource.isCCloud) {
    const ccloudCluster = resource as CCloudKafkaCluster;
    tooltip
      .appendMarkdown(`#### $(${IconNames.KAFKA_CLUSTER}) Confluent Cloud Kafka Cluster`)
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(`ID: \`${ccloudCluster.id}\`\n\n`)
      .appendMarkdown(`Name: \`${ccloudCluster.name}\`\n\n`)
      .appendMarkdown(`Provider: \`${ccloudCluster.provider}\`\n\n`)
      .appendMarkdown(`Region: \`${ccloudCluster.region}\`\n\n`)
      .appendMarkdown(`Bootstrap Servers: \`${ccloudCluster.bootstrapServers}\``)
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(
        `[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${ccloudCluster.ccloudUrl})`,
      );
  } else {
    const localCluster = resource as LocalKafkaCluster;
    tooltip
      .appendMarkdown(`#### $(${IconNames.KAFKA_CLUSTER}) Local Kafka Cluster`)
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(`ID: \`${localCluster.id}\`\n\n`)
      .appendMarkdown(`Bootstrap Servers: \`${localCluster.bootstrapServers}\`\n\n`)
      .appendMarkdown(`URI: \`${localCluster.uri}\``);
  }
  return tooltip;
}
