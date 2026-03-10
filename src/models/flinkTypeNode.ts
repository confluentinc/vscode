import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { IconNames } from "../icons";
import { formatFlinkTypeForDisplay, formatSqlType } from "../utils/flinkTypes";
import type { CompoundFlinkType, FlinkType } from "./flinkTypes";
import { FlinkTypeKind, isFlinkTypeExpandable } from "./flinkTypes";
import { CustomMarkdownString } from "./main";
import type { ConnectionId, IResourceBase } from "./resource";

/**
 * Represents a parsed Flink type node in the tree hierarchy, wrapping the
 * from-parser FlinkType with additional metadata for tree display and navigation.
 */
export class FlinkTypeNode implements IResourceBase {
  /** The parsed Flink type this node wraps */
  readonly parsedType: FlinkType;

  /**
   * Unique identifier for this node in the tree hierarchy.
   * Format: "tableRelation.columnName.fieldPath.fieldPath..."
   *
   * Uses field names for all path segments, including ARRAY/MULTISET containers.
   * All segments separated by '.' for consistency.
   * Example: "spotify-listening-data.track.artists.uri"
   *
   * Set explicitly at construction time rather than computed from parent chain,
   * enabling independent nodes without circular parent references.
   */
  readonly id: string;

  /** Cached children nodes (lazy initialization) */
  private _children: FlinkTypeNode[] | null = null;

  // IResourceBase implementation - all FlinkTypeNodes belong to CCloud
  get connectionId(): ConnectionId {
    return CCLOUD_CONNECTION_ID;
  }

  get connectionType(): ConnectionType {
    return ConnectionType.Ccloud;
  }

  /**
   * Create a new FlinkTypeNode.
   *
   * @param props Configuration object
   * @param props.parsedType The parsed FlinkType this node represents
   * @param props.id Unique identifier for this node in the tree hierarchy
   */
  constructor(props: { parsedType: FlinkType; id: string }) {
    this.parsedType = props.parsedType;
    this.id = props.id;
  }

  /**
   * Determine the icon name for a Flink type.
   * Uses special icons for ROW, ARRAY, and MULTISET types, defaults to function icon for others.
   * Static method for use by any caller with a FlinkType.
   */
  static getIconForType(flinkType: FlinkType): IconNames {
    switch (flinkType.kind) {
      case FlinkTypeKind.ROW:
        return IconNames.FLINK_TYPE_ROW;
      case FlinkTypeKind.ARRAY:
        return IconNames.FLINK_TYPE_ARRAY;
      case FlinkTypeKind.MULTISET:
        return IconNames.FLINK_TYPE_MULTISET;
      default:
        return IconNames.FLINK_FUNCTION;
    }
  }

  /**
   * Get the icon name for this type node.
   * Uses special icons for ROW, ARRAY, and MULTISET types, defaults to function icon for others.
   */
  get iconName(): IconNames {
    return FlinkTypeNode.getIconForType(this.parsedType);
  }

  /**
   * Determine if this node should be expandable in the tree view.
   * Uses isFlinkTypeExpandable() to check the underlying type structure.
   */
  get isExpandable(): boolean {
    return isFlinkTypeExpandable(this.parsedType);
  }

  /**
   * Get the display label for this node.
   *
   * For ROW/MAP member fields: field name (e.g., "id", "key", "value")
   * For other types: uses unified formatter for consistent display
   */
  private getLabel(): string {
    // ROW/MAP members have fieldName set
    if (this.parsedType.fieldName) {
      return this.parsedType.fieldName;
    }

    // Otherwise use the formatted type for display (e.g., "INT[]", "ROW", "VARCHAR(255)")
    return formatFlinkTypeForDisplay(this.parsedType);
  }

  /**
   * Get the description for this node (type + nullability, shown to the right of label).
   *
   * Format: "DataType NOT NULL" or "DataType"
   * Only shows "NOT NULL" if non-nullable (nullable is default in databases)
   * Includes array/multiset notation for display consistency (e.g., "VARCHAR[]", "ROW MULTISET")
   */
  private getDescription(): string {
    let desc = formatFlinkTypeForDisplay(this.parsedType);

    if (!this.parsedType.isFieldNullable) {
      desc += " NOT NULL";
    }

    return desc;
  }

