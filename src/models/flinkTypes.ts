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
 * Represents either a standalone type or a member within a compound type.
 * Common fields present on all type variants, whether scalar or composite.
 */
export interface FlinkType {
  /**
   * Enumeration indicating the kind of type: scalar, ROW, MAP, ARRAY, or MULTISET.
   */
  kind: FlinkTypeKind;

  /**
   * The data type name, including any size or precision designators.
   * Examples: 'DATE', 'VARCHAR(256)', 'TIMESTAMP WITH TIME ZONE'
   * For containers: just the base name without the angle bracket content.
   */
  dataType: string;

  /**
   * Is this field/type nullable as a whole?
   */
  isFieldNullable: boolean;

  /**
   * For ROW, MAP, ARRAY, or MULTISET types: the contained member types.
   * - For ROW: each element has a fieldName
   * - For MAP: exactly 2 elements with fieldNames "key" and "value" (key first)
   * - For ARRAY/MULTISET: exactly 1 element (no fieldName)
   */
  members?: FlinkType[];

  /**
   * For ROW/MAP member fields: the field/member name.
   * For MAP specifically, this will be "key" or "value".
   * Undefined for standalone types, scalar types, or ARRAY/MULTISET element types.
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
 * Compound Flink type (subinterface of FlinkType).
 *
 * Extends FlinkType for types that contain sub-members: ROW, MAP, ARRAY, and MULTISET.
 * The members array is guaranteed to be non-empty and provides structured access to nested types.
 */
export interface CompoundFlinkType extends FlinkType {
  /**
   * Non-empty array of member types (required for compound types).
   * - For ROW: each element has a fieldName (2+ elements for practical schemas)
   * - For MAP: exactly 2 elements with fieldNames "key" and "value" (key first)
   * - For ARRAY/MULTISET: exactly 1 element (no fieldName)
   */
  members: FlinkType[];
}

/**
 * Type guard to check if a FlinkType is a CompoundFlinkType.
 * Returns true if the type has a non-empty members array.
 * Validates that if members are present, the kind must not be SCALAR (which would be invalid).
 *
 * @param type - The FlinkType to check
 * @returns true if the type has a non-empty members array and is not SCALAR kind.
 * @returns false if the type does not have a members array and is SCALAR kind
 * @throws Error if there is a mismatch between the presence of members and the kind (e.g., SCALAR with members or non-SCALAR without members)
 */
export function isCompoundFlinkType(type: FlinkType): type is CompoundFlinkType {
  const hasMembers =
    "members" in type &&
    Array.isArray((type as CompoundFlinkType).members) &&
    (type as CompoundFlinkType).members.length > 0;

  if (hasMembers && type.kind === FlinkTypeKind.SCALAR) {
    throw new Error(`Invalid type: kind is ${type.kind} but members array is present.`);
  }

  if (!hasMembers && type.kind !== FlinkTypeKind.SCALAR) {
    throw new Error(`Invalid type: kind is ${type.kind} but members array is missing or empty.`);
  }

  return hasMembers;
}
