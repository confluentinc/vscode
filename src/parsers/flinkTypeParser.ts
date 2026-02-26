import type {
  FlinkType,
  FlinkAtomicType,
  FlinkTypeWithLength,
  FlinkNumericType,
  FlinkTimestampType,
  FlinkMapType,
  FlinkRowType,
} from "../models/flinkTypes";

/**
 * Parses a Flink SQL FULL_DATA_TYPE string into a FlinkType structure.
 *
 * Handles:
 * - Atomic types: BIGINT, INTEGER, BOOLEAN, DOUBLE, FLOAT, DATE, TIME, etc.
 * - Parameterized types: VARCHAR(255), DECIMAL(10,2), TIMESTAMP(3)
 * - Nullability: "NOT NULL" suffix
 * - Arrays: ARRAY<...> and ARRAY<...> NOT NULL
 * - Multisets: MULTISET<...> and MULTISET<...> NOT NULL
 * - Composite types: ROW<...>, MAP<...>
 *
 * @param fullDataType - The FULL_DATA_TYPE string from Flink information schema
 * @returns Parsed FlinkType structure representing the type hierarchy
 * @throws Error if the input string cannot be parsed
 *
 * @example
 * parseFlinkType("VARCHAR(255)") // Returns FlinkTypeWithLength { typeName: "VARCHAR", maxLength: 255, ... }
 * parseFlinkType("DECIMAL(10,2) NOT NULL") // Returns FlinkNumericType { precision: 10, scale: 2, isNullable: false, ... }
 * parseFlinkType("ARRAY<BIGINT>") // Returns FlinkAtomicType { typeName: "BIGINT", isArray: true, ... }
 */
export function parseFlinkType(fullDataType: string): FlinkType {
  if (!fullDataType || typeof fullDataType !== "string") {
    throw new Error("Input must be a non-empty string");
  }

  const input = fullDataType.trim();
  if (input.length === 0) {
    throw new Error("Input must be a non-empty string");
  }

  const { type } = parseTypeInternal(input);
  return type;
}

/**
 * Internal parser for a complete type including decorators and nullability.
 * Parses recursively: unwraps ARRAY/MULTISET decorators and recursively
 * parses the inner content.
 */
