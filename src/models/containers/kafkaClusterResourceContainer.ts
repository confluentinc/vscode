import type { ThemeIcon } from "vscode";
import type { ConnectionType } from "../../clients/sidecar";
import type { ConnectionId, EnvironmentId, ISearchable } from "../resource";
import { ResourceContainer } from "./resourceContainer";

/** A container {@link TreeItem} for resources to display in the Topics view. */

export class KafkaClusterResourceContainer<T extends ISearchable> extends ResourceContainer<T> {
  readonly connectionId: ConnectionId;
  readonly connectionType: ConnectionType;
  readonly clusterId: string;
  readonly environmentId: EnvironmentId;

  get loggerName() {
    return `models.KafkaClusterResourceContainer(${this.label})`;
  }

  constructor(
    connectionId: ConnectionId,
    connectionType: ConnectionType,
    clusterId: string,
    environmentId: EnvironmentId,
    label: string,
    children: T[] = [],
    contextValue?: string,
    icon?: ThemeIcon,
  ) {
    super(label, children, contextValue, icon);

    // convert label to hyphenated id:
    // "Consumer Groups" → "consumer-groups", "Topics" → "topics"
    const suffix = label.toLowerCase().replace(/\s+/g, "-");
    this.id = `${connectionId}-${clusterId}-${suffix}`;

    this.connectionId = connectionId;
    this.connectionType = connectionType;
    this.clusterId = clusterId;
    this.environmentId = environmentId;
  }
}
