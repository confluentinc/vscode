import { Data, type Require as Enforced } from "dataclass";
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import {
  CCLOUD_CONNECTION_ID,
  IconNames,
  LOCAL_CONNECTION_ID,
  UTM_SOURCE_VSCODE,
} from "../constants";
import { CustomMarkdownString } from "./main";
import { ConnectionId, EnvironmentId, IResourceBase, isCCloud, ISearchable } from "./resource";

/** Base class for all KafkaClusters */
export abstract class KafkaCluster extends Data implements IResourceBase, ISearchable {
  abstract connectionId: ConnectionId;
  abstract connectionType: ConnectionType;
  iconName: IconNames = IconNames.KAFKA_CLUSTER;

  abstract name: string;
  abstract environmentId: EnvironmentId | undefined;

  id!: Enforced<string>;
  bootstrapServers!: Enforced<string>;
  uri?: string;

  searchableText(): string {
    return `${this.name} ${this.id}`;
  }
}

/** A Confluent Cloud {@link KafkaCluster} with additional properties. */
export class CCloudKafkaCluster extends KafkaCluster {
  readonly connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Ccloud;

  name!: Enforced<string>;
  provider!: Enforced<string>;
  region!: Enforced<string>;

  // added separately from sidecar responses
  environmentId!: Enforced<EnvironmentId>;

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.environmentId}/clusters/${this.id}?utm_source=${UTM_SOURCE_VSCODE}`;
  }

  get ccloudApiKeysUrl(): string {
    return `https://confluent.cloud/environments/${this.environmentId}/clusters/${this.id}/api-keys?utm_source=${UTM_SOURCE_VSCODE}`;
  }
}

/** A "direct" {@link KafkaCluster} that is configured via webview form. */
export class DirectKafkaCluster extends KafkaCluster {
  readonly connectionId!: Enforced<ConnectionId>; // dynamically assigned at connection creation time
  readonly connectionType: ConnectionType = ConnectionType.Direct;

  name!: Enforced<string>;

  // we only support one Kafka cluster and one Schema Registry per connection, so we can treat the
  // connection ID as the environment ID
  get environmentId(): EnvironmentId {
    return this.connectionId as unknown as EnvironmentId;
  }
}

/** A "local" {@link KafkaCluster} manageable by the extension via Docker. */
export class LocalKafkaCluster extends KafkaCluster {
  readonly connectionId: ConnectionId = LOCAL_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Local;

  name!: Enforced<string>;

  get environmentId(): EnvironmentId {
    return this.connectionId as unknown as EnvironmentId;
  }
}

/** The representation of a {@link KafkaCluster} as a {@link TreeItem} in the VS Code UI. */
export class KafkaClusterTreeItem extends TreeItem {
  resource: KafkaCluster;

  constructor(resource: KafkaCluster) {
    super(resource.name, TreeItemCollapsibleState.None);

    // internal properties
    this.resource = resource;
    // currently only used to determine whether or not we can show the rename command
    this.contextValue = `${this.resource.connectionType.toLowerCase()}-kafka-cluster`;

    // user-facing properties
    this.description = `${this.resource.id}`;
    this.iconPath = new ThemeIcon(this.resource.iconName);
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
export function createKafkaClusterTooltip(resource: KafkaCluster): MarkdownString {
  const tooltip = new CustomMarkdownString()
    .appendMarkdown(`#### $(${resource.iconName}) Kafka Cluster`)
    .appendMarkdown("\n\n---");
  if (resource.name) {
    tooltip.appendMarkdown(`\n\nName: \`${resource.name}\``);
  }
  tooltip
    .appendMarkdown(`\n\nID: \`${resource.id}\``) // TODO: remove this?
    .appendMarkdown(`\n\nBootstrap Servers: \`${resource.bootstrapServers}\``);
  if (resource.uri) {
    tooltip.appendMarkdown(`\n\nURI: \`${resource.uri}\``);
  }
  if (isCCloud(resource)) {
    const ccloudCluster = resource as CCloudKafkaCluster;
    tooltip
      .appendMarkdown(`\n\nProvider: \`${ccloudCluster.provider}\``)
      .appendMarkdown(`\n\nRegion: \`${ccloudCluster.region}\``)
      .appendMarkdown("\n\n---")
      .appendMarkdown(
        `\n\n[$(${IconNames.CONFLUENT_LOGO}) Open in Confluent Cloud](${ccloudCluster.ccloudUrl})`,
      );
  }
  return tooltip;
}