function parseTypeInternal(input: string): { type: FlinkType; remaining: string } {
  let remaining = input.trim();
  const upperRemaining = remaining.toUpperCase();

  // Check for ARRAY/MULTISET decorator (with optional whitespace before <)
  const arrayMatch = /^ARRAY\s*</i.exec(upperRemaining);
  const multisetMatch = /^MULTISET\s*</i.exec(upperRemaining);

  if (arrayMatch) {
    // Extract ARRAY<...> and parse recursively
    const afterKeyword = remaining.substring(arrayMatch[0].length);
    const { content, rest } = extractBalancedAngleBrackets(afterKeyword);

    // Parse the content inside the array recursively
    const { type: innerType } = parseTypeInternal(content);

    // Parse outer nullability (after the closing bracket)
    const { isNullable } = parseNotNull(rest);

    // Merge decorators
    innerType.isArray = true;
    innerType.arrayMembersAreNullable = innerType.isNullable; // Inner nullability becomes array member nullability
    innerType.isNullable = isNullable; // Outer nullability

    return { type: innerType, remaining: "" };
  }

  if (multisetMatch) {
    // Extract MULTISET<...> and parse recursively
    const afterKeyword = remaining.substring(multisetMatch[0].length);
    const { content, rest } = extractBalancedAngleBrackets(afterKeyword);

    // Parse the content inside the multiset recursively
    const { type: innerType } = parseTypeInternal(content);

    // Parse outer nullability (after the closing bracket)
    const { isNullable } = parseNotNull(rest);

    // Merge decorators
    innerType.isMultiset = true;
    innerType.multisetMembersAreNullable = innerType.isNullable; // Inner nullability becomes multiset member nullability
    innerType.isNullable = isNullable; // Outer nullability

    return { type: innerType, remaining: "" };
  }

  // Step 2: Parse the base type (atomic, parameterized, or composite) with nullability
  const { typeString: baseTypeString, isNullable } = parseNotNull(remaining);

  if (baseTypeString.length === 0) {
    throw new Error("No type found in input");
  }

  // Check if it's a composite type (ROW or MAP)
  if (baseTypeString.toUpperCase().startsWith("ROW<")) {
    const { content: rowContent, rest } = extractBalancedAngleBrackets(baseTypeString.substring(4));
    const children = parseRowFields(rowContent);
    const rowType: FlinkRowType = {
      typeName: "ROW",
      isNullable,
      isArray: false,
      arrayMembersAreNullable: false,
      isMultiset: false,
      multisetMembersAreNullable: false,
      children,
    };
    return { type: rowType, remaining: rest };
  }

  if (baseTypeString.toUpperCase().startsWith("MAP<")) {
    const { content: mapContent, rest } = extractBalancedAngleBrackets(baseTypeString.substring(4));
    const children = parseMapKeyValue(mapContent);
    const mapType: FlinkMapType = {
      typeName: "MAP",
      isNullable,
      isArray: false,
      arrayMembersAreNullable: false,
      isMultiset: false,
      multisetMembersAreNullable: false,
      children,
    };
    return { type: mapType, remaining: rest };
  }

  // Otherwise, parse as atomic or parameterized type
  const type = parseAtomicOrParameterizedType(baseTypeString, {
    isNullable,
    isArray: false,
    arrayMembersAreNullable: false,
    isMultiset: false,
    multisetMembersAreNullable: false,
  });

  return { type, remaining: "" };
}

/**
 * Parses atomic and parameterized types.
 * Returns a FlinkType with appropriate subinterface based on type name.
 */
function parseAtomicOrParameterizedType(
  typeString: string,
  decorators: {
    isNullable: boolean;
    isArray: boolean;
    arrayMembersAreNullable: boolean;
    isMultiset: boolean;
    multisetMembersAreNullable: boolean;
  },
): FlinkType {
  const trimmed = typeString.trim();

  // Extract type name and parameters
  const { typeName, parameters } = extractTypeNameAndParameters(trimmed);

  // Normalize type name to uppercase
  const normalizedTypeName = typeName.toUpperCase();

  // Determine which interface to use based on type name
  if (isStringType(normalizedTypeName)) {
    // VARCHAR, CHAR, BINARY, VARBINARY
    const type: FlinkTypeWithLength = {
      typeName: normalizedTypeName,
      isNullable: decorators.isNullable,
      isArray: decorators.isArray,
      arrayMembersAreNullable: decorators.arrayMembersAreNullable,
      isMultiset: decorators.isMultiset,
      multisetMembersAreNullable: decorators.multisetMembersAreNullable,
      maxLength: parameters.length > 0 ? Number.parseInt(parameters[0], 10) : undefined,
    };
    return type;
  }

  if (isNumericType(normalizedTypeName)) {
    // DECIMAL, NUMERIC
    const type: FlinkNumericType = {
      typeName: normalizedTypeName,
      isNullable: decorators.isNullable,
      isArray: decorators.isArray,
      arrayMembersAreNullable: decorators.arrayMembersAreNullable,
      isMultiset: decorators.isMultiset,
      multisetMembersAreNullable: decorators.multisetMembersAreNullable,
      precision: parameters.length > 0 ? Number.parseInt(parameters[0], 10) : undefined,
      scale: parameters.length > 1 ? Number.parseInt(parameters[1], 10) : undefined,
    };
    return type;
  }

  if (isTimestampType(normalizedTypeName)) {
    // TIMESTAMP, TIMESTAMP_LTZ, TIME
    const type: FlinkTimestampType = {
      typeName: normalizedTypeName,
      isNullable: decorators.isNullable,
      isArray: decorators.isArray,
      arrayMembersAreNullable: decorators.arrayMembersAreNullable,
      isMultiset: decorators.isMultiset,
      multisetMembersAreNullable: decorators.multisetMembersAreNullable,
      precision: parameters.length > 0 ? Number.parseInt(parameters[0], 10) : undefined,
    };
    return type;
  }

  // Default to FlinkAtomicType for all other types (including unknown types)
  const type: FlinkAtomicType = {
    typeName: normalizedTypeName,
    isNullable: decorators.isNullable,
    isArray: decorators.isArray,
    arrayMembersAreNullable: decorators.arrayMembersAreNullable,
    isMultiset: decorators.isMultiset,
    multisetMembersAreNullable: decorators.multisetMembersAreNullable,
  };
  return type;
}

