/**
 * Represents a parsed Flink type node for display in the TreeView.
 *
 * Used as intermediate tree items when expanding columns with compound types (ROW, MAP, ARRAY<compound>, etc.).
 * Provides tree item rendering with proper icons, labels, and descriptions for each type kind.
 */

import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { formatSqlType, formatFlinkTypeForDisplay } from "../utils/flinkTypes";
import type { FlinkType } from "./flinkTypes";
import { FlinkTypeKind, isCompoundFlinkType } from "./flinkTypes";
import { CustomMarkdownString } from "./main";
import type { FlinkRelationColumn } from "./flinkRelation";
import type { ConnectionId, IResourceBase } from "./resource";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { ConnectionType } from "../clients/sidecar";

/**
 * Represents a parsed Flink type node in the tree hierarchy.
 *
 * Each node corresponds to a parsed FlinkType structure and can be expanded if it contains
 * nested compound types (ROW, MAP, or compound ARRAY/MULTISET elements).
 * Implements IResourceBase to fit into the view provider type hierarchy.
 */
export class FlinkTypeNode implements IResourceBase {
  /** The parsed Flink type this node represents */
  readonly parsedType: FlinkType;

  /** If this node came from expanding a FlinkRelationColumn, reference to the parent column */
  readonly parentColumn: FlinkRelationColumn | null;

  /** If this node is nested within another FlinkTypeNode, reference to the parent */
  readonly parentNode: FlinkTypeNode | null;

  /** Nesting depth (0 = direct child of column, 1+ = nested within other nodes) */
  readonly depth: number;

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
   * @param props.parentColumn Optional parent FlinkRelationColumn (if direct child of column)
   * @param props.parentNode Optional parent FlinkTypeNode (if nested)
   * @param props.depth Optional nesting depth (defaults to 0)
   */
  constructor(props: {
    parsedType: FlinkType;
    parentColumn?: FlinkRelationColumn;
    parentNode?: FlinkTypeNode;
    depth?: number;
  }) {
    this.parsedType = props.parsedType;
    this.parentColumn = props.parentColumn ?? null;
    this.parentNode = props.parentNode ?? null;
    this.depth = props.depth ?? 0;
  }

  /**
   * Unique identifier for this node in the tree hierarchy.
   * Format: "parentId:fieldPath" for nested nodes, "parentId" for direct children.
   */
  get id(): string {
    const path: string[] = [];

    // Collect all parent nodes in order from root to this node
    const nodeChain: FlinkTypeNode[] = [];
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let node: FlinkTypeNode | null = this;
    while (node) {
      nodeChain.unshift(node);
      node = node.parentNode;
    }

    // Add column id first if we have one
    if (this.parentColumn) {
      path.push(this.parentColumn.id);
    }

    // Add field names in order from root to this node
    for (const chainNode of nodeChain) {
      const fieldName = chainNode.parsedType.fieldName;
      if (fieldName) {
        path.push(fieldName);
      }
    }

    // For ARRAY/MULTISET, also include the element identifier
    if (
      isCompoundFlinkType(this.parsedType) &&
      (this.parsedType.kind === FlinkTypeKind.ARRAY ||
        this.parsedType.kind === FlinkTypeKind.MULTISET)
    ) {
      path.push(this.parsedType.kind === FlinkTypeKind.ARRAY ? "[element]" : "{element}");
    }

    return path.join(":");
  }

  /**
   * Determine if this node should be expandable in the tree view.
   *
   * Expandable if:
   * - ROW or MAP: Always (always have structure)
   * - ARRAY/MULTISET: Only if element type is compound (ROW or MAP)
   * - SCALAR: Never
   */
  get isExpandable(): boolean {
    if (!isCompoundFlinkType(this.parsedType)) {
      return false;
    }

    const { kind, members } = this.parsedType;

    // ROW and MAP always expand
    if (kind === FlinkTypeKind.ROW || kind === FlinkTypeKind.MAP) {
      return true;
    }

    // ARRAY/MULTISET: only if element is compound
    if (kind === FlinkTypeKind.ARRAY || kind === FlinkTypeKind.MULTISET) {
      return isCompoundFlinkType(members[0]);
    }

    return false;
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

    // Use unified formatter for consistent display across all type contexts
    return formatFlinkTypeForDisplay(this.parsedType);
  }

  /**
   * Get the description for this node (type + nullability, shown to the right of label).
   *
   * Format: "DataType NOT NULL" or "DataType"
   * Only shows "NOT NULL" if non-nullable (nullable is default in databases)
   */
  private getDescription(): string {
    let desc = formatSqlType(this.parsedType.dataType);

    if (!this.parsedType.isFieldNullable) {
      desc += " NOT NULL";
    }

    return desc;
  }

