import { ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import {
  CreateSqlv1Statement201Response,
  GetSqlv1Statement200Response,
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
  IEnvProviderRegion,
  IProviderRegion,
  IResourceBase,
  ISearchable,
  OrganizationId,
} from "./resource";

const ONE_DAY_MILLIS = 24 * 60 * 60 * 1000;

export type FlinkStatementId = string & { readonly brand: unique symbol };

/** Statement phases */
export enum Phase {
  RUNNING = "RUNNING",
  DEGRADED = "DEGRADED",
  COMPLETED = "COMPLETED",
  STOPPING = "STOPPING",
  STOPPED = "STOPPED",
  FAILED = "FAILED",
  FAILING = "FAILING",
  DELETING = "DELETING",
  PENDING = "PENDING",
}

/**  List of phases considered as failed or failing. */
export const FAILED_PHASES = [Phase.FAILED, Phase.FAILING];

/**  List of terminal phases. Statements in terminal phase won't ever change on their own. */
export const TERMINAL_PHASES = [Phase.COMPLETED, Phase.STOPPED, Phase.FAILED];

const VIEWABLE_PHASES = [
  Phase.PENDING,
  Phase.RUNNING,
  Phase.COMPLETED,
  // Phase.DEGRADED,??
];

/** Phases which cannot be stopped. */
export const UNSTOPPABLE_PHASES = [
  Phase.DELETING,
  Phase.STOPPING,
  Phase.FAILING,
  ...TERMINAL_PHASES,
];

/**
 * Model for a Flink statement.
 */
export class FlinkStatement implements IResourceBase, IdItem, ISearchable, IEnvProviderRegion {
  // Immutable foreign reference properties
  readonly connectionId!: ConnectionId;
  readonly connectionType!: ConnectionType;
  readonly environmentId!: EnvironmentId;
  readonly organizationId!: OrganizationId;
  readonly provider: string;
  readonly region: string;

  // Immutable name
  readonly name: string;

  // Mutable properties
  metadata: SqlV1StatementMetadata;
  status: SqlV1StatementStatus;
  spec: SqlV1StatementSpec;

  constructor(
    props: Pick<
      FlinkStatement,
      | "connectionId"
      | "connectionType"
      | "environmentId"
      | "organizationId"
      | "provider"
      | "region"
      | "name"
      | "spec"
      | "metadata"
      | "status"
    >,
  ) {
    this.connectionId = props.connectionId;
    this.connectionType = props.connectionType;
    this.environmentId = props.environmentId;
    this.organizationId = props.organizationId;
    this.provider = props.provider;
    this.region = props.region;

    this.name = props.name;

    this.spec = props.spec;
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
   * Return globally unique id for this statement.
   * This is a combination of the statement name and the environmentId.
   * This is needed because the name is not guaranteed unique across environments.
   */
  get id(): FlinkStatementId {
    return `${this.name}@${this.environmentId}` as FlinkStatementId;
  }

  get ccloudUrl(): string {
    return `https://confluent.cloud/environments/${this.environmentId}/flink/statements/${this.name}/activity?utm_source=${UTM_SOURCE_VSCODE}`;
  }

  get isTerminal(): boolean {
    return TERMINAL_PHASES.includes(this.phase);
  }

  get phase(): Phase {
    return this.status.phase as Phase;
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

  /**
   * Is this statement's `updatedAt` later than other's?
   * @throws Error if statements have different name or environmentIds.
   */
  isUpdatedMoreRecentlyThan(other: FlinkStatement): boolean {
    if (this.id !== other.id) {
      throw new Error(
        `Cannot compare FlinkStatement "${this.id}" with instance with different id "${other.id}"`,
      );
    }

    if (!this.updatedAt || !other.updatedAt) {
      return false;
    }
    return this.updatedAt.getTime() > other.updatedAt.getTime();
  }

  get isBackground(): boolean {
    return (this.sqlKind ?? "") === "INSERT_INTO";
  }

  /**
   * Update this FlinkStatement with metadata, status, spec from another FlinkStatement.
   *
   * (Needed because statements within the view controller must be retained by reference,
   *  but statements mutate over time.)
   *
   * @param other The other FlinkStatement to update this one with.
   * @throws Error if the other statement has a different name or environmentId
   */
  update(other: FlinkStatement): void {
    if (this.name !== other.name || this.environmentId !== other.environmentId) {
      throw new Error(
        `Cannot update FlinkStatement "${this.name}" with instance with different name ${other.name} or environmentId ${other.environmentId}`,
      );
    }

    this.metadata = other.metadata;
    this.status = other.status;
    this.spec = other.spec;
  }

  /**
   * For statement results to be viewable, it must satisfy these conditions:
   * 1. The statement must have been created in the last 24 hours
   *    (which is the TTL for the statement result to be deleted.)
   * 2. The statement phase indicates {@link VIEWABLE_PHASES viewability.}
   */
  get areResultsViewable(): boolean {
    if (!this.createdAt) {
      return false;
    }

    return (
      this.createdAt.getTime() >= new Date().getTime() - ONE_DAY_MILLIS &&
      VIEWABLE_PHASES.includes(this.phase)
    );
  }

  /** @see https://docs.confluent.io/cloud/current/api.html#tag/Statements-(sqlv1)/The-Statements-Model */
  get catalog(): string | undefined {
    return this.spec.properties?.["sql.current-catalog"];
  }

  /** @see https://docs.confluent.io/cloud/current/api.html#tag/Statements-(sqlv1)/The-Statements-Model */
  get database(): string | undefined {
    return this.spec.properties?.["sql.current-database"];
  }

  /** Returns true if the statement is in a failed or failing phase. */
  get failed(): boolean {
    return FAILED_PHASES.includes(this.phase);
  }

  /** Returns true if the statement can be stopped (not in a terminal phase). */
  get stoppable(): boolean {
    return !TERMINAL_PHASES.includes(this.phase);
  }

  get detail(): string | undefined {
    return this.status?.detail;
  }

  get startTime(): Date | undefined {
    return this.metadata?.created_at;
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
    super(resource.name, TreeItemCollapsibleState.None);

    // internal properties
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
      case Phase.FAILED:
      case Phase.FAILING:
        return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_FAILED, STATUS_RED);
      case Phase.DEGRADED:
        return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_DEGRADED, STATUS_YELLOW);
      case Phase.RUNNING:
        return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_RUNNING, STATUS_GREEN);
      case Phase.COMPLETED:
        return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_COMPLETED, STATUS_GRAY);
      case Phase.DELETING:
      case Phase.STOPPING:
        return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_DELETING, STATUS_GRAY);
      case Phase.STOPPED:
        return new ThemeIcon(IconNames.FLINK_STATEMENT_STATUS_STOPPED, STATUS_BLUE);
      case Phase.PENDING:
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

/**
 * Convert a from-REST API depiction of a Flink statement to
 * our codebase's FlinkStatement model.
 *
 * @param restFlinkStatement The Flink statement from the REST API
 * @param providerRegion Object contributing the provider and region the statement should be related to.
 * */
export function restFlinkStatementToModel(
  restFlinkStatement:
    | SqlV1StatementListDataInner
    | GetSqlv1Statement200Response
    | CreateSqlv1Statement201Response,
  providerRegion: IProviderRegion,
): FlinkStatement {
  return new FlinkStatement({
    connectionId: CCLOUD_CONNECTION_ID,
    connectionType: ConnectionType.Ccloud,
    environmentId: restFlinkStatement.environment_id as EnvironmentId,
    organizationId: restFlinkStatement.organization_id as OrganizationId,
    provider: providerRegion.provider,
    region: providerRegion.region,

    name: restFlinkStatement.name!,

    spec: restFlinkStatement.spec,
    metadata: restFlinkStatement.metadata!,
    status: restFlinkStatement.status,
  });
}
