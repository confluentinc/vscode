import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { logError } from "../errors";
import { FLINK_SQL_LANGUAGE_ID } from "../flinkSql/constants";
import { IconNames } from "../icons";
import { parseFlinkType } from "../parsers/flinkTypeParser";
import { formatFlinkTypeForDisplay, formatSqlType } from "../utils/flinkTypes";
import { FlinkTypeNode } from "./flinkTypeNode";
import type { CompoundFlinkType, FlinkType } from "./flinkTypes";
import { FlinkTypeKind, isCompoundFlinkType } from "./flinkTypes";
import type { IdItem } from "./main";
import { CustomMarkdownString } from "./main";
import type { ConnectionId, EnvironmentId, IResourceBase, ISearchable } from "./resource";

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

  /** Cached parsed type result (lazy initialization) */
  private _parsedType: FlinkType | null = null;

  /** Cached children nodes if the column is of an expandable Flink type (with lazy initialization, see {@link getChildren}).
   * When the column is expandable (i.e. has ROW, MAP, or ARRAY/MULTISET with compound element), this will hold the child nodes representing the member fields.
   * For ROW/MAP: children are the member fields directly.
   * For ARRAY/MULTISET with compound elements: children are the element's member fields (skipping the intermediate container node).
   * This flattening for ARRAY/MULTISET is a UX choice to avoid unnecessary nesting in the tree view, since the container itself does not have meaningful
   * metadata and the element type is guaranteed to be compound if expandable.
   */
  private _children: FlinkTypeNode[] | null = null;

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

  get connectionId(): ConnectionId {
    return CCLOUD_CONNECTION_ID;
  }

  get connectionType(): ConnectionType {
    return ConnectionType.Ccloud;
  }

  /**
   * Parse the fullDataType into a FlinkType structure.
   * Always returns a FlinkType. If parsing fails, returns a synthetic SCALAR type with the full dataType.
   * Caches result after first parse attempt.
   */
  getParsedType(): FlinkType {
    if (this._parsedType !== null) {
      return this._parsedType;
    }

    try {
      this._parsedType = parseFlinkType(this.fullDataType);
    } catch (error) {
      const errorMessage = `Failed to parse Flink type for column '${this.name}' in table '${this.relationName}'. Data type: ${this.fullDataType}`;
      logError(error, errorMessage);
      // Return a synthetic SCALAR type as fallback (visible in UI with full type string)
      this._parsedType = {
        kind: FlinkTypeKind.SCALAR,
        dataType: this.fullDataType,
        fullDataTypeString: this.fullDataType,
        isFieldNullable: true,
      };
    }

    return this._parsedType;
  }

  /**
   * Determine if this column should be expandable in the tree view.
   * Expandable if the parsed type is compound (ROW, MAP, ARRAY<compound>, MULTISET<compound>).
   */
  get isExpandable(): boolean {
    const parsed = this.getParsedType();
    if (!isCompoundFlinkType(parsed)) {
      return false;
    }

    const { kind, members } = parsed;

    // ROW and MAP always expand
    if (kind === FlinkTypeKind.ROW || kind === FlinkTypeKind.MAP) {
      return true;
    }

    // ARRAY/MULTISET: only if element is compound
    return isCompoundFlinkType(members[0]);
  }

  /**
   * Get child type nodes for this column (for tree expansion).
   * Returns empty array if not expandable. If expandable, returns the appropriate child nodes.
   *
   * For ROW/MAP: returns member field nodes directly.
   * For ARRAY/MULTISET with compound elements: skips the intermediate container node and returns
   * the element's children directly for better UX. Since isExpandable() validates this condition,
   * we can safely access members[0].members without additional checks.
   *
   * All returned FlinkTypeNode instances are created with IDs prefixed by `relationName.columnName`.
   * This ensures global ID uniqueness across the entire tree view: two columns with identical
   * structures in different relations, or different columns in the same relation, will have
   * distinct child IDs. For example:
   * - Column "users.metadata" with ROW<id INT, name VARCHAR> generates:
   *   - "users.metadata.id"
   *   - "users.metadata.name"
   * - Column "orders.metadata" with identical structure generates:
   *   - "orders.metadata.id"
   *   - "orders.metadata.name"
   * This prefix inheritance cascades through nested types, maintaining uniqueness at all levels.
   */
  getChildren(): FlinkTypeNode[] {
    // Construct children if not cached
    if (this._children === null) {
      if (!this.isExpandable) {
        this._children = [];
      } else {
        const parsed = this.getParsedType() as CompoundFlinkType;
        const { kind, members } = parsed;

        // ROW and MAP: return member nodes directly
        if (kind === FlinkTypeKind.ROW || kind === FlinkTypeKind.MAP) {
          this._children = members.map((member: FlinkType) => {
            const fieldName = member.fieldName;
            const childId = fieldName ? `${this.id}.${fieldName}` : this.id;
            return new FlinkTypeNode({
              parsedType: member,
              id: childId,
            });
          });
        } else {
          // ARRAY/MULTISET with compound elements: return the element's children directly
          // (skips the intermediate [element] node for cleaner UX)
          // Note: isExpandable() ensures the element is compound, so we can safely access members[0].members
          const elementType = members[0] as CompoundFlinkType;
          this._children = elementType.members.map((member: FlinkType) => {
            const fieldName = member.fieldName;
            const childId = fieldName ? `${this.id}.${fieldName}` : this.id;
            return new FlinkTypeNode({
              parsedType: member,
              id: childId,
            });
          });
        }
      }
    }

    return this._children;
  }

  /** Is this column a metadata column? */
  get isMetadata(): boolean {
    return this.metadataKey !== null;
  }

  searchableText(): string {
    const parts = [];

    parts.push(this.name);
    parts.push(formatFlinkTypeForDisplay(this.getParsedType()));
    if (this.metadataKey) {
      parts.push(this.metadataKey);
    }
    if (this.comment) {
      parts.push(this.comment);
    }

    return parts.join(" ");
  }

  getTreeItem(): TreeItem {
    const collapsibleState = this.isExpandable
      ? TreeItemCollapsibleState.Collapsed
      : TreeItemCollapsibleState.None;

    const item = new TreeItem(this.name, collapsibleState);

    const parsed = this.getParsedType();
    const iconName = FlinkTypeNode.getIconForType(parsed);

    item.iconPath = new ThemeIcon(iconName);

    item.id = this.id;
    item.contextValue = "ccloud-flink-column";
    item.tooltip = this.getToolTip(iconName);
    item.description = this.getTreeItemDescription(parsed);

    return item;
  }

  /**
   * Make a nice overview of the column type, nullability, comment prefix.
   * Takes the parsed type as parameter to avoid redundant parsing.
   */
  private getTreeItemDescription(parsed: FlinkType): string {
    let desc = formatFlinkTypeForDisplay(parsed);

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

  getToolTip(iconName: IconNames): CustomMarkdownString {
    const tooltip = new CustomMarkdownString()
      .addHeader("Flink Column", iconName)
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
export class FlinkRelation implements IResourceBase, IdItem, ISearchable {
  /** What CCloud environment this relation came from (from the Kafka Cluster) */
  environmentId: EnvironmentId;
  /** What cloud provider hosts the parent Kafka Cluster? */
  provider: string;
  /** What cloud region hosts the parent Kafka Cluster? */
  region: string;
  /** The (CCloud) Kafka cluster id the relation belongs to. */
  databaseId: string;

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

  /** If is a view (and we had permissions to see the definition), what is the view definition SQL? */
  // (explicitly not in constructor props as it will not be known at construction time due to limitations
  //  on how we can query the system catalog (no joins + this info in another table))
  viewDefinition: string | null = null;

  /** Columns of the relation */
  columns: FlinkRelationColumn[];

  constructor(
    props: Pick<
      FlinkRelation,
      | "environmentId"
      | "provider"
      | "region"
      | "databaseId"
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
    this.environmentId = props.environmentId;
    this.provider = props.provider;
    this.region = props.region;
    this.databaseId = props.databaseId;
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

  get iconName() {
    return this.type === FlinkRelationType.View ? IconNames.FLINK_VIEW : IconNames.TOPIC; // topic = table
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
      parts.push(formatFlinkTypeForDisplay(col.getParsedType()));
      if (col.metadataKey) {
        parts.push(col.metadataKey);
      }
    }

    return parts.join(" ");
  }

  getTreeItem(): TreeItem {
    const item = new TreeItem(this.name, TreeItemCollapsibleState.Collapsed);
    item.iconPath = new ThemeIcon(this.iconName);
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

    // Attributes meaningful only for base tables (aka Kafka-topic-backed tables)
    if (this.type === FlinkRelationType.BaseTable) {
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
    }

    // If has a view definition, show it here for the time being. Needs
    // to ultimately be openable in a separate tab or similar.
    if (this.type === FlinkRelationType.View && this.viewDefinition) {
      tooltip.appendMarkdown("\n\nView Definition:");
      tooltip.addCodeBlock(this.viewDefinition, FLINK_SQL_LANGUAGE_ID);
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
