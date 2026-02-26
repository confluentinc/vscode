/**
 * Flink SQL data type parser.
 *
 * Uses a simple recursive descent parser with peek() and consume() operations
 * to parse Flink SQL type definitions into FlinkType structures.
 *
 * Design: minimal regex use, simple character-by-character parsing.
 */

import type { CompoundFlinkType, FlinkType } from "../models/flinkTypes";
import { FlinkTypeKind } from "../models/flinkTypes";
import { ParserState } from "./parserState";

/**
 * Parse a Flink SQL type definition string into a FlinkType structure.
 *
 * Handles all Flink types: scalars, parameterized types, arrays, multisets, ROW, and MAP.
 *
 * @param input - The type definition string to parse (e.g., "VARCHAR(255)", "ROW<id BIGINT, name VARCHAR>")
 * @returns A FlinkType structure representing the parsed type
 * @throws Error if the input cannot be parsed
 */
export function parseFlinkType(input: string): FlinkType {
  const parser = new FlinkTypeParser(input);
  return parser.parse();
}

/**
 * Recursive descent parser for Flink SQL type definitions.
 *
 * Maintains parser state and provides methods for parsing different type categories.
 * Low-level state operations (peek, consume) are delegated to ParserState.
 * High-level type parsing logic is encapsulated here.
 */
class FlinkTypeParser {
  private readonly state: ParserState;

  constructor(input: string) {
    // Flink uses angle brackets for type parameters and parentheses for function parameters
    this.state = new ParserState(input, "()<>");
  }

  /**
   * Main entry point for parsing a type from the current parser state.
   * @returns Parsed FlinkType
   */
  parse(): FlinkType {
    this.state.skipWhitespace();

    if (this.state.tryConsume("ARRAY")) {
      return this.parseArrayType();
    }

    if (this.state.tryConsume("MULTISET")) {
      return this.parseMultisetType();
    }

    if (this.state.tryConsume("ROW")) {
      return this.parseRowType();
    }

    if (this.state.tryConsume("MAP")) {
      return this.parseMapType();
    }

    // Default to scalar or parameterized type
    return this.parseScalarType();
  }

  /**
   * Parse an ARRAY<T> type.
   */
  private parseArrayType(): CompoundFlinkType {
    this.state.skipWhitespace();
    if (!this.state.tryConsume("<")) {
      throw new Error("Expected '<' after ARRAY");
    }
    const innerType = this.parse();
    if (!this.state.tryConsume(">")) {
      throw new Error("Expected '>' to close ARRAY");
    }
    this.state.skipWhitespace();
    const isFieldNullable = this.parseNullability();
    return {
      dataType: "ARRAY",
      isFieldNullable,
      kind: FlinkTypeKind.ARRAY,
      members: [innerType],
    };
  }

  /**
   * Parse a MULTISET<T> type.
   */
  private parseMultisetType(): CompoundFlinkType {
    this.state.skipWhitespace();
    if (!this.state.tryConsume("<")) {
      throw new Error("Expected '<' after MULTISET");
    }
    const innerType = this.parse();
    if (!this.state.tryConsume(">")) {
      throw new Error("Expected '>' to close MULTISET");
    }
    this.state.skipWhitespace();
    const isFieldNullable = this.parseNullability();
    return {
      dataType: "MULTISET",
      isFieldNullable,
      kind: FlinkTypeKind.MULTISET,
      members: [innerType],
    };
  }

  /**
   * Parse a ROW<...> type.
   */
  private parseRowType(): CompoundFlinkType {
    this.state.skipWhitespace();
    if (!this.state.tryConsume("<")) {
      throw new Error("Expected '<' after ROW");
    }
    const members = this.parseRowMembers();
    if (!this.state.tryConsume(">")) {
      throw new Error("Expected '>' to close ROW");
    }
    this.state.skipWhitespace();
    const isFieldNullable = this.parseNullability();
    return {
      dataType: "ROW",
      isFieldNullable,
      kind: FlinkTypeKind.ROW,
      members,
    };
  }

