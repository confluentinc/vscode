import { type Require as Enforced } from "dataclass";
import * as vscode from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames, LOCAL_CONNECTION_ID } from "../constants";
import { CustomMarkdownString } from "./main";
import { ConnectionId, ResourceBase } from "./resource";

/** Base class for all KafkaClusters */
export abstract class KafkaCluster extends ResourceBase {
  abstract name: string;
  abstract environmentId: string | undefined;
  iconName: IconNames = IconNames.KAFKA_CLUSTER;

  id!: Enforced<string>;
  bootstrapServers!: Enforced<string>;
  uri?: string;
}

/** A Confluent Cloud {@link KafkaCluster} with additional properties. */
export class CCloudKafkaCluster extends KafkaCluster {
  readonly connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  readonly connectionType: ConnectionType = "CCLOUD";

  name!: Enforced<string>;
  provider!: Enforced<string>;
  region!: Enforced<string>;

  // added separately from sidecar responses
  environmentId!: Enforced<string>;

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.environmentId}/clusters/${this.id}`;
  }
}

/** A "direct" {@link KafkaCluster} that is configured via webview form. */
export class DirectKafkaCluster extends KafkaCluster {
  // `connectionId` dynamically assigned at connection creation time
  readonly connectionType: ConnectionType = "DIRECT";

  name!: Enforced<string>;

  // we only support one Kafka cluster and one Schema Registry per connection, so we can treat the
  // connection ID as the environment ID
  get environmentId(): string {
    return this.connectionId;
  }
}

/** A "local" {@link KafkaCluster} manageable by the extension via Docker. */
export class LocalKafkaCluster extends KafkaCluster {
  readonly connectionId: ConnectionId = LOCAL_CONNECTION_ID;
  readonly connectionType: ConnectionType = "LOCAL";
  readonly environmentId: undefined = undefined;

  // this is solely for display purposes so we don't have to check whether a resource is either a
  // LocalKafkaCluster or CCloudKafkaCluster when generating a label for a tree/quickpick/etc item
  readonly name: string = "Local";
}

/** The representation of a {@link KafkaCluster} as a {@link vscode.TreeItem} in the VS Code UI. */
export class KafkaClusterTreeItem extends vscode.TreeItem {
  resource: KafkaCluster;

  constructor(resource: KafkaCluster) {
    super(resource.name, vscode.TreeItemCollapsibleState.None);

    // internal properties
    this.resource = resource;
    // currently only used to determine whether or not we can show the rename command
    this.contextValue = `${this.resource.contextPrefix}-kafka-cluster`;

    // user-facing properties
    this.description = `${this.resource.id}`;
    this.iconPath = new vscode.ThemeIcon(this.resource.iconName);
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
      .appendMarkdown(`#### $(${resource.iconName}) Confluent Cloud Kafka Cluster`)
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
  } else if (resource.isLocal) {
    const localCluster = resource as LocalKafkaCluster;
    tooltip
      .appendMarkdown(`#### $(${IconNames.KAFKA_CLUSTER}) Local Kafka Cluster`)
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(`ID: \`${localCluster.id}\`\n\n`)
      .appendMarkdown(`Bootstrap Servers: \`${localCluster.bootstrapServers}\`\n\n`)
      .appendMarkdown(`URI: \`${localCluster.uri}\``);
  } else {
    const directCluster = resource as DirectKafkaCluster;
    tooltip
      .appendMarkdown(`#### $(${IconNames.KAFKA_CLUSTER}) Kafka Cluster`)
      .appendMarkdown("\n\n---\n\n")
      .appendMarkdown(`ID: \`${directCluster.id}\`\n\n`)
      .appendMarkdown(`Name: \`${directCluster.name}\`\n\n`)
      .appendMarkdown(`Bootstrap Servers: \`${directCluster.bootstrapServers}\``);
  }
  return tooltip;
}
