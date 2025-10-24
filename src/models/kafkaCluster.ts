import { Data, type Require as Enforced } from "dataclass";
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import {
  CCLOUD_BASE_PATH,
  CCLOUD_CONNECTION_ID,
  IconNames,
  LOCAL_CONNECTION_ID,
  UTM_SOURCE_VSCODE,
} from "../constants";
import { localTimezoneOffset } from "../utils/timezone";
import type { CCloudFlinkComputePool } from "./flinkComputePool";
import { FlinkSpecProperties } from "./flinkStatement";
import { CustomMarkdownString } from "./main";
import type {
  ConnectionId,
  EnvironmentId,
  IEnvProviderRegion,
  IResourceBase,
  ISearchable,
} from "./resource";
import { connectionIdToType, isCCloud } from "./resource";
import type { KafkaTopic } from "./topic";

/** Base class for all KafkaClusters */
export abstract class KafkaCluster extends Data implements IResourceBase, ISearchable {
  abstract connectionId: ConnectionId;
  abstract connectionType: ConnectionType;
  iconName: IconNames = IconNames.KAFKA_CLUSTER;

  abstract environmentId: EnvironmentId;

  name!: Enforced<string>;

  id!: Enforced<string>;
  bootstrapServers!: Enforced<string>;
  uri?: string;

  searchableText(): string {
    return `${this.name} ${this.id}`;
  }

  /**
   * Determines if this KafkaCluster is equal to another by comparing connectionId, connectionType, environmentId, and id.
   *
   * (Kafka cluster ids are defined by the brokers themselves, but the user may have multiple connections able
   * to access the same cluster, so we also need to compare connectionId and connectionType to be sure).
   **/
  equals(other: KafkaCluster): boolean {
    return (
      this.connectionId === other.connectionId &&
      this.connectionType === other.connectionType &&
      this.environmentId === other.environmentId &&
      this.id === other.id
    );
  }

  /**
   * Are we the source of this topic?
   */
  contains(topic: KafkaTopic): boolean {
    return (
      this.connectionId === topic.connectionId &&
      this.connectionType === topic.connectionType &&
      this.environmentId === topic.environmentId &&
      this.id === topic.clusterId
    );
  }
}

/** A Confluent Cloud {@link KafkaCluster} with additional properties. */
export class CCloudKafkaCluster extends KafkaCluster {
  readonly connectionId: ConnectionId = CCLOUD_CONNECTION_ID;
  readonly connectionType: ConnectionType = ConnectionType.Ccloud;

  provider!: Enforced<string>;
  region!: Enforced<string>;

  // added separately from sidecar responses
  environmentId!: Enforced<EnvironmentId>;
  flinkPools?: CCloudFlinkComputePool[];

  get ccloudUrl(): string {
    return `https://${CCLOUD_BASE_PATH}/environments/${this.environmentId}/clusters/${this.id}?utm_source=${UTM_SOURCE_VSCODE}`;
  }

  get ccloudApiKeysUrl(): string {
    return `https://${CCLOUD_BASE_PATH}/environments/${this.environmentId}/clusters/${this.id}/api-keys?utm_source=${UTM_SOURCE_VSCODE}`;
  }

  /** Coerce this CCLoudKafkaCluster into a portion needed for submitting Flink statement */
  toFlinkSpecProperties(): FlinkSpecProperties {
    return new FlinkSpecProperties({
      currentDatabase: this.name,
      currentCatalog: this.environmentId,
      localTimezone: localTimezoneOffset(),
    });
  }

  /**
   * Can Flink things be done against this Kafka cluster (aka treat this cluster
   *  as a Flink Database)?
   *
   * Currently, this is determined by whether or not there were any preexisting Flink Compute Pools
   * available in the cloud provider/region of this cluster.
   **/
  isFlinkable(): this is CCloudFlinkDbKafkaCluster {
    return (this.flinkPools?.length ?? 0) > 0;
  }

  /* Are we in the same env/provider/region as other? */
  isSameEnvCloudRegion(other: IEnvProviderRegion): boolean {
    return (
      this.provider.toLowerCase() === other.provider.toLowerCase() &&
      this.region.toLowerCase() === other.region.toLowerCase() &&
      this.environmentId === other.environmentId
    );
  }

