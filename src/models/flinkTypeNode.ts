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
   * Get the field name for this node (if it has one).
   * Only defined for ROW/MAP member fields that have explicit field names.
   * Used by 'Copy Name' action.
   */
  get name(): string | undefined {
    return this.parsedType.fieldName;
  }

  /**
   * Check if this node is within a synthetic element (nested ARRAY/MULTISET container).
   * Returns true if the node's ID path contains [array] or [multiset] segments.
   */
  private isWithinSyntheticElement(): boolean {
    const parts = this.id.split(".");
    return parts.some((part) => part === "[array]" || part === "[multiset]");
  }

  /**
   * Get the nested path for this node, relative to the table/view.
   * Strips the relation name from the full ID path.
   *
   * Returns undefined if the path contains synthetic segments ([array], [multiset]),
   * as such paths don't represent valid SQL field paths.
   *
   * Examples:
   *   - Field "street" in column "address": "address.street"
   *   - Deep nesting: "address.location.city"
   *   - Field inside array (data.[array].field): undefined (not a valid direct path)
   *
   * Used by 'Copy Nested Path' action.
   */
  get nestedPath(): string | undefined {
    if (this.isWithinSyntheticElement()) {
      return undefined;
    }

    // Remove first component (relation name)
    const parts = this.id.split(".");
    return parts.slice(1).join(".");
  }

  /**
   * Get the context value for this node, used for VS Code when clauses in context menus.
   * Returns different values based on field name presence and synthetic element ancestry
   * to control which actions are available in the context menu.
   */
  get contextValue(): string {
    const hasSyntheticAncestry = this.isWithinSyntheticElement();
    const hasFieldName = !!this.parsedType.fieldName;

    if (hasFieldName && hasSyntheticAncestry) {
      // Has name to copy, but nested path is invalid (e.g., interior_int in ARRAY<ARRAY<ROW>>)
      return "ccloud-flink-type-field-synthetic";
    }
    if (hasFieldName && !hasSyntheticAncestry) {
      // Has name and valid nested path (e.g., street in ROW<address ROW<street VARCHAR>>)
      return "ccloud-flink-type-field";
    }
    if (!hasFieldName && hasSyntheticAncestry) {
      // Synthetic intermediate node (e.g., [array] node itself)
      return "ccloud-flink-type-node-synthetic";
    }
    // Top-level column node or ROW type node without field name
    return "ccloud-flink-type-node";
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
    this._children ??= this.isExpandable ? this.buildChildNodes() : [];

    return this._children;
  }

  /**
   * Build child nodes for expandable compound types.
   * Delegates to specific builders based on type kind.
   */
  private buildChildNodes(): FlinkTypeNode[] {
    const { kind, members } = this.parsedType as CompoundFlinkType;

    if (kind === FlinkTypeKind.ROW || kind === FlinkTypeKind.MAP) {
      // Build and return member nodes directly for ROW/MAP types
      return this.buildMemberNodes(members);
    }

    // This node must be for ARRAY/MULTISET types. What type is the element?
    const elementType = members[0];

    // Skip intermediate container node if element is ROW/MAP (UI optimization).
    // This allows users to see and access the fields of the ROW/MAP directly under the ARRAY/MULTISET node,
    // without an extra synthetic node in between.
    // However, we still include the synthetic segment in child IDs to properly mark container ancestry.
    if (elementType.kind === FlinkTypeKind.ROW || elementType.kind === FlinkTypeKind.MAP) {
      // Determine synthetic label based on THIS node's kind (ARRAY or MULTISET)
      const syntheticLabel = kind === FlinkTypeKind.ARRAY ? "[array]" : "[multiset]";
      return this.buildMemberNodes(elementType.members, syntheticLabel);
    }

    // Element is nested ARRAY/MULTISET: create intermediate node with descriptive synthetic ID
    // (only end up here if there are multiple levels of container nesting, e.g., ARRAY<ARRAY<INT>>,
    // where the element kind is also ARRAY or MULTISET)
    return this.buildNestedContainerNode(elementType);
  }

  /**
   * Build child nodes for ROW/MAP members.
   * Each member becomes a direct child node with its field name appended to the parent ID.
   * @param members - The member types to create nodes for
   * @param syntheticSegment - Optional synthetic segment to insert before field names (e.g., "[array]", "[multiset]")
   */
  private buildMemberNodes(members: FlinkType[], syntheticSegment?: string): FlinkTypeNode[] {
    return members.map((member) => {
      const fieldName = member.fieldName;
      // If syntheticSegment provided, insert it between parent ID and field name
      const childId = fieldName
        ? syntheticSegment
          ? `${this.id}.${syntheticSegment}.${fieldName}`
          : `${this.id}.${fieldName}`
        : this.id;
      return new FlinkTypeNode({
        parsedType: member,
        id: childId,
      });
    });
  }

  /**
   * Build an intermediate node for nested ARRAY/MULTISET elements.
   * Uses synthetic [array] or [multiset] label for the ID segment.
   * The label represents THIS node's container type (what we're descending into),
   * not the element's type.
   */
  private buildNestedContainerNode(elementType: FlinkType): FlinkTypeNode[] {
    const { kind } = this.parsedType as CompoundFlinkType;
    const containerLabel = kind === FlinkTypeKind.ARRAY ? "[array]" : "[multiset]";
    const childId = `${this.id}.${containerLabel}`;

    return [
      new FlinkTypeNode({
        parsedType: elementType,
        id: childId,
      }),
    ];
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
    item.contextValue = this.contextValue;

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