/**
 * Parses ROW field definitions into an array of FlinkType children.
 * Format: "field1 type1, field2 type2, ..."
 * Each field has its rowFieldName set to the field name.
 * Fields may have optional comments: "field1 type1 'comment', field2 type2, ..."
 */
function parseRowFields(rowContent: string): FlinkType[] {
  const fields: FlinkType[] = [];
  let remaining = rowContent.trim();

  while (remaining.length > 0) {
    // Extract the next field name and type
    // Format: fieldName type [comment], fieldName type [comment], ...
    // Field names can be unquoted or backtick-quoted for reserved words

    let fieldName: string;
    let afterFieldName: string;

    // Check for backtick-quoted field name
    if (remaining.startsWith("`")) {
      const closeBacktick = remaining.indexOf("`", 1);
      if (closeBacktick === -1) {
        throw new Error(`Invalid ROW field syntax: unclosed backtick in ${remaining}`);
      }
      fieldName = remaining.substring(1, closeBacktick);
      afterFieldName = remaining.substring(closeBacktick + 1).trim();
    } else {
      // Unquoted field name
      const fieldMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s+/.exec(remaining);
      if (!fieldMatch) {
        throw new Error(`Invalid ROW field syntax: ${remaining}`);
      }
      fieldName = fieldMatch[1];
      afterFieldName = remaining.substring(fieldMatch[0].length);
    }

    // Extract type and optional comment
    const { typeString, comment, restAfterField } = extractFieldType(afterFieldName);

    // Recursively parse the type
    const { type: fieldType } = parseTypeInternal(typeString);
    fieldType.rowFieldName = fieldName;
    if (comment) {
      fieldType.comment = comment;
    }

    fields.push(fieldType);

    // Move to next field (comma already consumed by extractFieldType)
    remaining = restAfterField.trim();
  }

  return fields;
}

/**
 * Finds the end of a type string within ROW content, accounting for brackets and quotes.
 * Returns the index where the type ends (at comma, quote, or end of string).
 */
function findTypeEnd(input: string): number {
  let depth = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (char === "<" || char === "(") {
      depth++;
    } else if (char === ">" || char === ")") {
      depth--;
    } else if ((char === "," || char === "'") && depth === 0) {
      return i;
    }
  }

  return input.length;
}

/**
 * Extracts a single quoted comment from input, handling escaped quotes.
 * Assumes input starts with a single quote.
 * Returns the comment text (unescaped) and index after the closing quote.
 */
function extractQuotedComment(input: string): { comment: string; endIndex: number } {
  // Skip opening quote
  let i = 1;
  let commentEnd = -1;

  while (i < input.length) {
    if (input[i] === "'" && i + 1 < input.length && input[i + 1] === "'") {
      // Escaped quote - skip both
      i += 2;
    } else if (input[i] === "'") {
      // Closing quote
      commentEnd = i;
      i++;
      break;
    } else {
      i++;
    }
  }

  if (commentEnd === -1) {
    throw new Error(`Unclosed comment quote in ROW field: ${input}`);
  }

  const rawComment = input.substring(1, commentEnd);
  const comment = rawComment.replaceAll("''", "'").trim();

  return { comment, endIndex: i };
}

