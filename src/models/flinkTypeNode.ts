/**
 * Represents a parsed Flink type node for display in the TreeView.
 *
 * Used as intermediate tree items when expanding columns with compound types (ROW, MAP, ARRAY<compound>, etc.).
 * Provides tree item rendering with proper icons, labels, and descriptions for each type kind.
 */

import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from "vscode";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID } from "../constants";
import { IconNames } from "../icons";
import { formatFlinkTypeForDisplay, formatSqlType } from "../utils/flinkTypes";
import type { CompoundFlinkType, FlinkType } from "./flinkTypes";
import { FlinkTypeKind, isCompoundFlinkType } from "./flinkTypes";
import { CustomMarkdownString } from "./main";
import type { ConnectionId, IResourceBase } from "./resource";

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
  /** ID of the parent FlinkRelationColumn (if this is a direct child of a column) */
  readonly parentColumnId: string | null;

  /** If this node is nested within another FlinkTypeNode, reference to the parent */
  readonly parentNode: FlinkTypeNode | null;

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
   * @param props.parentColumnId Optional ID of parent FlinkRelationColumn (if direct child of column)
   * @param props.parentNode Optional parent FlinkTypeNode (if nested)
   */
  constructor(props: {
    parsedType: FlinkType;
    parentColumnId?: string;
    parentNode?: FlinkTypeNode;
  }) {
    this.parsedType = props.parsedType;
    this.parentColumnId = props.parentColumnId ?? null;
    this.parentNode = props.parentNode ?? null;
  }

  /**
   * Unique identifier for this node in the tree hierarchy.
   * Format: "tableRelation.columnName.fieldPath.fieldPath..."
   *
   * Uses field names for all path segments, including ARRAY/MULTISET containers.
   * All segments separated by '.' for consistency.
   * Example: "spotify-listening-data.track.artists.uri"
   */
  get id(): string {
    const path: string[] = [];

    // Collect all parent nodes in order from root to this node
    const nodeChain: FlinkTypeNode[] = [this];
    let node: FlinkTypeNode | null = this.parentNode;
    while (node) {
      nodeChain.unshift(node); // prepends to maintain root-to-leaf order
      node = node.parentNode;
    }

    // Add column id first if we have one
    if (this.parentColumnId) {
      path.push(this.parentColumnId);
    }

    // Add field names from all nodes in the chain
    for (const chainNode of nodeChain) {
      const fieldName = chainNode.parsedType.fieldName;
      if (fieldName) {
        path.push(fieldName);
      }
    }

    return path.join(".");
  }

  /**
   * Get the icon name for this type node.
   * Uses special icons for ROW, ARRAY, and MULTISET types, defaults to function icon for others.
   */
  get iconName(): IconNames {
    switch (this.parsedType.kind) {
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
   * Get the formatted display string for this type.
   * For use in UI labels, descriptions, and other display contexts.
   */
  get formattedType(): string {
    return formatFlinkTypeForDisplay(this.parsedType);
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
    return isCompoundFlinkType(members[0]);
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
   * Returns empty array if not expandable. If expandable, returns the appropriate child nodes.
   *
   * For ROW/MAP: returns member field nodes directly.
   * For ARRAY/MULTISET with compound element types: returns the element's children directly
   * (skips the intermediate container node for better UX). Since isExpandable() validates this
   * condition, we can safely access members[0].members without additional checks.
   */
  getChildren(): FlinkTypeNode[] {
    if (!this.isExpandable) {
      return [];
    }

    const { kind, members } = this.parsedType as CompoundFlinkType;

    // ROW and MAP: return member nodes directly
    if (kind === FlinkTypeKind.ROW || kind === FlinkTypeKind.MAP) {
      return members.map(
        (member: FlinkType) =>
          new FlinkTypeNode({
            parsedType: member,
            parentNode: this,
            parentColumnId: this.parentColumnId ?? undefined,
          }),
      );
    }

    // ARRAY/MULTISET with compound elements: return the element's children directly
    // (skips the intermediate [element] node for cleaner UX)
    // Note: isExpandable() ensures the element is compound, so we can safely access members[0].members
    const elementType = members[0] as CompoundFlinkType;
    return elementType.members.map(
      (member: FlinkType) =>
        new FlinkTypeNode({
          parsedType: member,
          parentNode: this,
          parentColumnId: this.parentColumnId ?? undefined,
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
