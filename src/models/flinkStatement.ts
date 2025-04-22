import { ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { IconNames, UTM_SOURCE_VSCODE } from "../constants";
import { CustomMarkdownString, IdItem } from "./main";
import { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";

/**
 * Model for a Flink statement.
 */
export class FlinkStatement implements IResourceBase, IdItem, ISearchable {
  connectionId!: ConnectionId;
  connectionType!: ConnectionType;
  environmentId!: EnvironmentId;

  name: string;
  metadata: FlinkStatementMetadata;
  status: FlinkStatementStatus;
  spec: FlinkStatementSpec;

  // TODO: add more properties as needed

  constructor(
    props: Pick<
      FlinkStatement,
      "connectionId" | "connectionType" | "environmentId" | "spec" | "name" | "metadata" | "status"
    >,
  ) {
    this.connectionId = props.connectionId;
    this.connectionType = props.connectionType;
    this.environmentId = props.environmentId;
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
    return this.spec.computePoolId;
  }

  get sqlStatement(): string | undefined {
    return this.spec.sqlStatement;
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
    return this.status.traits?.sqlKindDisplay;
  }

  get createdAt(): Date | undefined {
    return this.metadata.createdAt;
  }

  get updatedAt(): Date | undefined {
    return this.metadata.updatedAt;
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

/** Model for the `status` subfield of a Flink statement. */
export class FlinkStatementStatus {
  phase: string;
  detail: string | undefined;
  traits?: FlinkStatementTraits;
  // TODO refine in the future.
  scalingStatus!: any;

  constructor(props: Pick<FlinkStatementStatus, "phase" | "detail" | "traits" | "scalingStatus">) {
    this.phase = props.phase;
    this.detail = props.detail;
    this.traits = props.traits;
    this.scalingStatus = props.scalingStatus;
  }
}

export class FlinkStatementTraits {
  sqlKind?: string; // CREATE_TABLE_AS, SELECT, ...
  bounded?: boolean;
  appendOnly?: boolean;
  schema: any; // todo flesh out

  constructor(props: Pick<FlinkStatementTraits, "sqlKind" | "bounded" | "appendOnly" | "schema">) {
    this.sqlKind = props.sqlKind;
    this.bounded = props.bounded;
    this.appendOnly = props.appendOnly;
    this.schema = props.schema;
  }

  /** "CREATE_TABLE_AS" -> "CREATE TABLE AS" */
  get sqlKindDisplay(): string | undefined {
    // "FAILED" phase statements may not have a sqlKind, as far as
    // have observed so far.
    return this.sqlKind?.replace(/_/g, " ");
  }
}

export class FlinkStatementSpec {
  computePoolId?: string;
  principal?: string;
  authorizedPrincipals?: string[];
  sqlStatement?: string;
  stopped?: boolean;
  properties?: Record<string, string>;

  constructor(
    props: Pick<
      FlinkStatementSpec,
      | "computePoolId"
      | "principal"
      | "authorizedPrincipals"
      | "sqlStatement"
      | "stopped"
      | "properties"
    >,
  ) {
    this.computePoolId = props.computePoolId;
    this.principal = props.principal;
    this.authorizedPrincipals = props.authorizedPrincipals;
    this.sqlStatement = props.sqlStatement;
    this.stopped = props.stopped;
    this.properties = props.properties;
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
