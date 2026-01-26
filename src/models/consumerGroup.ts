import * as vscode from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { ERROR_ICON, IconNames } from "../icons";
import { Logger } from "../logging";
import type { IdItem } from "./main";
import { CustomMarkdownString } from "./main";
import type { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";

/**
 * Consumer group states as returned by the Kafka REST API.
 * @see https://kafka.apache.org/20/javadoc/org/apache/kafka/common/ConsumerGroupState.html
 */
export enum ConsumerGroupState {
  Dead = "Dead",
  Empty = "Empty",
  PreparingRebalance = "PreparingRebalance",
  CompletingRebalance = "CompletingRebalance",
  Stable = "Stable",
  Unknown = "Unknown",
}

export function parseConsumerGroupState(state: string): ConsumerGroupState {
  switch (state) {
    case "Dead":
      return ConsumerGroupState.Dead;
    case "Empty":
      return ConsumerGroupState.Empty;
    case "PreparingRebalance":
      return ConsumerGroupState.PreparingRebalance;
    case "CompletingRebalance":
      return ConsumerGroupState.CompletingRebalance;
    case "Stable":
      return ConsumerGroupState.Stable;
    default:
      return ConsumerGroupState.Unknown;
  }
}

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
  isSimple: boolean;

  // https://github.com/confluentinc/vscode/issues/3232
  iconName: IconNames = IconNames.PLACEHOLDER;

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
    const resettableStates = [ConsumerGroupState.Empty, ConsumerGroupState.Dead];
    return resettableStates.includes(this.state);
  }

  searchableText(): string {
    return this.consumerGroupId;
  }

  ccloudUrl(): string {
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

  ccloudUrl(): string {
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
    // "ccloud-consumerGroup-Stable" or "local-consumerGroup-Empty"
    this.contextValue = `${resource.connectionType.toLowerCase()}-consumerGroup-${resource.state}`;

    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    this.description = resource.state;
    this.iconPath = getConsumerGroupIcon(resource);
    this.tooltip = createConsumerGroupTooltip(resource);
  }
}

function getConsumerGroupIcon(group: ConsumerGroup): vscode.ThemeIcon {
  let stateColor: string | undefined;
  switch (group.state) {
    case ConsumerGroupState.Stable:
      // Green for stable/healthy
      stateColor = "testing.iconPassed";
      break;
    case ConsumerGroupState.Empty:
      // Yellow/warning for empty (no active consumers)
      stateColor = "problemsWarningIcon.foreground";
      break;
    case ConsumerGroupState.Dead:
      // Red for dead
      stateColor = "problemsErrorIcon.foreground";
      break;
    case ConsumerGroupState.PreparingRebalance:
    case ConsumerGroupState.CompletingRebalance:
      stateColor = "notificationsInfoIcon.foreground";
      break;
  }
  return new vscode.ThemeIcon(
    group.iconName,
    stateColor ? new vscode.ThemeColor(stateColor) : undefined,
  );
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
    this.tooltip = createConsumerGroupMemberTooltip(resource);
  }
}

/**
 * Create a tooltip for a consumer group member.
 * @param resource The consumer group member resource.
 * @returns A CustomMarkdownString with formatted tooltip content.
 */
function createConsumerGroupMemberTooltip(resource: Consumer): CustomMarkdownString {
  const tooltip = new CustomMarkdownString()
    .addHeader("Consumer", IconNames.PLACEHOLDER)
    .addField("Consumer ID", resource.consumerId)
    .addField("Client ID", resource.clientId)
    .addField("Group", resource.consumerGroupId);

  if (resource.instanceId) {
    tooltip.addField("Instance ID", resource.instanceId);
  }

  return tooltip;
}

// TODO: merge with FlinkDatabaseResourceContainer?

/** Poll interval to use when waiting for a container to finish loading. */
const LOADING_POLL_INTERVAL_MS = 100;

/** A container {@link TreeItem} for consumer groups in the Topics view. */
export class ConsumerGroupContainer extends vscode.TreeItem implements ISearchable {
  readonly connectionId: ConnectionId;
  readonly connectionType: ConnectionType;
  readonly clusterId: string;
  readonly environmentId: EnvironmentId;

  // `id` is string|undefined in TreeItem, but we need it to be a string for IdItem
  id: string;

  private _children: ConsumerGroup[];
  private _isLoading: boolean = false;
  private _hasError: boolean = false;
  private readonly _defaultContextValue: string = "consumerGroups-container";
  private readonly _defaultIcon: vscode.ThemeIcon;

  private logger: Logger;

  constructor(
    connectionId: ConnectionId,
    connectionType: ConnectionType,
    clusterId: string,
    environmentId: EnvironmentId,
    children: ConsumerGroup[] = [],
  ) {
    super("Consumer Groups", vscode.TreeItemCollapsibleState.Collapsed);

    this.connectionId = connectionId;
    this.connectionType = connectionType;
    this.clusterId = clusterId;
    this.environmentId = environmentId;
    this._children = children;

    this.id = `${connectionId}-${clusterId}-consumer-groups`;
    this.contextValue = this._defaultContextValue;
    this._defaultIcon = new vscode.ThemeIcon("symbol-event");
    this.iconPath = this._defaultIcon;

    this.logger = new Logger("models.ConsumerGroupContainer");
  }

  /**
   * Consumer groups belonging to this container.
   * Setting this will clear the internal {@linkcode isLoading} state.
   * If the children array has items, this will also set {@linkcode hasError} to `false`.
   */
  get children(): ConsumerGroup[] {
    return this._children;
  }

  set children(children: ConsumerGroup[]) {
    this._children = children;
    this.isLoading = false;
    this.description = `(${children.length})`;

    if (children.length > 0) {
      this.hasError = false;
    }
  }

  get isLoading(): boolean {
    return this._isLoading;
  }

  set isLoading(loading: boolean) {
    this._isLoading = loading;
    this.iconPath = loading ? new vscode.ThemeIcon(IconNames.LOADING) : this._defaultIcon;
  }

  get hasError(): boolean {
    return this._hasError;
  }

  /** Set or clear the error state for this container. */
  set hasError(error: boolean) {
    this._hasError = error;
    this.iconPath = error ? ERROR_ICON : this._defaultIcon;

    // Append or remove "-error" suffix to context value based on error state
    this.contextValue = error ? `${this._defaultContextValue}-error` : this._defaultContextValue;
  }

  searchableText(): string {
    return "Consumer Groups";
  }

  /** Wait until the container is no longer in a loading state, or timeout after timeoutMs. */
  async ensureDoneLoading(timeoutMs: number = 10000): Promise<void> {
    const startTime = Date.now();

    while (this.isLoading) {
      if (Date.now() - startTime >= timeoutMs) {
        throw new Error("Timeout waiting for container to finish loading");
      }
      await new Promise((resolve) => setTimeout(resolve, LOADING_POLL_INTERVAL_MS));
    }
  }

  /** Get the container's resources, waiting for loading to complete if necessary. */
  async gatherResources(timeoutMs: number = 10000): Promise<ConsumerGroup[]> {
    let resources: ConsumerGroup[] = [];
    try {
      await this.ensureDoneLoading(timeoutMs);
      resources = this.children;
    } catch (error) {
      this.logger.error(`Error getting resources: ${error}`);
    }
    return resources;
  }
}
