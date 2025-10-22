import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, IconNames } from "../constants";
import type { IdItem } from "./main";
import { CustomMarkdownString } from "./main";
import type { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";

export class FlinkUdfParameter {
  name: string;
  dataType: string;
  isOptional: boolean;
  traits: string[];

  constructor(props: Pick<FlinkUdfParameter, "name" | "dataType" | "isOptional" | "traits">) {
    this.name = props.name;
    this.dataType = props.dataType;
    this.isOptional = props.isOptional;
    this.traits = props.traits;
  }
}

/**
 * Represents a Flink UDF.
 */
export class FlinkUdf implements IResourceBase, IdItem, ISearchable {
  /** What CCloud environment this UDF came from (from the Kafka Cluster) */
  environmentId: EnvironmentId;
  /** What cloud provider hosts the parent Kafka Cluster? */
  provider: string;
  /** What cloud region hosts the parent Kafka Cluster? */
  region: string;
  /** The Flinkable CCloud Kafka Cluster id the UDF belongs to. */
  databaseId: string;

  /** Unique id string within this database, even considering function overloading */
  id: string;
  /** The function name (not necessarily unique due to overloading) */
  name: string;
  language: string; // e.g. "JAVA" or "PYTHON"
  /** The name of the implementation routine in the external language */
  externalName: string;
  /** Artifact containing the UDF implementation. Should be parsed down to its artifact ID sooner or later */
  artifactReference: string;

  /** Is the function deterministic? */
  isDeterministic: boolean;

  /** When the function was created */
  creationTs: Date;

  /** One of 'SCALAR', 'TABLE', 'AGGREGATE', 'PROCESS_TABLE'. Will be null for PROCEDURE*/
  kind: string | null;

  /** Return type full SQL name */
  returnType: string;

  /** The function parameters (in order) */
  parameters: FlinkUdfParameter[] = [];
  description: string;
  iconName: IconNames = IconNames.FLINK_FUNCTION;

  constructor(
    props: Pick<
      FlinkUdf,
      | "environmentId"
      | "provider"
      | "region"
      | "databaseId"
      | "id"
      | "name"
      | "description"
      | "language"
      | "externalName"
      | "isDeterministic"
      | "artifactReference"
      | "creationTs"
      | "parameters"
      | "kind"
      | "returnType"
    >,
  ) {
    // From the parent Kafka cluster:
    this.environmentId = props.environmentId;
    this.provider = props.provider;
    this.region = props.region;
    this.databaseId = props.databaseId;

    // From the UDF itself:
    this.id = props.id;
    this.name = props.name;
    this.description = props.description;
    this.language = props.language;
    this.externalName = props.externalName;
    this.artifactReference = props.artifactReference;
    this.isDeterministic = props.isDeterministic;
    this.creationTs = new Date(props.creationTs);
    this.kind = props.kind;
    this.returnType = props.returnType;

    this.parameters = props.parameters;
  }

  searchableText(): string {
    const parts = [];

    parts.push(this.name);
    parts.push(this.description);
    parts.push(this.externalName);
    // in near future, break down artifact reference into id and version via new getters and/or parse at construction time.
    parts.push(this.artifactReference);
    parts.push(this.kind ?? "");

    return parts.join(" ");
  }

  get connectionId(): ConnectionId {
    return CCLOUD_CONNECTION_ID;
  }

  get connectionType(): ConnectionType {
    return ConnectionType.Ccloud;
  }

  get artifactReferenceExtracted(): string {
    // Extract artifact ID and version from "confluent-artifact://<artifact-id>/<version-id>"
    return this.artifactReference.replace(/^confluent-artifact:\/\//, "");
  }

  /** Returns a formatted string of the function parameters' signatures. */
  get parametersSignature(): string {
    return (
      "(" + this.parameters.map((p) => `${p.name} : ${formatSqlType(p.dataType)}`).join(", ") + ")"
    );
  }
}

/** TreeItem subclass for FlinkUdf */
export class FlinkUdfTreeItem extends TreeItem {
  resource: FlinkUdf;

  constructor(resource: FlinkUdf) {
    super(resource.name, TreeItemCollapsibleState.None);
    this.iconPath = new ThemeIcon(resource.iconName);
    this.id = resource.id;
    this.resource = resource;
    this.contextValue = `${resource.connectionType.toLowerCase()}-flink-udf`;

    this.description = `${resource.parametersSignature} → ${formatSqlType(resource.returnType)}`;
    this.tooltip = createFlinkUdfToolTip(resource);
  }
}

/**
 * Creates a rich markdown tooltip describing the given Flink UDF.
 * @param resource The Flink UDF to create a tooltip for.
 * @returns CustomMarkdownString for the tooltip for the UDF.
 */
export function createFlinkUdfToolTip(resource: FlinkUdf): CustomMarkdownString {
  const tooltip = new CustomMarkdownString()
    .addHeader("Flink UDF", IconNames.FLINK_FUNCTION)
    .addField("ID", resource.id)
    .addField("Description", resource.description)
    .addField("Return Type", formatSqlType(resource.returnType));

  if (resource.parameters.length > 0) {
    tooltip.addField("Parameters", `${resource.parametersSignature}`);
  } else {
    tooltip.addField("Parameters", "None");
  }

  // Additional function properties
  tooltip.addField("Language", resource.language);
  tooltip.addField("External Name", resource.externalName);
  tooltip.addField("Deterministic", resource.isDeterministic ? "Yes" : "No");
  tooltip.addField("Kind", resource.kind ?? "UNKNOWN");
  tooltip.addField(
    "Created At",
    resource.creationTs.toLocaleString(undefined, { timeZoneName: "short" }),
  );
  tooltip.addField("Artifact Reference", resource.artifactReferenceExtracted);
  return tooltip;
}

/**
 * Represents a column of a Flink relation (table or view).
 * Collected into the {@link FlinkRelation#columns | columns} property of a {@link FlinkRelation}.
 **/
export class FlinkRelationColumn {
  /** Name of the containing relation */
  readonly relationName: string;
  /** Name of the column */
  readonly name: string;
  /** Full SQL data type of the column. */
  readonly fullDataType: string;
  /** Is the overall column nullable? */
  readonly isNullable: boolean;
  /** If part of distribution key, what number in the key is it? (1-based) */
  readonly distributionKeyNumber: number | null;
  /** Is the column a generated column? */
  readonly isGenerated: boolean;
  /** Is the column persisted (stored on disk)? */
  readonly isPersisted: boolean;
  /** Is the column hidden (not normally visible)? */
  readonly isHidden: boolean;
  readonly comment: string | null;

  /** If a metadata column, what Kafka topic metadata key does it map to? */
  readonly metadataKey: string | null;

  constructor(
    props: Pick<
      FlinkRelationColumn,
      | "relationName"
      | "name"
      | "fullDataType"
      | "distributionKeyNumber"
      | "isGenerated"
      | "isPersisted"
      | "isHidden"
      | "metadataKey"
      | "comment"
      | "isNullable"
    >,
  ) {
    this.relationName = props.relationName;
    this.name = props.name;
    this.fullDataType = props.fullDataType;
    this.isNullable = props.isNullable;
    this.distributionKeyNumber = props.distributionKeyNumber;
    this.isGenerated = props.isGenerated;
    this.isPersisted = props.isPersisted;
    this.isHidden = props.isHidden;
    this.metadataKey = props.metadataKey;
    this.comment = props.comment;
  }

  get id(): string {
    return `${this.relationName}.${this.name}`;
  }

  /**
   * Simplified spelling of the datatype.
   * Compound types reduced, max varchar lengths eroded away.
   **/
  get simpleDataType(): string {
    let type = this.fullDataType;

    // if is a ROW<...> type, just return "ROW"
    if (type.startsWith("ROW<")) {
      return "ROW";
    }

    // if is a MAP<...> type, just return "MAP"
    if (type.startsWith("MAP<")) {
      return "MAP";
    }

    // Likewise ARRAY
    if (type.startsWith("ARRAY<")) {
      return "ARRAY";
    }

    // and MULTISET
    if (type.startsWith("MULTISET<")) {
      return "MULTISET";
    }

    // Erode max size specifications like VARCHAR(2147483647) to just VARCHAR.
    return formatSqlType(type);
  }

  get connectionId(): ConnectionId {
    return CCLOUD_CONNECTION_ID;
  }

  get connectionType(): ConnectionType {
    return ConnectionType.Ccloud;
  }

  /** Is this column a metadata column? */
  get isMetadata(): boolean {
    return this.metadataKey !== null;
  }

  searchableText(): string {
    const parts = [];

    parts.push(this.name);
    parts.push(this.simpleDataType);
    if (this.metadataKey) {
      parts.push(this.metadataKey);
    }
    if (this.comment) {
      parts.push(this.comment);
    }

    return parts.join(" ");
  }

  getTreeItem(): TreeItem {
    const item = new TreeItem(this.name, TreeItemCollapsibleState.None);
    // item.iconPath = new ThemeIcon(IconNames.FLINK_FUNCTION); // TODO replace with column specific icon when available
    item.id = this.id;
    item.contextValue = "ccloud-flink-column";
    item.tooltip = this.getToolTip();
    item.description = this.treeItemDescription;

    return item;
  }

  /** Make a nice overview of the column type, nullability, comment prefix */
  get treeItemDescription(): string {
    let desc = this.simpleDataType;
    // Only show NOT NULL if applicable, as NULL is default in DB-lands and would be noisy
    if (!this.isNullable) {
      desc += " NOT NULL";
    }

    if (this.comment) {
      // append the first 30 chars, and if more, append "..."
      const shortComment =
        this.comment.length > 30 ? this.comment.substring(0, 30) + "..." : this.comment;
      desc += ` - ${shortComment}`;
    }

    return desc;
  }

  getToolTip(): CustomMarkdownString {
    const tooltip = new CustomMarkdownString()
      .addHeader("Flink Column", IconNames.FLINK_FUNCTION) // TODO replace with column specific icon when available
      .addField("Name", this.name)
      .addField("Data Type", formatSqlType(this.fullDataType))
      .addField("Nullable", this.isNullable ? "Yes" : "No")
      .addField("Persisted", this.isPersisted ? "Yes" : "No");

    if (this.distributionKeyNumber !== null) {
      tooltip.addField("Distribution Key Number", `${this.distributionKeyNumber}`);
    }

    tooltip.addField("Generated", this.isGenerated ? "Yes" : "No");

    if (this.isMetadata) {
      tooltip.addField("Metadata Column", `Yes, maps to key: ${this.metadataKey}`);
    }

    if (this.comment) {
      tooltip.addField("Comment", this.comment);
    }

    return tooltip;
  }

  /** Returns a single line representation of this column, for use within the containing relation's tooltip */
  tooltipLine(): string {
    const parts: string[] = [`${this.name}: ${formatSqlType(this.simpleDataType)}`];
    if (!this.isNullable) {
      parts.push("NOT NULL");
    } else {
      parts.push("NULL");
    }
    if (this.isGenerated) {
      parts.push("GENERATED");
    }

    if (this.distributionKeyNumber !== null) {
      parts.push(`DISTKEY(${this.distributionKeyNumber})`);
    }

    if (this.isMetadata) {
      parts.push(`METADATA('${this.metadataKey}')`);
    }

    return parts.join(" ");
  }
}

/** Type of a Flink relation (table, view, system or external table). */
export enum FlinkRelationType {
  /** A CCloud Kafka-topic-based table */
  BaseTable = "BASE TABLE",
  /** A SQL View */
  View = "VIEW", // SQL views.
  /** An external system table, such as via JDBC, probably read-only */
  ExternalTable = "EXTERNAL TABLE",
  /** Flink-managed tables, such as $error and system catalog tables. Read-only. */
  SystemTable = "SYSTEM TABLE",
}

/**
 * Represents a Flink relation (base table or view) within the system catalog.
 * Immutable data holder with light convenience getters, mirroring the style of FlinkUdf and Column.
 */
export class FlinkRelation {
  /** Relation name */
  readonly name: string;
  /** Optional comment / description */
  readonly comment: string | null;
  /** Relation type */
  readonly type: FlinkRelationType;
  /** Number of distribution buckets if distributed */
  readonly distributionBucketCount: number;
  /** Whether the relation is physically distributed */
  readonly isDistributed: boolean;
  /** Whether a watermark is defined */
  readonly isWatermarked: boolean;
  /** Column the watermark is defined on (if any) */
  readonly watermarkColumnName: string | null;
  /** Watermark expression (if any) */
  readonly watermarkExpression: string | null;
  /** Whether the watermark column is hidden */
  readonly watermarkColumnIsHidden: boolean;
  /** Columns of the relation */
  columns: FlinkRelationColumn[];

  constructor(
    props: Pick<
      FlinkRelation,
      | "name"
      | "comment"
      | "type"
      | "distributionBucketCount"
      | "isDistributed"
      | "isWatermarked"
      | "watermarkColumnName"
      | "watermarkExpression"
      | "watermarkColumnIsHidden"
      | "columns"
    >,
  ) {
    this.name = props.name;
    this.comment = props.comment;
    this.type = props.type;
    this.distributionBucketCount = props.distributionBucketCount;
    this.isDistributed = props.isDistributed;
    this.isWatermarked = props.isWatermarked;
    this.watermarkColumnName = props.watermarkColumnName;
    this.watermarkExpression = props.watermarkExpression;
    this.watermarkColumnIsHidden = props.watermarkColumnIsHidden;
    this.columns = props.columns;
  }

  get id(): string {
    return this.name;
  }

  get connectionId(): ConnectionId {
    return CCLOUD_CONNECTION_ID;
  }

  get connectionType(): ConnectionType {
    return ConnectionType.Ccloud;
  }

  /** Returns the visible (non-hidden) columns. */
  get visibleColumns(): FlinkRelationColumn[] {
    return this.columns.filter((c) => !c.isHidden);
  }

  get typeLabel(): string {
    switch (this.type) {
      case FlinkRelationType.BaseTable:
        return "Flink Table";
      case FlinkRelationType.View:
        return "Flink View";
      case FlinkRelationType.ExternalTable:
        return "External Table";
      case FlinkRelationType.SystemTable:
        return "System Table";
      default:
        // should not happen
        return "Flink Relation";
    }
  }

  searchableText(): string {
    const parts = [];

    parts.push(this.name);
    parts.push(this.type);
    if (this.comment) {
      parts.push(this.comment);
    }
    for (const col of this.columns) {
      parts.push(col.name);
      parts.push(col.simpleDataType);
      if (col.metadataKey) {
        parts.push(col.metadataKey);
      }
    }

    return parts.join(" ");
  }

  getTreeItem(): TreeItem {
    const item = new TreeItem(this.name, TreeItemCollapsibleState.Collapsed);
    // item.iconPath = new ThemeIcon(IconNames.FLINK_FUNCTION); // TODO replace with table/view specific icons when available
    item.id = this.name;

    const typeSnippet = this.type.toLowerCase().replace(" ", "-");
    item.contextValue = `ccloud-flink-relation-${typeSnippet}`;

    item.tooltip = this.getToolTip();
    return item;
  }

  /**
   * Builds a rich markdown tooltip describing this relation (table or view).
   * Includes structural, distribution, watermark, and column metadata in a concise format.
   */
  getToolTip(): CustomMarkdownString {
    // Choose icon + title based on relation type (fall back to function icon if specific ones are unavailable)
    // IconNames.FLINK_TABLE / IconNames.FLINK_VIEW are expected to exist alongside FLINK_FUNCTION.
    // const headerIcon: IconNames = IconNames.FLINK_FUNCTION; // TODO replace with table/view specific icons when available

    const tooltip = new CustomMarkdownString().addHeader(this.typeLabel); //, headerIcon);

    tooltip.addField("Name", this.name);

    if (this.comment) {
      tooltip.addField("Comment", this.comment);
    }

    // Distribution
    if (this.isDistributed) {
      tooltip.addField("Distribution Bucket Count", this.distributionBucketCount.toString());
    } else {
      tooltip.addField("Distribution", "Not distributed");
    }

    // Watermark
    if (this.isWatermarked) {
      tooltip.addField("Watermarked", "Yes");
      if (this.watermarkColumnName) {
        tooltip.addField(
          "Watermark Column",
          `${this.watermarkColumnName}${this.watermarkColumnIsHidden ? " (hidden)" : ""}`,
        );
      }
      tooltip.addField("Watermark Expression", this.watermarkExpression!);
    } else {
      tooltip.addField("Watermarked", "No");
    }

    // List visible columns
    const visible = this.visibleColumns;
    if (visible.length === 0) {
      tooltip.addField("Visible Columns", "None");
    } else {
      const rendered = visible.map((c) => c.tooltipLine());
      tooltip.addField("Visible Columns", rendered.join("\n"));
    }

    return tooltip;
  }
}

/**
 * Convert the string spelling of a relation type (from system catalog query results)
 * to its corresponding enum.
 **/
export function toRelationType(type: string): FlinkRelationType {
  switch (type) {
    case "BASE TABLE":
      return FlinkRelationType.BaseTable;
    case "VIEW":
      return FlinkRelationType.View;
    case "SYSTEM TABLE":
      return FlinkRelationType.SystemTable;
    case "EXTERNAL TABLE":
      return FlinkRelationType.ExternalTable;
    default:
      throw new Error(`Unknown relation type: ${type}`);
  }
}

/**
 * Returns a display-friendly version of the data type by removing max-int size specifications and escaping backticks.
 */
export function formatSqlType(sqlType: string): string {
  // Remove noisy (2GBs) max size type values
  const cleaned = sqlType.replace(/\(2147483647\)/g, "");
  // Remove backticks that are part of SQL syntax (e.g., in ROW<`field` VARCHAR>)
  return cleaned.replace(/`/g, "");
}