  /**
   * Parse a MAP<K, V> type.
   */
  private parseMapType(): CompoundFlinkType {
    this.state.skipWhitespace();
    if (!this.state.tryConsume("<")) {
      throw new Error("Expected '<' after MAP");
    }
    const members = this.parseMapMembers();
    if (!this.state.tryConsume(">")) {
      throw new Error("Expected '>' to close MAP");
    }
    this.state.skipWhitespace();
    const isFieldNullable = this.parseNullability();
    return {
      dataType: "MAP",
      isFieldNullable,
      kind: FlinkTypeKind.MAP,
      members,
    };
  }

  /**
   * Parse a scalar or parameterized type (e.g., INT, VARCHAR(255), TIMESTAMP WITH TIME ZONE).
   */
  private parseScalarType(): FlinkType {
    // Parse base type, then consume any parameters and keywords
    let dataType = this.state.parseIdentifierWithSpaces(() => this.shouldStopParsingType());

    // Consume parameters in parentheses (e.g., VARCHAR(255), DECIMAL(10,2))
    this.state.skipWhitespace();
    if (this.state.peek() === "(") {
      const paramContent = this.state.consumeUntilMatchingDelimiter("(");
      dataType += `(${paramContent})`;
      this.state.tryConsume(")");
    }

    // Parse additional type keywords (e.g., "WITH LOCAL TIME ZONE", "WITH TIME ZONE")
    this.state.skipWhitespace();
    if (!this.state.isEof() && !this.shouldStopParsingType()) {
      const keywords = this.state.parseIdentifierWithSpaces(() => this.shouldStopParsingType());
      if (keywords) {
        dataType += ` ${keywords}`;
      }
    }

    this.state.skipWhitespace();
    return {
      dataType,
      isFieldNullable: this.parseNullability(),
      kind: FlinkTypeKind.SCALAR,
    };
  }

  /**
   * Parse nullability markers (NOT NULL, NULL, or default nullable).
   * @returns true if nullable, false if NOT NULL
   */
  private parseNullability(): boolean {
    if (this.hasNotNull()) {
      this.consumeNotNull();
      return false; // NOT NULL means not nullable
    } else if (this.hasNull()) {
      this.consumeNull();
      return true; // NULL explicitly means nullable
    }
    return true; // Default is nullable
  }

  /**
   * Parse ROW member fields.
   * Format: fieldName1 type1, fieldName2 type2, ...
   * May have optional comments after the type in single quotes.
   */
  private parseRowMembers(): FlinkType[] {
    const members: FlinkType[] = [];

    while (!this.state.isEof()) {
      this.state.skipWhitespace();

      // Check for closing bracket
      if (this.state.peek() === ">") {
        break;
      }

      // Parse field name (backtick-quoted or unquoted)
      let fieldName = "";
      if (this.state.peek() === "`") {
        this.state.consume(); // consume opening backtick
        fieldName = this.state.parseUntilChar("`");
        // Ensure a closing backtick is actually present to avoid confusing downstream errors
        if (this.state.isEof() || this.state.peek() !== "`") {
          throw new Error(
            "Unterminated backtick-quoted ROW field name; expected '`' before end of input.",
          );
        }
        this.state.consume(); // consume closing backtick
      } else {
        fieldName = this.state.parseIdentifier();
      }

      this.state.skipWhitespace();

      // Parse field type
      const fieldType = this.parse();
      fieldType.fieldName = fieldName;

      // Check for optional comment
      this.state.skipWhitespace();
      if (!this.state.isEof() && this.state.peek() === "'") {
        fieldType.comment = this.parseComment();
      }

      members.push(fieldType);

      this.state.skipWhitespace();

      // Check for comma separator or closing bracket
      if (this.state.isEof()) {
        throw new Error("Expected ',' or '>' in ROW definition, got EOF");
      }
      if (this.state.peek() === ",") {
        this.state.consume();
      } else if (this.state.peek() !== ">") {
        throw new Error(`Expected ',' or '>' in ROW definition, got: ${this.state.peek()}`);
      }
    }

    return members;
  }

