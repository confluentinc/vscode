/**
 * Simplified Flink type model for UI purposes.
 *
 * This module defines the data structures for representing Flink SQL data types.
 * The model is designed to be simple, focused on UI display needs, and not overly complex.
 */

/**
 * Enumeration of type kinds for Flink types.
 */
export enum FlinkTypeKind {
  /** Scalar/atomic type (INT, VARCHAR, DECIMAL, TIMESTAMP, etc.) */
  SCALAR = "SCALAR",
  /** ROW type - structured record with named fields */
  ROW = "ROW",
  /** MAP type - key-value pairs */
  MAP = "MAP",
  /** ARRAY container (ARRAY<T>) */
  ARRAY = "ARRAY",
  /** MULTISET container (MULTISET<T>) */
  MULTISET = "MULTISET",
}

/**
 * Base interface for all Flink types.
 *
 * Contains common fields shared by both scalar and compound types.
 * Should not be instantiated directly; use the discriminated union type {@link FlinkType} instead.
 */
interface BaseFlinkType {
  /**
   * Enumeration indicating the kind of type: SCALAR, ROW, MAP, ARRAY, or MULTISET.
   */
  kind: FlinkTypeKind;

  /**
   * The data type name, including any size or precision designators.
   * Examples: 'DATE', 'VARCHAR(256)', 'TIMESTAMP WITH TIME ZONE', 'ROW', 'MAP', 'ARRAY', 'MULTISET'
   */
  dataType: string;

  /**
   * The full SQL data type string for this node and all its nested members.
   * This is the substring of the original data type string that corresponds to this specific type.
   * Examples:
   * - Scalar: "INT", "VARCHAR(255)"
   * - ROW: "ROW<id INT, name VARCHAR>"
   * - ARRAY: "INT ARRAY"
   * - MULTISET: "ROW<...> MULTISET"
   * Used for tooltip display to show users the exact SQL definition.
   */
  fullDataTypeString: string;

  /**
   * Is this field/type nullable as a whole?
   */
  isFieldNullable: boolean;

  /**
   * For ROW/MAP member fields: the field/member name.
   * For MAP specifically, this will be "key" or "value".
   * Undefined for standalone types or array/multiset element types.
   */
  fieldName?: string;

  /**
   * Optional comment/documentation for this field.
   * Only defined for ROW member fields.
   * Returned unescaped: doubled single quotes ('') in the input are converted to single quotes (').
   */
  comment?: string;
}

/**
 * Scalar Flink type (no members).
 *
 * Represents atomic types like INT, VARCHAR, DECIMAL, TIMESTAMP, etc.
 * Scalars do not have member types and cannot be expanded in tree views.
 */
export interface ScalarFlinkType extends BaseFlinkType {
  /**
   * Enumeration indicating the kind of type: SCALAR.
   * Represents atomic, non-composite types (including parameterized scalars like VARCHAR(255)).
   */
  kind: FlinkTypeKind.SCALAR;
}

/**
 * Compound Flink type (with members).
 *
 * Represents composite types that contain member types: ROW, MAP, ARRAY, and MULTISET.
 * The members array is guaranteed to be non-empty.
 */
export interface CompoundFlinkType extends BaseFlinkType {
  /**
   * Enumeration indicating the kind of compound type: ROW, MAP, ARRAY, or MULTISET.
   */
  kind: FlinkTypeKind.ROW | FlinkTypeKind.MAP | FlinkTypeKind.ARRAY | FlinkTypeKind.MULTISET;

  /**
   * Non-empty array of member types (required and guaranteed non-empty for compound types).
   * - For ROW: each element has a fieldName (2+ elements for practical schemas)
   * - For MAP: exactly 2 elements with fieldNames "key" and "value" (key first)
   * - For ARRAY/MULTISET: exactly 1 element (no fieldName)
   */
  members: FlinkType[];
}

/**
 * Union type representing any Flink type: scalar or compound.
 *
 * Use the {@link isCompoundFlinkType} type guard to discriminate between
 * scalar and compound types in a type-safe manner.
 */
export type FlinkType = ScalarFlinkType | CompoundFlinkType;

/**
 * Type guard to check if a FlinkType is a CompoundFlinkType.
 *
 * This provides compile-time type narrowing: after calling this function,
 * TypeScript will know that the type has a non-optional `members` array.
 *
 * @param type - The FlinkType to check
 * @returns true if the type is compound (ROW, MAP, ARRAY, or MULTISET) with members
 */
export function isCompoundFlinkType(type: FlinkType): type is CompoundFlinkType {
  return (
    type.kind === FlinkTypeKind.ROW ||
    type.kind === FlinkTypeKind.ARRAY ||
    type.kind === FlinkTypeKind.MULTISET ||
    type.kind === FlinkTypeKind.MAP
  );
}
