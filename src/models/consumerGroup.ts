import * as vscode from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { IconNames } from "../icons";
import type { IdItem } from "./main";
import { CustomMarkdownString } from "./main";
import type { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";

/**
 * Consumer group states as returned by the Kafka REST API.
 * @see https://kafka.apache.org/20/javadoc/org/apache/kafka/common/ConsumerGroupState.html
 */
export enum ConsumerGroupState {
  Dead = "DEAD",
  Empty = "EMPTY",
  PreparingRebalance = "PREPARING_REBALANCE",
  CompletingRebalance = "COMPLETING_REBALANCE",
  Stable = "STABLE",
  Unknown = "UNKNOWN",
}

/** States where the consumer group has no active consumers and offsets can be reset. */
const INACTIVE_STATES: readonly ConsumerGroupState[] = [
  ConsumerGroupState.Empty,
  ConsumerGroupState.Dead,
];

/** Main class representing a Kafka consumer group. */
export class ConsumerGroup implements IResourceBase, ISearchable, IdItem {
  connectionId: ConnectionId;
  connectionType: ConnectionType;
  environmentId: EnvironmentId;
  clusterId: string;

  /** The broker ID of the group coordinator. */
  coordinatorId: number | null;
  /** The partition assignor strategy (e.g., "range", "roundrobin", "sticky"). */
  partitionAssignor: string;

  consumerGroupId: string;
  state: ConsumerGroupState;
  members: Consumer[] = [];
  /**
   * Whether the group uses manual partition assignment (`assign()`) rather than dynamic
   * group coordination (`subscribe()`). Simple groups only use Kafka for offset storage.
   * @see https://kafka.apache.org/26/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html
   */
  isSimple: boolean;

  iconName: IconNames = IconNames.CONSUMER_GROUP;

  constructor(
    props: Pick<
      ConsumerGroup,
      | "connectionId"
      | "connectionType"
      | "environmentId"
      | "clusterId"
      | "coordinatorId"
      | "partitionAssignor"
      | "consumerGroupId"
      | "state"
      | "members"
      | "isSimple"
    >,
  ) {
    this.connectionId = props.connectionId;
    this.connectionType = props.connectionType;
    this.environmentId = props.environmentId;
    this.clusterId = props.clusterId;

    this.coordinatorId = props.coordinatorId;
    this.partitionAssignor = props.partitionAssignor;

    this.consumerGroupId = props.consumerGroupId;
    this.state = props.state;
    this.members = props.members ?? [];
    this.isSimple = props.isSimple;
  }

  get id(): string {
    return `${this.clusterId}-${this.consumerGroupId}`;
  }

  get hasMembers(): boolean {
    return this.members.length > 0;
  }

  /** Whether the consumer group is in a state that allows offset resets. */
  get canResetOffsets(): boolean {
    return INACTIVE_STATES.includes(this.state);
  }

  searchableText(): string {
    return this.consumerGroupId;
  }

  get ccloudUrl(): string {
    if (this.connectionType !== ConnectionType.Ccloud) {
      return "";
    }
    return `https://confluent.cloud/environments/${this.environmentId}/clusters/${this.clusterId}/clients/consumer-lag/${this.consumerGroupId}`;
  }
}

/** A member (consumer instance) of a {@link ConsumerGroup}. */
export class Consumer implements IResourceBase, ISearchable, IdItem {
  connectionId: ConnectionId;
  connectionType: ConnectionType;
  environmentId: EnvironmentId;
  clusterId: string;
  consumerGroupId: string;

  consumerId: string;
  clientId: string;
  /**
   * Static group membership identifier (`group.instance.id`), or null if not configured.
   * @see https://kafka.apache.org/26/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html
   */
  instanceId: string | null;

  // https://github.com/confluentinc/vscode/issues/3233
  iconName: IconNames = IconNames.PLACEHOLDER;

  constructor(
    props: Pick<
      Consumer,
      | "connectionId"
      | "connectionType"
      | "environmentId"
      | "clusterId"
      | "consumerGroupId"
      | "consumerId"
      | "clientId"
      | "instanceId"
    >,
  ) {
    this.connectionId = props.connectionId;
    this.connectionType = props.connectionType;
    this.environmentId = props.environmentId;
    this.clusterId = props.clusterId;
    this.consumerGroupId = props.consumerGroupId;

    this.consumerId = props.consumerId;
    this.clientId = props.clientId;
    this.instanceId = props.instanceId ?? null;
  }

  get id(): string {
    return `${this.clusterId}-${this.consumerGroupId}-${this.consumerId}`;
  }

  searchableText(): string {
    return `${this.consumerId} ${this.clientId}`;
  }

  get ccloudUrl(): string {
    if (this.connectionType !== ConnectionType.Ccloud) {
      return "";
    }
    return `https://confluent.cloud/environments/${this.environmentId}/clusters/${this.clusterId}/clients/consumers/${this.clientId}`;
  }
}

/** Tree item representation for a {@link ConsumerGroup}. */
export class ConsumerGroupTreeItem extends vscode.TreeItem {
  resource: ConsumerGroup;

  constructor(resource: ConsumerGroup) {
    super(resource.consumerGroupId);

    this.id = resource.id;
    this.resource = resource;
    // includes state for conditional menu visibility, like:
    // "ccloud-consumerGroup-STABLE" or "local-consumerGroup-EMPTY"
    this.contextValue = `${resource.connectionType.toLowerCase()}-consumerGroup-${resource.state}`;

    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    this.description = resource.state;

    const isInactive = INACTIVE_STATES.includes(resource.state);
    this.iconPath = new vscode.ThemeIcon(
      resource.iconName,
      isInactive ? new vscode.ThemeColor("problemsWarningIcon.foreground") : undefined,
    );

    this.tooltip = createConsumerGroupTooltip(resource);
  }
}

function createConsumerGroupTooltip(resource: ConsumerGroup): CustomMarkdownString {
  const tooltip = new CustomMarkdownString()
    .addHeader("Consumer Group", resource.iconName)
    .addField("Group ID", resource.consumerGroupId)
    .addField("State", resource.state)
    .addField("Partition Assignor", resource.partitionAssignor)
    .addField("Simple Consumer", resource.isSimple ? "Yes" : "No");

  if (resource.coordinatorId !== null) {
    tooltip.addField("Coordinator Broker", resource.coordinatorId.toString());
  }

  if (resource.hasMembers) {
    tooltip.addField("Members", resource.members.length.toString());
  }

  // warnings for non-stable states
  if (resource.state === ConsumerGroupState.Empty) {
    tooltip.addWarning("No active consumers in this group.");
  } else if (resource.state === ConsumerGroupState.Dead) {
    tooltip.addWarning("Consumer group is dead and will be removed.");
  } else if (
    resource.state === ConsumerGroupState.PreparingRebalance ||
    resource.state === ConsumerGroupState.CompletingRebalance
  ) {
    tooltip.addWarning("Consumer group is currently rebalancing.");
  }

  tooltip.addCCloudLink(resource.ccloudUrl);

  return tooltip;
}

/** Tree item representation for a {@link Consumer}. */
export class ConsumerTreeItem extends vscode.TreeItem {
  resource: Consumer;

  constructor(resource: Consumer) {
    const label = resource.clientId
      ? `${resource.consumerId} (client: ${resource.clientId})`
      : resource.consumerId;
    super(label);

    this.id = resource.id;
    this.resource = resource;
    this.contextValue = `${resource.connectionType.toLowerCase()}-consumerGroup-member`;

    this.collapsibleState = vscode.TreeItemCollapsibleState.None;

    this.iconPath = new vscode.ThemeIcon(resource.iconName);
    this.tooltip = createConsumerTooltip(resource);
  }
}

function createConsumerTooltip(resource: Consumer): CustomMarkdownString {
  const tooltip = new CustomMarkdownString()
    .addHeader("Consumer", IconNames.PLACEHOLDER)
    .addField("Consumer ID", resource.consumerId)
    .addField("Client ID", resource.clientId)
    .addField("Group", resource.consumerGroupId);

  if (resource.instanceId) {
    tooltip.addField("Instance ID", resource.instanceId);
  }

  tooltip.addCCloudLink(resource.ccloudUrl);

  return tooltip;
}
