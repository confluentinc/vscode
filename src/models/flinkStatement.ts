import { ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import {
  CreateSqlv1Statement201Response,
  SqlV1StatementListDataInner,
  SqlV1StatementMetadata,
  SqlV1StatementSpec,
  SqlV1StatementStatus,
} from "../clients/flinkSql";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames, UTM_SOURCE_VSCODE } from "../constants";
import { CustomMarkdownString, IdItem } from "./main";
import {
  ConnectionId,
  EnvironmentId,
  IResourceBase,
  ISearchable,
  OrganizationId,
} from "./resource";

/**
 * Model for a Flink statement.
 */
export class FlinkStatement implements IResourceBase, IdItem, ISearchable {
  connectionId!: ConnectionId;
  connectionType!: ConnectionType;
  environmentId!: EnvironmentId;
  organizationId!: OrganizationId;

  name: string;
  metadata: SqlV1StatementMetadata | undefined;
  status: SqlV1StatementStatus;
  spec: SqlV1StatementSpec;

  // TODO: add more properties as needed

  constructor(
    props: Pick<
      FlinkStatement,
      | "connectionId"
      | "connectionType"
      | "environmentId"
      | "organizationId"
      | "spec"
      | "name"
      | "metadata"
      | "status"
    >,
  ) {
    this.connectionId = props.connectionId;
    this.connectionType = props.connectionType;
    this.environmentId = props.environmentId;
    this.organizationId = props.organizationId;
    this.spec = props.spec;
    this.name = props.name;
    this.metadata = props.metadata;
    this.status = props.status;
  }

  searchableText(): string {
    return `${this.name} ${this.phase} ${this.sqlKindDisplay}`;
  }

  /** The flink compute pool that maybe is running/ran the statement. */
  get computePoolId(): string | undefined {
    return this.spec.compute_pool_id;
  }

  get sqlStatement(): string | undefined {
    return this.spec.statement;
  }

  /**
   * Return the name of the statement as its id.
   * This is guaranteed to be unique within the environment, per API docs.
   */
  get id(): string {
    return this.name;
  }

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.environmentId}/flink/statements/${this.id}/activity?utm_source=${UTM_SOURCE_VSCODE}`;
  }

  get phase(): string {
    return this.status.phase;
  }

  get sqlKindDisplay(): string | undefined {
    return this.status.traits?.sql_kind?.replace(/_/g, " ");
  }

  get sqlKind(): string | undefined {
    return this.status.traits?.sql_kind;
  }

  get createdAt(): Date | undefined {
    return this.metadata?.created_at;
  }

  get updatedAt(): Date | undefined {
    return this.metadata?.updated_at;
  }
}

/** Model for the interesting bits of the `metadata` subfield of Flink statement. */
export class FlinkStatementMetadata {
  createdAt?: Date;
  updatedAt?: Date;
  // Need to see example of labels to know how they are structured.

  constructor(props: Pick<FlinkStatementMetadata, "createdAt" | "updatedAt">) {
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
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

    // (Sometimes sqlKindDisplay is undefined, e.g. for failed statements)
    this.description = resource.sqlKindDisplay
      ? `${resource.phase} ${resource.sqlKindDisplay}`
      : resource.phase;
    this.iconPath = this.getThemeIcon();

    this.tooltip = CustomMarkdownString.resourceTooltip(
      "Flink Statement",
      this.iconPath.id as IconNames,
      resource.ccloudUrl,
      [
        ["Kind", resource.sqlKindDisplay],
        ["Status", resource.phase],
        ["Created At", resource.createdAt?.toLocaleString()],
        ["Updated At", resource.updatedAt?.toLocaleString()],
        ["Environment", resource.environmentId],
        ["Compute Pool", resource.computePoolId],
        ["Detail", resource.status.detail],
      ],
    );

    this.command = {
      command: "confluent.statements.viewstatementsql",
      title: "View SQL",
      arguments: [this.resource],
    };
  }

  /**
   * Determine icon + color based on the `phase` of the statement.
   */
  getThemeIcon(): ThemeIcon {
    switch (this.resource.phase.toUpperCase()) {
      case FAILED_PHASE:
      case FAILING_PHASE:
        return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_FAILED, STATUS_RED);
      case DEGRADED_PHASE:
        return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_DEGRADED, STATUS_YELLOW);
      case RUNNING_PHASE:
        return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_RUNNING, STATUS_GREEN);
      case COMPLETED_PHASE:
        return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_COMPLETED, STATUS_GRAY);
      case DELETING_PHASE:
      case STOPPING_PHASE:
        return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_DELETING, STATUS_GRAY);
      case STOPPED_PHASE:
        return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_STOPPED, STATUS_BLUE);
      case PENDING_PHASE:
        return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_PENDING, STATUS_BLUE);
      default:
        return new ThemeIcon(IconNames.FLINK_STATEMENT);
    }
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

// Statement phases
export const RUNNING_PHASE = "RUNNING";
export const DEGRADED_PHASE = "DEGRADED";
export const COMPLETED_PHASE = "COMPLETED";
export const STOPPING_PHASE = "STOPPING";
export const STOPPED_PHASE = "STOPPED";
export const FAILED_PHASE = "FAILED";
export const FAILING_PHASE = "FAILING";
export const DELETING_PHASE = "DELETING";
export const PENDING_PHASE = "PENDING";

export const TERMINAL_PHASES = [COMPLETED_PHASE, FAILED_PHASE, STOPPED_PHASE];

/** Convert a from-REST API depiction of a Flink statement to our codebase's FlinkStatement model. */
export function restFlinkStatementToModel(
  restFlinkStatement: SqlV1StatementListDataInner | CreateSqlv1Statement201Response,
): FlinkStatement {
  return new FlinkStatement({
    connectionId: CCLOUD_CONNECTION_ID,
    connectionType: ConnectionType.Ccloud,
    environmentId: restFlinkStatement.environment_id as EnvironmentId,
    organizationId: restFlinkStatement.organization_id as OrganizationId,
    name: restFlinkStatement.name!,
    spec: restFlinkStatement.spec,
    metadata: restFlinkStatement.metadata,
    status: restFlinkStatement.status,
  });
}
