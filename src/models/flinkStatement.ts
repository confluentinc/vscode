import { ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { IconNames } from "../constants";
import { IdItem } from "./main";
import { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";

export class FlinkStatement implements IResourceBase, IdItem, ISearchable {
  connectionId!: ConnectionId;
  connectionType!: ConnectionType;
  iconName: IconNames = IconNames.FLINK_STATEMENT;

  environmentId!: EnvironmentId;
  computePoolId!: string;

  id!: string;
  status!: string;

  // TODO: add more properties as needed

  constructor(
    props: Pick<
      FlinkStatement,
      "connectionId" | "connectionType" | "environmentId" | "computePoolId" | "id" | "status"
    >,
  ) {
    this.connectionId = props.connectionId;
    this.connectionType = props.connectionType;
    this.environmentId = props.environmentId;
    this.computePoolId = props.computePoolId;
    this.id = props.id;
    this.status = props.status;
  }

  searchableText(): string {
    return `${this.id} ${this.status}`;
  }
}

export class FlinkStatementTreeItem extends TreeItem {
  resource: FlinkStatement;

  constructor(resource: FlinkStatement) {
    super(resource.id, TreeItemCollapsibleState.None);

    // internal properties
    this.id = resource.id;
    this.resource = resource;
    this.contextValue = `${resource.connectionType.toLowerCase()}-flink-statement`;

    // user-facing properties
    this.iconPath = createFlinkStatementIcon(resource.status);
    this.description = resource.status;

    // TODO: add tooltip
  }
}

export function createFlinkStatementIcon(status: string): ThemeIcon {
  switch (status.toUpperCase()) {
    case "COMPLETED":
      return new ThemeIcon(
        IconNames.FLINK_STATEMENT_STATUS_COMPLETED,
        new ThemeColor("charts.lines"), // grayish
      );
    case "RUNNING":
      return new ThemeIcon(
        IconNames.FLINK_STATEMENT_STATUS_RUNNING,
        new ThemeColor("charts.green"), // greenish
      );
    case "FAILED":
    case "FAILING":
      return new ThemeIcon(
        IconNames.FLINK_STATEMENT_STATUS_FAILED,
        new ThemeColor("notificationsErrorIcon.foreground"), // red
      );
    case "DEGRADED":
      return new ThemeIcon(
        IconNames.FLINK_STATEMENT_STATUS_DEGRADED,
        new ThemeColor("notificationsWarningIcon.foreground"), // yellowish
      );
    case "DELETING":
    case "STOPPING":
      return new ThemeIcon(
        IconNames.FLINK_STATEMENT_STATUS_DELETING,
        new ThemeColor("charts.lines"), // grayish
      );
    case "STOPPED":
      return new ThemeIcon(
        IconNames.FLINK_STATEMENT_STATUS_STOPPED,
        new ThemeColor("charts.blue"), // blueish
      );
    case "PENDING":
      return new ThemeIcon(
        IconNames.FLINK_STATEMENT_STATUS_PENDING,
        new ThemeColor("charts.blue"), // blueish
      );
    default:
      throw new Error(`Unknown Flink statement status: ${status}`);
  }
}