  /**
   * Get the icon for this node based on type kind.
   * Uses VS Code built-in ThemeIcons.
   */
  private getIcon(): ThemeIcon {
    const kind = this.parsedType.kind;

    if (kind === FlinkTypeKind.ROW) {
      return new ThemeIcon("symbol-struct");
    }

    if (kind === FlinkTypeKind.MAP) {
      // Use different icons for key vs value based on fieldName
      if (this.parsedType.fieldName === "key") {
        return new ThemeIcon("symbol-key");
      }
      return new ThemeIcon("symbol-value");
    }

    if (kind === FlinkTypeKind.ARRAY) {
      return new ThemeIcon("symbol-array");
    }

    if (kind === FlinkTypeKind.MULTISET) {
      return new ThemeIcon("symbol-array"); // Use array icon for multiset
    }

    // Default for scalars
    return new ThemeIcon("symbol-field");
  }

  /**
   * Get the tooltip content for this node.
   * Provides rich markdown with type information and metadata.
   */
  private getTooltip(): CustomMarkdownString {
    const tooltip = new CustomMarkdownString();

    // Header with type kind label
    const kindLabel = this.getTypeKindLabel();
    tooltip.addHeader(kindLabel);

    // Field/member name if present
    if (this.parsedType.fieldName) {
      tooltip.addField("Name", this.parsedType.fieldName);
    }

    // Data type
    tooltip.addField("Data Type", formatSqlType(this.parsedType.dataType));

    // Nullability
    tooltip.addField("Nullable", this.parsedType.isFieldNullable ? "Yes" : "No");

    // Comment if present
    if (this.parsedType.comment) {
      tooltip.addField("Comment", this.parsedType.comment);
    }

    // Member count for compound types
    if (isCompoundFlinkType(this.parsedType)) {
      const memberCount = this.parsedType.members.length;
      if (this.parsedType.kind === FlinkTypeKind.ROW) {
        tooltip.addField("Fields", memberCount.toString());
      } else if (this.parsedType.kind === FlinkTypeKind.MAP) {
        tooltip.addField("Entries", memberCount.toString());
      } else if (
        this.parsedType.kind === FlinkTypeKind.ARRAY ||
        this.parsedType.kind === FlinkTypeKind.MULTISET
      ) {
        tooltip.addField("Element Type", formatSqlType(this.parsedType.members[0].dataType));
      }
    }

    return tooltip;
  }

  /**
   * Get a human-readable label for the type kind.
   */
  private getTypeKindLabel(): string {
    switch (this.parsedType.kind) {
      case FlinkTypeKind.SCALAR:
        return "Scalar Type";
      case FlinkTypeKind.ROW:
        return "Row Field";
      case FlinkTypeKind.MAP:
        return "Map Entry";
      case FlinkTypeKind.ARRAY:
        return "Array Element";
      case FlinkTypeKind.MULTISET:
        return "Multiset Element";
      default:
        return "Type";
    }
  }

  /**
   * Get child type nodes from this node (for tree expansion).
   * Returns empty array if not expandable.
   *
   * Special case: For ARRAY/MULTISET with compound element types (ROW/MAP),
   * returns the element's children directly (skips the intermediate [element]/[element] node).
   * For ROW/MAP, returns their member nodes directly.
   */
  getChildren(): FlinkTypeNode[] {
    if (!this.isExpandable || !isCompoundFlinkType(this.parsedType)) {
      return [];
    }

    const { kind, members } = this.parsedType;

    // For ARRAY/MULTISET with compound elements, skip intermediate node
    // and return the element's children directly
    if (
      (kind === FlinkTypeKind.ARRAY || kind === FlinkTypeKind.MULTISET) &&
      isCompoundFlinkType(members[0])
    ) {
      const elementType = members[0];
      // Create child nodes from the element's members (ROW fields or MAP entries)
      return elementType.members.map(
        (member) =>
          new FlinkTypeNode({
            parsedType: member,
            parentNode: this,
            parentColumn: this.parentColumn ?? undefined,
            depth: this.depth + 1,
          }),
      );
    }

    // For ROW and MAP, return their members as children
    return members.map(
      (member) =>
        new FlinkTypeNode({
          parsedType: member,
          parentNode: this,
          parentColumn: this.parentColumn ?? undefined,
          depth: this.depth + 1,
        }),
    );
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

    item.iconPath = this.getIcon();
    // Note: Intentionally not setting item.id - FlinkTypeNode instances are ephemeral
    // (recreated on each expand), so using object identity works better than fixed IDs
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

    // For compound types, include member info
    if (isCompoundFlinkType(this.parsedType)) {
      parts.push(this.parsedType.kind.toLowerCase());
      if (this.parsedType.kind === FlinkTypeKind.ROW) {
        parts.push(`${this.parsedType.members.length} fields`);
      }
    }

    return parts.join(" ");
  }
}
