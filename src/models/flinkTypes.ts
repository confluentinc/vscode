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
 * Common fields present on all type variants, whether scalar or composite.
 */
export interface FlinkType {
  /**
   * The data type name, including any size or precision designators.
   * Examples: 'DATE', 'VARCHAR(256)', 'TIME STAMP WITH TIME ZONE'
   * For containers: just the base name without the angle bracket content.
   */
  dataType: string;

  /**
   * Is this field/type nullable as a whole?
   * True means the value itself can be NULL.
   * False means the value cannot be NULL.
   */
  isFieldNullable: boolean;

  /**
   * Enumeration indicating the kind of type: scalar, ROW, MAP, ARRAY, or MULTISET.
   */
  kind: FlinkTypeKind;

  /**
   * For ARRAY or MULTISET types: are the individual members allowed to be null?
   * For other types: not applicable (undefined).
   * This is separate from isFieldNullable, which applies to the container itself.
   */
  areMembersNullable?: boolean;

  /**
   * For ROW/MAP member fields: the field/member name.
   * For MAP specifically, this will be "key" or "value".
   * Undefined for standalone types or scalar types.
   */
  fieldName?: string;

  /**
   * Optional comment/documentation for this field.
   * Only defined for ROW member fields.
   * May span multiple lines. Interior single quotes are escaped as doubled quotes ('').
   */
  comment?: string;
}

/**
 * Composite Flink type (subinterface of FlinkType).
 *
 * Extends FlinkType for types that contain sub-members: ROW and MAP.
 * The members array provides structured access to nested types.
 */
export interface CompoundFlinkType extends FlinkType {
  /**
   * Array of member types.
   * - For ROW: each element has a fieldName
   * - For MAP: exactly 2 elements with fieldNames "key" and "value" (key first)
   */
  members: FlinkType[];
}

/**
 * Type guard to check if a FlinkType is a CompoundFlinkType.
 *
 * @param type - The FlinkType to check
 * @returns true if the type is a compound type with members
 */
export function isCompoundFlinkType(type: FlinkType): type is CompoundFlinkType {
  return "members" in type && Array.isArray((type as CompoundFlinkType).members);
}
