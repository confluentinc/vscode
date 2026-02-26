/**
 * Flink SQL type system models for parsing FULL_DATA_TYPE strings.
 * These types represent the parsed structure of complex Flink data types
 * including ROW, ARRAY, MAP, and MULTISET with proper nullability semantics.
 *
 * Design Philosophy: These interfaces model field patterns, not 1:1 mappings with
 * Flink types. Multiple Flink types can share the same interface when they have
 * identical field requirements. The typeName property distinguishes between Flink
 * types that use the same interface.
 */

/**
 * Base interface for all parsed Flink SQL data types.
 */
export interface FlinkType {
  /** The base type name (VARCHAR, BIGINT, ROW, MAP, etc.) - normalized to uppercase */
  typeName: string;

  /** Whether this field itself can contain NULL values */
  isNullable: boolean;

  /** Whether this field is an array type (cross-cutting concern) */
  isArray: boolean;

  /**
   * If isArray is true, whether array members can be null.
   * Example: ARRAY<VARCHAR NOT NULL> has arrayMembersAreNullable=false.
   * Should never be true if isArray is false.
   */
  arrayMembersAreNullable: boolean;

  /** Whether this field is a multiset type (cross-cutting concern) */
  isMultiset: boolean;

  /**
   * If isMultiset is true, whether multiset members can be null.
   * Should never be true if isMultiset is false.
   */
  multisetMembersAreNullable: boolean;

  /**
   * Name assigned only when this type is modeling a named component of a ROW.
   * Example: In ROW<album_type VARCHAR>, the VARCHAR type has rowFieldName="album_type".
   * Undefined for all other contexts (top-level columns, MAP keys/values, ARRAY elements).
   */
  rowFieldName?: string;

  /** Optional field-level comment */
  comment?: string;
}

/**
 * Marker interface for atomic (non-composite) types with no additional fields.
 * Use directly for types with no additional fields beyond FlinkType base properties.
 * Examples: BOOLEAN, BIGINT, INTERVAL types, etc.
 */
export interface FlinkAtomicType extends FlinkType {
  // Marker only - no additional fields
}

/**
 * String and binary types with optional maximum length.
 * Examples: VARCHAR(255), CHAR(10), BINARY(100), VARBINARY(1024)
 */
export interface FlinkTypeWithLength extends FlinkAtomicType {
  /** Maximum length in characters or bytes, if specified */
  maxLength?: number;
}

/**
 * Numeric types with optional precision and scale.
 * Examples: DECIMAL(10,2), NUMERIC(5)
 */
export interface FlinkNumericType extends FlinkAtomicType {
  /** Total number of digits, if specified */
  precision?: number;

  /** Number of digits to the right of the decimal point, if specified */
  scale?: number;
}

/**
 * Temporal types with optional fractional seconds precision.
 * Examples: TIMESTAMP(3), TIME(6), TIMESTAMP_LTZ(9)
 */
export interface FlinkTimestampType extends FlinkAtomicType {
  /** Precision for fractional seconds, if specified */
  precision?: number;
}

/**
 * Base interface for composite types with child fields (ROW and MAP).
 */
export interface FlinkCompositeType extends FlinkType {
  /** Ordered child types, each with optional rowFieldName populated */
  children: FlinkType[];
}

/**
 * MAP type with key and value types.
 * typeName will be "MAP"
 * Exactly 2 children with rowFieldName="key" and rowFieldName="value"
 */
export interface FlinkMapType extends FlinkCompositeType {
  // Note: children array has exactly 2 elements
  // children[0] is the key type (cannot be null in Flink)
  // children[1] is the value type (can be nullable)
}

/**
 * ROW type with named fields.
 * typeName will be "ROW"
 * Open-ended array of children, each representing a named field
 */
export interface FlinkRowType extends FlinkCompositeType {
  // Note: children array can have any number of elements
  // Each child has its rowFieldName set to the field name
  // Preserves field order from type definition
}