  /**
   * Get the tooltip content for this node.
   * Provides rich markdown with type information and metadata.
   */
  private getTooltip(): CustomMarkdownString {
    const tooltip = new CustomMarkdownString();

    // Use field name as header if present, otherwise use generic "Type"
    const headerText = this.parsedType.fieldName || "Type";
    tooltip.addHeader(headerText);

    // Full data type string (the complete SQL definition)
    tooltip.addField("Data Type", formatSqlType(this.parsedType.fullDataTypeString));

    // Nullability
    tooltip.addField("Nullable", this.parsedType.isFieldNullable ? "Yes" : "No");

    // Comment if present
    if (this.parsedType.comment) {
      tooltip.addField("Comment", this.parsedType.comment);
    }

    return tooltip;
  }

  /**
   * Get child type nodes from this node (for tree expansion).
   * Returns empty array if not expandable. If expandable, returns the appropriate child nodes.
   *
   * For ROW/MAP: returns member field nodes directly.
   * For ARRAY/MULTISET with ROW/MAP elements: skips the intermediate container node for better UX
   * and returns the element's member fields directly.
   * For ARRAY/MULTISET with nested container elements: creates an intermediate node with synthetic
   * [array] or [multiset] ID segment to represent the nested container, enabling proper ID uniqueness and hierarchy.
   *
   * Child IDs are computed by appending field names (for ROW/MAP members) or synthetic [array]/[multiset]
   * segments (for nested containers) to the parent ID.
   * Results are cached to avoid regenerating FlinkTypeNode instances on repeated calls.
   */
  getChildren(): FlinkTypeNode[] {
    // Construct children if not cached
    if (this._children === null) {
      if (this.isExpandable) {
        const { kind, members } = this.parsedType as CompoundFlinkType;

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
          // ARRAY/MULTISET: check if element is directly ROW/MAP or needs intermediate node
          const elementType = members[0];

          if (elementType.kind === FlinkTypeKind.ROW || elementType.kind === FlinkTypeKind.MAP) {
            // Element is ROW/MAP: skip directly to its members (existing optimization)
            const compoundElement = elementType as CompoundFlinkType;
            this._children = compoundElement.members.map((member: FlinkType) => {
              const fieldName = member.fieldName;
              const childId = fieldName ? `${this.id}.${fieldName}` : this.id;
              return new FlinkTypeNode({
                parsedType: member,
                id: childId,
              });
            });
          } else {
            // Element is nested ARRAY/MULTISET: create intermediate node with descriptive synthetic ID
            // Use the element's kind to determine the label
            const containerLabel =
              elementType.kind === FlinkTypeKind.ARRAY ? "[array]" : "[multiset]";
            const childId = `${this.id}.${containerLabel}`;
            this._children = [
              new FlinkTypeNode({
                parsedType: elementType,
                id: childId,
              }),
            ];
          }
        }
      } else {
        // not expandable; no children
        this._children = [];
      }
    }

    return this._children;
  }

  /**
   * Get the VS Code TreeItem for this node.
   * Handles icon, label, collapsible state, and other tree item properties.
   */
  getTreeItem(): TreeItem {
    const collapsibleState = this.isExpandable
      ? TreeItemCollapsibleState.Collapsed
      : TreeItemCollapsibleState.None;

    const item = new TreeItem(this.getLabel(), collapsibleState);

    item.iconPath = new ThemeIcon(this.iconName);

    item.id = this.id;
    item.description = this.getDescription();
    item.tooltip = this.getTooltip();
    item.contextValue = "ccloud-flink-type-node";

    return item;
  }

  /**
   * Get searchable text for this node (for search/filter in the tree).
   * Includes field name, type, nullability, and comment.
   */
  searchableText(): string {
    const parts: string[] = [];

    if (this.parsedType.fieldName) {
      parts.push(this.parsedType.fieldName);
    }

    parts.push(this.parsedType.dataType);

    if (!this.parsedType.isFieldNullable) {
      parts.push("NOT NULL");
    }

    if (this.parsedType.comment) {
      parts.push(this.parsedType.comment);
    }

    return parts.join(" ");
  }
}
