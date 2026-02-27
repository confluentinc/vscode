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
