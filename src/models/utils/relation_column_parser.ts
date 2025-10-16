import { Logger } from "../../logging";
import {
  CompositeFlinkRelationColumn,
  FlinkRelationColumn,
  FlinkRelationColumnProps,
  MapFlinkRelationColumn,
} from "../flinkSystemCatalog";

const logger = new Logger("relation-column-parser");

/**
 * Factory that produces the correct FlinkRelationColumn subclass for a parsed type definition.
 * Arrays are unwrapped iteratively (counting dimensions) so nested ARRAY<ARRAY<...>> is handled
 * without recursive re-parsing. The innermost non-array ParsedType then falls through to the
 * existing primitive / row / map logic while retaining array metadata.
 */
export function relationColumnFactory(props: FlinkRelationColumnProps): FlinkRelationColumn {
  try {
    const parser = new TypeParser(props.fullDataType);
    let parsed = parser.parseType();

    // ------------------ ARRAY Unwrapping (iterative) ------------------
    let arrayDimensions = 0;
    let isArray = props.isArray === true;
    let arrayMemberNullable = props.isArrayMemberNullable === true;
    // Track outermost array nullability/comment only once (similar to prior behavior).
    let topArrayNullable: boolean | undefined;
    let topArrayComment: string | null | undefined;

    if (parsed.kind === ParsedKind.Array) {
      isArray = true;
      while (parsed.kind === ParsedKind.Array) {
        arrayDimensions++;
        // Capture first (outermost) array nullability & comment for consistency.
        if (topArrayNullable === undefined) {
          topArrayNullable = parsed.nullable;
        }
        if (topArrayComment === undefined && parsed.comment) {
          topArrayComment = parsed.comment;
        }
        // Member nullability refers to innermost element immediate children.
        arrayMemberNullable = parsed.element.nullable;
        parsed = parsed.element; // Tunnel into element
      }
    }

    // Decide final nullability: prefer explicit prop, else outer array (if any), else parsed.
    const finalNullable =
      props.isNullable !== undefined
        ? props.isNullable
        : topArrayNullable !== undefined
          ? topArrayNullable
          : parsed.nullable;

    const finalComment = props.comment || topArrayComment || parsed.comment;

    if (parsed.kind === ParsedKind.Primitive) {
      return new FlinkRelationColumn({
        ...props,
        fullDataType: parsed.text,
        comment: finalComment,
        isNullable: finalNullable,
        isArray: isArray,
        isArrayMemberNullable: arrayMemberNullable,
        arrayDimensions,
      });
    } else if (parsed.kind === ParsedKind.Row) {
      const columns: FlinkRelationColumn[] = parsed.fields.map((field) =>
        relationColumnFactory({
          relationName: `${props.relationName}.${props.name}`,
          // Synthetic relation name chain preserves hierarchy
          name: field.name,
          fullDataType: field.typeText,
          comment: field.comment ?? null,
          distributionKeyNumber: null,
          isGenerated: props.isGenerated,
          isPersisted: props.isPersisted,
          isHidden: props.isHidden,
          metadataKey: null,
          isArray: field.type.kind === ParsedKind.Array,
          isArrayMemberNullable:
            field.type.kind === ParsedKind.Array
              ? (field.type as ParsedArray).element.nullable
              : false,
          arrayDimensions:
            field.type.kind === ParsedKind.Array
              ? countArrayDimensions(field.type as ParsedArray)
              : 0,
        }),
      );

      return new CompositeFlinkRelationColumn({
        ...props,
        fullDataType: parsed.text,
        comment: finalComment,
        isNullable: finalNullable,
        isArray: isArray,
        isArrayMemberNullable: arrayMemberNullable,
        arrayDimensions,
        columns,
      });
    } else if (parsed.kind === ParsedKind.MultiSet) {
      // Must be a multiset.
      const keyCol = relationColumnFactory({
        relationName: `${props.relationName}.${props.name}`,
        name: "key",
        fullDataType: parsed.key.text,
        isNullable: parsed.key.nullable,
        distributionKeyNumber: null,
        isGenerated: props.isGenerated,
        isPersisted: props.isPersisted,
        isHidden: props.isHidden,
        metadataKey: null,
        isArray: parsed.key.kind === ParsedKind.Array,
        isArrayMemberNullable:
          parsed.key.kind === ParsedKind.Array
            ? (parsed.key as ParsedArray).element.nullable
            : false,
        arrayDimensions:
          parsed.key.kind === ParsedKind.Array
            ? countArrayDimensions(parsed.key as ParsedArray)
            : 0,
        comment: null,
      });

      throw new Error("MultiSet columns not yet supported");
      // TODO make a new toplevel class.

      // return new MapFlinkRelationColumn({
      //   ...props,
      //   keyColumn: keyCol,
      //   valueColumn: undefined as any, // MultiSet has no value
      //   isNullable: finalNullable,
      //   fullDataType: parsed.text,
      //   comment: finalComment,
      //   isArray: isArray,
      //   isArrayMemberNullable: arrayMemberNullable,
      //   arrayDimensions,
      // });
    } else {
      // Must be a map.
      const keyCol = relationColumnFactory({
        relationName: `${props.relationName}.${props.name}`,
        name: "key",
        fullDataType: parsed.key.text,
        isNullable: parsed.key.nullable,
        distributionKeyNumber: null,
        isGenerated: props.isGenerated,
        isPersisted: props.isPersisted,
        isHidden: props.isHidden,
        metadataKey: null,
        isArray: parsed.key.kind === ParsedKind.Array,
        isArrayMemberNullable:
          parsed.key.kind === ParsedKind.Array
            ? (parsed.key as ParsedArray).element.nullable
            : false,
        arrayDimensions:
          parsed.key.kind === ParsedKind.Array
            ? countArrayDimensions(parsed.key as ParsedArray)
            : 0,
        comment: null,
      });
      const valueCol = relationColumnFactory({
        relationName: `${props.relationName}.${props.name}`,
        name: "value",
        fullDataType: parsed.value.text,
        isNullable: parsed.value.nullable,
        distributionKeyNumber: null,
        isGenerated: props.isGenerated,
        isPersisted: props.isPersisted,
        isHidden: props.isHidden,
        metadataKey: null,
        isArray: parsed.value.kind === ParsedKind.Array,
        isArrayMemberNullable:
          parsed.value.kind === ParsedKind.Array
            ? (parsed.value as ParsedArray).element.nullable
            : false,
        arrayDimensions:
          parsed.value.kind === ParsedKind.Array
            ? countArrayDimensions(parsed.value as ParsedArray)
            : 0,
        comment: null,
      });

      return new MapFlinkRelationColumn({
        ...props,
        keyColumn: keyCol,
        valueColumn: valueCol,
        isNullable: finalNullable,
        fullDataType: parsed.text,
        comment: finalComment,
        isArray: isArray,
        isArrayMemberNullable: arrayMemberNullable,
        arrayDimensions,
      });
    }
  } catch (e) {
    logger.error(`Failed to parse complex type '${props.fullDataType}': ${(e as Error).message}`);
    return new FlinkRelationColumn(props);
  }
}

