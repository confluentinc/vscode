import { ThemeIcon } from "vscode";
import type { ConnectionType } from "../../clients/sidecar";
import { IconNames } from "../../icons";
import type { ConsumerGroup } from "../consumerGroup";
import type { ConnectionId, EnvironmentId } from "../resource";
import { ResourceContainer } from "./resourceContainer";

/** A container {@link TreeItem} for consumer groups in the Topics view. */
export class ConsumerGroupContainer extends ResourceContainer<ConsumerGroup> {
  readonly loggerName = "models.ConsumerGroupContainer";

  readonly connectionId: ConnectionId;
  readonly connectionType: ConnectionType;
  readonly clusterId: string;
  readonly environmentId: EnvironmentId;

  constructor(
    connectionId: ConnectionId,
    connectionType: ConnectionType,
    clusterId: string,
    environmentId: EnvironmentId,
    children: ConsumerGroup[] = [],
  ) {
    super(
      "Consumer Groups",
      children,
      "consumerGroups-container",
      new ThemeIcon(IconNames.CONSUMER_GROUP),
    );
    this.id = `${connectionId}-${clusterId}-consumer-groups`;

    this.connectionId = connectionId;
    this.connectionType = connectionType;
    this.clusterId = clusterId;
    this.environmentId = environmentId;
  }
}