/**
 * Extracts a single field's type string from ROW content, including optional comment.
 * Handles nested angle brackets and parentheses properly.
 * Comments appear in single quotes after the type: `type 'comment text'`
 * Escaped quotes within comments are represented as doubled quotes: ''
 * Returns the type string, optional comment, and remaining content after that field.
 */
function extractFieldType(input: string): {
  typeString: string;
  comment: string | undefined;
  restAfterField: string;
} {
  const typeEnd = findTypeEnd(input);
  const typeString = input.substring(0, typeEnd).trim();

  let comment: string | undefined;
  let fieldEnd = typeEnd;

  // Check if there's a comment after the type
  if (typeEnd < input.length && input[typeEnd] === "'") {
    const { comment: extractedComment, endIndex } = extractQuotedComment(input.substring(typeEnd));
    if (extractedComment.length > 0) {
      comment = extractedComment;
    }
    fieldEnd = typeEnd + endIndex;
  }

  // Move past the comma if present
  if (fieldEnd < input.length && input[fieldEnd] === ",") {
    fieldEnd++;
  }

  const restAfterField = fieldEnd < input.length ? input.substring(fieldEnd) : "";

  return { typeString, comment, restAfterField };
}

/**
 * Parses MAP key and value types.
 * Format: "keyType, valueType"
 * Returns array with exactly 2 children: [keyType, valueType]
 */
function parseMapKeyValue(mapContent: string): FlinkType[] {
  // Find the comma separating key and value types
  // Be careful about nested brackets
  let depth = 0;
  let separatorIndex = -1;

  for (let i = 0; i < mapContent.length; i++) {
    const char = mapContent[i];

    if (char === "<" || char === "(") {
      depth++;
    } else if (char === ">" || char === ")") {
      depth--;
    } else if (char === "," && depth === 0) {
      separatorIndex = i;
      break;
    }
  }

  if (separatorIndex === -1) {
    throw new Error(
      `Invalid MAP syntax: expected key and value types separated by comma in: ${mapContent}`,
    );
  }

  const keyString = mapContent.substring(0, separatorIndex).trim();
  const valueString = mapContent.substring(separatorIndex + 1).trim();

  // Parse key and value types
  const { type: keyType } = parseTypeInternal(keyString);
  const { type: valueType } = parseTypeInternal(valueString);

  // Set field names for MAP entries
  keyType.rowFieldName = "key";
  valueType.rowFieldName = "value";

  return [keyType, valueType];
}

/**
 * Extracts type name and parameters from a type string.
 * Note: For multi-word timestamp types like "TIMESTAMP WITH LOCAL TIME ZONE",
 * this function extracts the full multi-word name and preserves any embedded parameters.
 * However, such types currently fall back to FlinkAtomicType since isTimestampType()
 * only recognizes single-word variants (TIMESTAMP, TIMESTAMP_LTZ, TIME).
 * Example: "VARCHAR(255)" => { typeName: "VARCHAR", parameters: ["255"] }
 * Example: "TIMESTAMP(3) WITH LOCAL TIME ZONE" => { typeName: "TIMESTAMP WITH LOCAL TIME ZONE", parameters: ["3"] }
 */