// Helper to count nested array dimensions for a ParsedArray chain.
function countArrayDimensions(arr: ParsedArray): number {
  let dims = 0;
  let current: ParsedType = arr;
  while (current.kind === ParsedKind.Array) {
    dims++;
    current = current.element;
  }
  return dims;
}

/* ----------------------------- Parsing Section ----------------------------- */

enum ParsedKind {
  Primitive = "primitive",
  Row = "row",
  Map = "map",
  Array = "array",
  MultiSet = "multiset",
}

interface ParsedTypeBase {
  kind: ParsedKind;
  nullable: boolean;
  text: string; // Canonical text (no comments, no trailing NULL marker)
  comment: string | null; // Optional comment if present
}

interface ParsedPrimitive extends ParsedTypeBase {
  kind: ParsedKind.Primitive;
}

interface ParsedArray extends ParsedTypeBase {
  kind: ParsedKind.Array;
  element: ParsedType;
}

interface ParsedMap extends ParsedTypeBase {
  kind: ParsedKind.Map;
  key: ParsedType;
  value: ParsedType;
}

interface ParsedMultiSet extends ParsedTypeBase {
  kind: ParsedKind.MultiSet;
  key: ParsedType;
}

interface ParsedRowField {
  name: string;
  type: ParsedType;
  typeText: string; // Canonical textual representation of the field's type
  comment?: string;
  nullable: boolean;
}

interface ParsedRow extends ParsedTypeBase {
  kind: ParsedKind.Row;
  fields: ParsedRowField[];
}

type ParsedType = ParsedPrimitive | ParsedArray | ParsedMap | ParsedMultiSet | ParsedRow;

/**
 * Recursive descent parser for Flink style complex types.
 */
class TypeParser {
  private readonly input: string;
  private pos = 0;
  private readonly length: number;

  constructor(input: string) {
    this.input = input.trim();
    this.length = this.input.length;
  }

