import { IconNames } from "../icons";
import type { FlinkType } from "../models/flinkTypes";
import { FlinkTypeKind, isCompoundFlinkType } from "../models/flinkTypes";

/**
 * Returns a display-friendly version of the data type by removing max-int size specifications and escaping backticks.
 */
export function formatSqlType(sqlType: string): string {
  // Remove noisy (2GBs) max size type values
  const cleaned = sqlType.replaceAll(/\(2147483647\)/g, "");
  // Remove backticks that are part of SQL syntax (e.g., in ROW<`field` VARCHAR>)
  return cleaned.replaceAll("`", "");
}

/**
 * Format a parsed FlinkType for display in the UI.
 * Provides unified display format for Flink types whether they are top-level columns or nested within structures.
 *
 * Rules:
 * - ROW types: "ROW"
 * - MAP types: "MAP"
 * - ARRAY types: "{ElementType}[]" (e.g., "INT[]", "ROW[]")
 * - MULTISET types: "{ElementType} MULTISET" (e.g., "VARCHAR MULTISET")
 * - Scalar types: Formatted type name (e.g., "INT", "VARCHAR(255)")
 *
 * @param flinkType - The parsed FlinkType to format
 * @returns A display-friendly string representation of the type
 */
export function formatFlinkTypeForDisplay(flinkType: FlinkType): string {
  // Simple ROW/MAP: just return the kind name
  if (flinkType.kind === FlinkTypeKind.ROW) {
    return "ROW";
  }
  if (flinkType.kind === FlinkTypeKind.MAP) {
    return "MAP";
  }

  // For ARRAY/MULTISET, show element type
  if (isCompoundFlinkType(flinkType)) {
    if (flinkType.kind === FlinkTypeKind.ARRAY) {
      const elementType = formatSqlType(flinkType.members[0].dataType);
      return `${elementType}[]`;
    }
    if (flinkType.kind === FlinkTypeKind.MULTISET) {
      const elementType = formatSqlType(flinkType.members[0].dataType);
      return `${elementType} MULTISET`;
    }
  }

  // Scalar types
  return formatSqlType(flinkType.dataType);
}

/**
 * Get the icon name for a Flink type.
 * Uses special icons for ROW and ARRAY/MULTISET types, defaults to column icon for others.
 *
 * Rules:
 * - ROW types: symbol-struct (FLINK_TYPE_ROW)
 * - ARRAY/MULTISET types: symbol-array (FLINK_TYPE_ARRAY)
 * - All other types: symbol-constant (default column icon)
 *
 * @param flinkType - The parsed FlinkType to get an icon for
 * @returns A string icon name suitable for use with ThemeIcon
 */
export function getIconForFlinkType(flinkType: FlinkType): IconNames {
  if (flinkType.kind === FlinkTypeKind.ROW) {
    return IconNames.FLINK_TYPE_ROW;
  }

  if (isCompoundFlinkType(flinkType)) {
    if (flinkType.kind === FlinkTypeKind.ARRAY || flinkType.kind === FlinkTypeKind.MULTISET) {
      return IconNames.FLINK_TYPE_ARRAY;
    }
  }

  return IconNames.FLINK_FUNCTION;
}