  searchableText(): string {
    return `${this.name} ${this.id} ${this.provider}/${this.region}`;
  }
}

/** A specialized {@link CCloudKafkaCluster} with non-empty flinkPools array. */
export type CCloudFlinkDbKafkaCluster = CCloudKafkaCluster & {
  // at least one flink pool must be present.
  flinkPools: [CCloudFlinkComputePool, ...CCloudFlinkComputePool[]];
};

/** A "direct" {@link KafkaCluster} that is configured via webview form. */
export class DirectKafkaCluster extends KafkaCluster {
  readonly connectionId!: Enforced<ConnectionId>; // dynamically assigned at connection creation time
  readonly connectionType: ConnectionType = ConnectionType.Direct;

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

  get environmentId(): EnvironmentId {
    return this.connectionId as unknown as EnvironmentId;
  }
}

/** The concrete subclasses. Excludes the abstract base class which lacks a constructor. */
export type KafkaClusterSubclass =
  | typeof CCloudKafkaCluster
  | typeof DirectKafkaCluster
  | typeof LocalKafkaCluster;

export type KafkaClusterType = CCloudKafkaCluster | DirectKafkaCluster | LocalKafkaCluster;

/** Mapping of connection type to corresponding KafkaCluster subclass */
const kafkaClusterClassByConnectionType: Record<ConnectionType, KafkaClusterSubclass> = {
  [ConnectionType.Ccloud]: CCloudKafkaCluster,
  [ConnectionType.Direct]: DirectKafkaCluster,
  [ConnectionType.Local]: LocalKafkaCluster,
};

/** Returns the appropriate KafkaCluster subclass based on the connection type. */
export function getKafkaClusterClass(connectionId: ConnectionId): KafkaClusterSubclass {
  const connectionType = connectionIdToType(connectionId);
  return kafkaClusterClassByConnectionType[connectionType];
}

/** The representation of a {@link KafkaCluster} as a {@link TreeItem} in the VS Code UI. */
export class KafkaClusterTreeItem extends TreeItem {
  resource: KafkaCluster;

  constructor(resource: KafkaCluster) {
    super(resource.name, TreeItemCollapsibleState.None);

    // internal properties
    this.resource = resource;
    const contextParts = [this.resource.connectionType.toLowerCase()];

    const isCCloudCluster = isCCloud(resource);
    const isFlinkable = isCCloudCluster && (resource as CCloudKafkaCluster).isFlinkable();

    if (isFlinkable) {
      contextParts.push("flinkable");
    }
    contextParts.push("kafka-cluster");
    this.contextValue = contextParts.join("-"); // e.g. "ccloud-flinkable-kafka-cluster" or "direct-kafka-cluster"

    // user-facing properties
    this.description = `${this.resource.id}`;
    this.iconPath = new ThemeIcon(this.resource.iconName);
    this.tooltip = createKafkaClusterTooltip(this.resource);

    // Set accessibility information based on whether cluster is Flinkable
    this.accessibilityInformation = {
      label: `${this.resource.connectionType} connection: Kafka Cluster${isFlinkable ? " (Flink available)" : ""}`,
    };

    // set primary click action to select this cluster as the current one, focusing it in the Topics view
    this.command = {
      command: "confluent.topics.kafka-cluster.select",
      title: "Set Current Kafka Cluster",
      arguments: [this.resource],
    };
  }
}

export function createKafkaClusterTooltip(resource: KafkaCluster): CustomMarkdownString {
  const tooltip = new CustomMarkdownString()
    .addHeader("Kafka Cluster", resource.iconName)
    .addField("Name", resource.name)
    .addField("ID", resource.id)
    .addField("Bootstrap Servers", resource.bootstrapServers)
    .addField("URI", resource.uri);
  if (isCCloud(resource)) {
    const ccloudCluster = resource as CCloudKafkaCluster;
    tooltip
      .addField("Provider", ccloudCluster.provider)
      .addField("Region", ccloudCluster.region)
      .addCCloudLink(ccloudCluster.ccloudUrl);
  }
  return tooltip;
}