  parseType(): ParsedType {
    this.skipWs();
    const start = this.pos;
    const look = this.peekWordUpper();
    if (look === "ROW" && this.peekChar(3) === "<") {
      return this.parseRow(start);
    }
    if (look === "MAP" && this.peekChar(3) === "<") {
      return this.parseMap(start);
    }
    if (look === "MULTISET" && this.peekChar(8) === "<") {
      return this.parseMultiSet(start);
    }
    if (look === "ARRAY" && this.peekChar(5) === "<") {
      return this.parseArray(start);
    }
    return this.parsePrimitive(start);
  }

  private parsePrimitive(typeStart: number): ParsedPrimitive {
    // Collect chars until one of: ',', '>', end, comment start, or nullable marker at top-level of primitive.
    let parenDepth = 0;
    while (!this.eof()) {
      const ch = this.current();
      if (ch === "(") {
        parenDepth++;
      } else if (ch === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (parenDepth === 0) {
        if (ch === "," || ch === ">") {
          break;
        }
        // Check for stop marker ahead (space + NULL / NOT NULL or open single quote for comment)
        if (this.isAtNullableOrCommentBoundary()) {
          break;
        }
      }
      this.pos++;
    }
    const text = this.input.substring(typeStart, this.pos).trimEnd();

    // look for nullability
    this.skipWs();
    const nullable = this.parseNullability();

    // Now look for trailing optional comment
    this.skipWs();
    let comment: string | null = null;
    if (this.current() === "'") {
      comment = this.parseQuotedComment();
      this.skipWs();
    }
    return {
      kind: ParsedKind.Primitive,
      nullable: nullable,
      comment,
      text,
    };
  }

  private parseRow(typeStart: number): ParsedRow {
    // Consume ROW<
    this.expectWord("ROW");
    this.expectChar("<");
    const fields: ParsedRowField[] = [];
    this.skipWs();
    while (!this.eof() && this.current() !== ">") {
      fields.push(this.parseRowField());
      this.skipWs();
      if (this.current() === ",") {
        this.pos++;
        this.skipWs();
        continue;
      }
      break;
    }
    this.expectChar(">");

    // handle possible NULL / NOT NULL after ROW<...>
    this.skipWs();
    const nullable = this.parseNullability();

    // Handle optional comment the nullability.
    this.skipWs();
    let comment: string | null = null;
    if (this.current() === "'") {
      comment = this.parseQuotedComment();
      this.skipWs();
    }

    const text = this.input.substring(typeStart, this.pos);
    return {
      kind: ParsedKind.Row,
      fields,
      comment,
      nullable, // Row nullability (as a type) is handled outside field spec; rarely used inline
      text,
    };
  }

  private parseRowField(): ParsedRowField {
    this.skipWs();
    const name = this.parseBacktickedIdentifier();
    this.skipWs();
    const typeStart = this.pos;
    const type = this.parseType();
    const typeEnd = this.pos;
    const typeText = this.input.substring(typeStart, typeEnd);

    this.skipWs();

    // Possible NULL / NOT NULL after field type
    const nullable = this.parseNullability();

    // Possible comment after field type and nullability
    this.skipWs();
    let comment: string | undefined;
    if (this.current() === "'") {
      comment = this.parseQuotedComment();
      this.skipWs();
    }

    return {
      name,
      type,
      typeText,
      comment,
      nullable,
    };
  }

  private parseMultiSet(typeStart: number): ParsedMultiSet {
    this.expectWord("MULTISET");
    this.expectChar("<");
    this.skipWs();
    const key = this.parseType();
    this.skipWs();
    this.expectChar(">");
    const text = this.input.substring(typeStart, this.pos);

    // Handle optional NULL / NOT NULL for the multiset type itself
    const nullable = this.parseNullability();

    // Optional comment after MULTISET<...>
    this.skipWs();
    let comment: string | null = null;
    if (this.current() === "'") {
      comment = this.parseQuotedComment();
      this.skipWs();
    }

    return {
      kind: ParsedKind.MultiSet,
      key,
      comment,
      nullable,
      text,
    };
  }

  private parseMap(typeStart: number): ParsedMap {
    this.expectWord("MAP");
    this.expectChar("<");
    this.skipWs();
    const key = this.parseType();
    this.skipWs();
    this.expectChar(",");
    this.skipWs();
    const value = this.parseType();
    this.skipWs();
    this.expectChar(">");
    const text = this.input.substring(typeStart, this.pos);

    // Handle optional NULL / NOT NULL for the map type itself
    const nullable = this.parseNullability();

    // Optional comment after MAP<...>
    this.skipWs();
    let comment: string | null = null;
    if (this.current() === "'") {
      comment = this.parseQuotedComment();
      this.skipWs();
    }

    return {
      kind: ParsedKind.Map,
      key,
      value,
      comment,
      nullable,
      text,
    };
  }

  private parseArray(typeStart: number): ParsedArray {
    this.expectWord("ARRAY");
    this.expectChar("<");
    this.skipWs();
    const element = this.parseType();

    // Optional element-level NULL / NOT NULL inside ARRAY<...>
    const elemNullable = this.parseNullability();
    if (elemNullable) {
      // Rebuild element text to include NULL marker if present
      const elemText = this.input.substring(typeStart, this.pos).trimEnd();
      element.nullable = true;
      element.text = elemText;
    }

    this.skipWs();
    this.expectChar(">");

    // Handle trailing NULL / NOT NULL for the array type itself
    this.skipWs();
    const nullable = this.parseNullability();

    // Optional comment after ARRAY<...>
    this.skipWs();
    let comment: string | null = null;
    if (this.current() === "'") {
      comment = this.parseQuotedComment();
      this.skipWs();
    }

    const text = this.input.substring(typeStart, this.pos);
    return {
      kind: ParsedKind.Array,
      element,
      nullable,
      text,
      comment: comment,
    };
  }

  private isAtNullableOrCommentBoundary(): boolean {
    // Look ahead skipping spaces; if next word is NULL or NOT -> boundary
    const save = this.pos;
    this.skipWsInline();
    const w = this.peekWordUpper();
    this.pos = save;
    return w === "NULL" || w === "NOT" || w === "'"; // also stop at comment start
  }

  /* --------------------------- Low-level utilities -------------------------- */

  private current(): string {
    return this.input[this.pos];
  }

  private eof(): boolean {
    return this.pos >= this.length;
  }

  private skipWs(): void {
    while (!this.eof() && /\s/.test(this.current())) this.pos++;
  }

  private skipWsInline(): void {
    while (!this.eof() && this.current() === " ") this.pos++;
  }

  private expectChar(c: string): void {
    this.skipWs();
    if (this.current() !== c) {
      throw new Error(`Expected '${c}' at position ${this.pos}, found '${this.current()}'`);
    }
    this.pos++;
  }

  private expectWord(word: string): void {
    this.skipWs();
    const upper = word.toUpperCase();
    const actual = this.peekWordUpper();
    if (actual !== upper) {
      throw new Error(`Expected keyword ${upper} at position ${this.pos}, found ${actual}`);
    }
    this.consumeWord();
  }

  private peekChar(offset: number): string | undefined {
    return this.input[this.pos + offset];
  }

  private peekWordUpper(): string {
    let i = this.pos;
    // Skip leading whitespace
    while (i < this.length && /\s/.test(this.input[i])) i++;

    if (this.input[i] === "'") {
      // Comment start identifier, return it. Counts as its own word.
      return "'";
    }

    // Consume word
    let j = i;
    while (j < this.length && /[A-Za-z_]/.test(this.input[j])) j++;
    return this.input.substring(i, j).toUpperCase();
  }

  private consumeWord(): string {
    this.skipWs();
    const start = this.pos;
    while (!this.eof() && /[A-Za-z_]/.test(this.current())) this.pos++;
    return this.input.substring(start, this.pos);
  }

  private parseBacktickedIdentifier(): string {
    if (this.current() !== "`") {
      throw new Error(`Expected backtick at position ${this.pos}`);
    }
    this.pos++;
    const start = this.pos;
    while (!this.eof() && this.current() !== "`") {
      this.pos++;
    }
    if (this.eof()) {
      throw new Error("Unterminated backticked identifier");
    }
    const name = this.input.substring(start, this.pos);
    this.pos++; // consume closing backtick
    return name;
  }

  private parseNullability(): boolean {
    this.skipWs();
    const save = this.pos;
    let nullable = false;
    const nextWord = this.peekWordUpper();
    if (nextWord === "NULL") {
      this.consumeWord();
      this.skipWs();
      nullable = true;
    } else if (nextWord === "NOT") {
      this.consumeWord();
      this.skipWs();
      if (this.peekWordUpper() === "NULL") {
        this.consumeWord();
        this.skipWs();
        nullable = false;
      } else {
        this.pos = save;
      }
    }
    return nullable;
  }

  private parseQuotedComment(): string {
    if (this.current() !== "'") {
      throw new Error(`Expected quote at position ${this.pos}`);
    }
    this.pos++; // opening '
    let result = "";
    while (!this.eof()) {
      const ch = this.current();
      if (ch === "'") {
        // Could be end or escaped ''
        if (this.peekChar(1) === "'") {
          result += "'";
          this.pos += 2;
          continue;
        }
        this.pos++; // closing
        break;
      }
      result += ch;
      this.pos++;
    }
    return result;
  }
}