function extractTypeNameAndParameters(typeString: string): {
  typeName: string;
  parameters: string[];
} {
  const trimmed = typeString.trim();
  // Match type name (single word or multi-word like "TIMESTAMP WITH LOCAL TIME ZONE").
  // This regex captures the full type name with any embedded parameters preserved in the name.
  // Pattern: word [parameters] [more words [parameters] ...]
  // Note: The regex is complex but necessary to handle multi-word type names with embedded
  // parameters (e.g., "TIMESTAMP(3) WITH LOCAL TIME ZONE"). Character class [A-Za-z_] and
  // [A-Za-z0-9_] are used instead of \w because type names cannot start with digits.
  // NOSONAR - S5843: Regex complexity is intentional for Flink type parsing
  const match =
    /^([A-Za-z_][A-Za-z0-9_]*(?:\s*\([^)]*\))?(?:\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*\([^)]*\))?)*)\s*(.*)$/.exec(
      trimmed,
    );

  if (!match) {
    throw new Error(`Invalid type syntax: ${typeString}`);
  }

  const typeNameWithParams = match[1];
  const afterTypeName = match[2];

  // Check for malformed syntax (e.g., unclosed parentheses or garbage after)
  if (afterTypeName && afterTypeName.trim()) {
    throw new Error(`Invalid type syntax: ${typeString}`);
  }

  // Extract parameters from the type name (e.g., "VARCHAR(255)" or "TIMESTAMP(3) WITH LOCAL TIME ZONE")
  const paramMatches = Array.from(typeNameWithParams.matchAll(/\(([^)]*)\)/g));

  // Strip parameters from type name to get the base type (e.g., "VARCHAR" from "VARCHAR(255)")
  const typeName = typeNameWithParams.replaceAll(/\s*\([^)]*\)/g, "").trim();

  if (paramMatches.length === 0) {
    return { typeName, parameters: [] };
  }

  // Collect all parameters from all parentheses
  const parameters = paramMatches.flatMap((m) => m[1].split(",").map((p) => p.trim()));
  return { typeName, parameters };
}

/**
 * Parses "NOT NULL" suffix from a type string.
 * Returns the type string without the suffix and the nullability flag.
 */
function parseNotNull(input: string): { typeString: string; isNullable: boolean } {
  const trimmed = input.trim();
  const notNullMatch = /NOT\s+NULL\s*$/i;

  if (notNullMatch.test(trimmed)) {
    const typeString = trimmed.replace(notNullMatch, "").trim();
    return { typeString, isNullable: false };
  }

  return { typeString: trimmed, isNullable: true };
}

/**
 * Extracts a balanced angle bracket expression: extracts content between < and >
 * Returns the content and remaining input after the closing >.
 * The opening < is assumed to be already consumed.
 */
function extractBalancedAngleBrackets(input: string): {
  content: string;
  rest: string;
} {
  let depth = 1; // We're starting after the opening <
  let contentEnd = -1;

  for (let i = 0; i < input.length; i++) {
    if (input[i] === "<") {
      depth++;
    } else if (input[i] === ">") {
      depth--;
      if (depth === 0) {
        contentEnd = i;
        break;
      }
    }
  }

  if (contentEnd === -1) {
    throw new Error(`Unmatched angle bracket in: ${input}`);
  }

  const content = input.substring(0, contentEnd);
  const rest = input.substring(contentEnd + 1);

  return { content, rest };
}

/**
 * Checks if a type name is a string/binary type (with length parameter).
 */
function isStringType(typeName: string): boolean {
  return ["VARCHAR", "CHAR", "BINARY", "VARBINARY", "BYTES"].includes(typeName);
}

/**
 * Checks if a type name is a numeric type (with precision/scale parameters).
 */
function isNumericType(typeName: string): boolean {
  return ["DECIMAL", "NUMERIC"].includes(typeName);
}

/**
 * Checks if a type name is a timestamp/temporal type (with precision parameter).
 * Recognizes single-word timestamp variants: TIMESTAMP, TIMESTAMP_LTZ, and TIME.
 * Multi-word variants like "TIMESTAMP WITH LOCAL TIME ZONE" are not recognized
 * and will fall back to FlinkAtomicType. This is a known limitation that could be
 * addressed in a future enhancement.
 */
function isTimestampType(typeName: string): boolean {
  return ["TIMESTAMP", "TIMESTAMP_LTZ", "TIME"].includes(typeName);
}