  /**
   * Parse MAP members (key type and value type).
   * Format: keyType, valueType
   * Returns exactly 2 members with fieldNames "key" and "value".
   */
  private parseMapMembers(): FlinkType[] {
    this.state.skipWhitespace();

    // Parse key type
    const keyType = this.parse();
    keyType.fieldName = "key";

    this.state.skipWhitespace();
    if (!this.state.tryConsume(",")) {
      throw new Error("Expected ',' between MAP key and value types");
    }

    this.state.skipWhitespace();

    // Parse value type
    const valueType = this.parse();
    valueType.fieldName = "value";

    return [keyType, valueType];
  }

  /**
   * Parse a field comment in single quotes.
   * In Flink SQL, interior single quotes are escaped as doubled quotes ('').
   * This method handles the unescaping: '' in input becomes ' in output.
   *
   * @returns The comment text with escaped quotes unescaped
   */
  private parseComment(): string {
    // Consume opening quote (caller verified it exists with peek() === "'")
    this.state.consume();

    const start = this.state.getCurrentPos();

    // Scan forward to find the closing quote, tracking doubled quotes
    while (!this.state.isEof()) {
      if (this.state.peek() === "'") {
        this.state.consume();
        // Check if it's an escaped quote (doubled)
        if (this.state.peek() === "'") {
          this.state.consume(); // consume second quote, continue scanning
        } else {
          // Found closing quote - extract and unescape
          const rawComment = this.state.extractSince(start);
          // Remove the closing quote (last character) and unescape doubled quotes
          return rawComment.slice(0, -1).replaceAll("''", "'");
        }
      } else {
        this.state.consume();
      }
    }

    // Reached EOF without finding closing quote
    throw new Error(
      "Unterminated field comment; expected closing single quote before end of input.",
    );
  }

  /**
   * Check if the next tokens are "NOT NULL" without consuming them.
   * Returns true if found, false otherwise.
   */
  private hasNotNull(): boolean {
    if (this.state.peekWord().word !== "NOT") {
      return false;
    }

    // After NOT, we need to see NULL
    const word2 = this.state.peekWordAt("NOT".length);
    return word2 === "NULL";
  }

  /**
   * Check if the next token is "NULL" (standalone, without NOT).
   * Returns true if found, false otherwise.
   */
  private hasNull(): boolean {
    const word = this.state.peekWord();
    return word.word === "NULL";
  }

  /**
   * Determine if we should stop parsing an identifier.
   * Stops at: delimiters (<>,()), keywords (NOT NULL, NULL), and punctuation (', ,)
   */
  private shouldStopParsingType(): boolean {
    const ch = this.state.peek();
    if (!ch) return true;

    // Stop at delimiters: < > , ( )
    if (ch === "<" || ch === ">" || ch === "(" || ch === ")" || ch === ",") {
      return true;
    }

    // Stop at field comment marker
    if (ch === "'") {
      return true;
    }

    // Stop at keywords: NOT NULL or NULL
    if (this.hasNotNull() || this.hasNull()) {
      return true;
    }

    return false;
  }

  /**
   * Consume "NOT NULL" tokens (assuming they exist, call hasNotNull first).
   */
  private consumeNotNull(): void {
    this.state.skipWhitespace();
    this.state.tryConsume("NOT");
    this.state.skipWhitespace();
    this.state.tryConsume("NULL");
  }

  /**
   * Consume "NULL" token (assuming it exists, call hasNull first).
   */
  private consumeNull(): void {
    this.state.skipWhitespace();
    this.state.tryConsume("NULL");
  }
}
