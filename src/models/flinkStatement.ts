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

  name!: string;
  status!: string;

  // TODO: add more properties as needed

  constructor(
    props: Pick<
      FlinkStatement,
      "connectionId" | "connectionType" | "environmentId" | "computePoolId" | "name" | "status"
    >,
  ) {
    this.connectionId = props.connectionId;
    this.connectionType = props.connectionType;
    this.environmentId = props.environmentId;
    this.computePoolId = props.computePoolId;
    this.name = props.name;
    this.status = props.status;
  }

  searchableText(): string {
    return `${this.name} ${this.status}`;
  }

  /**
   * Return the name of the statement as its id.
   * This is guaranteed to be unique within the environment, per API docs.
   */
  get id(): string {
    return this.name;
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

// themes will override these colors, but in the default VS Code dark/light theme, these variable
// names should be accurate for the assigned theme color
// see https://code.visualstudio.com/api/references/theme-color
export const STATUS_RED = new ThemeColor("notificationsErrorIcon.foreground");
export const STATUS_YELLOW = new ThemeColor("notificationsWarningIcon.foreground");
export const STATUS_BLUE = new ThemeColor("notificationsInfoIcon.foreground");
// there aren't as many green or gray options to choose from without using `chart` colors
export const STATUS_GREEN = new ThemeColor("charts.green");
export const STATUS_GRAY = new ThemeColor("charts.lines");

export function createFlinkStatementIcon(status: string): ThemeIcon {
  switch (status.toUpperCase()) {
    case "FAILED":
    case "FAILING":
      return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_FAILED, STATUS_RED);
    case "DEGRADED":
      return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_DEGRADED, STATUS_YELLOW);
    case "RUNNING":
      return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_RUNNING, STATUS_GREEN);
    case "COMPLETED":
      return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_COMPLETED, STATUS_GRAY);
    case "DELETING":
    case "STOPPING":
      return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_DELETING, STATUS_GRAY);
    case "STOPPED":
      return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_STOPPED, STATUS_BLUE);
    case "PENDING":
      return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_PENDING, STATUS_BLUE);
    default:
      return new ThemeIcon(IconNames.FLINK_STATEMENT);
  }
}
